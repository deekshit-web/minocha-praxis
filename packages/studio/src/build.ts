import { CLAUDE_MODEL, ClaudeModel, CompletionError, GROK_MODEL, GrokModel, type ModelProvider, type SeatSpec, callCost, repoRoot } from "@northwind/orchestrator";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod/v4";
import { ArchDiagramSchema, generateDiagram } from "./diagramGen.ts";
import { type TestOutcome, runIsolated } from "./isolate.ts";
import { type RecordedCall, Review, renderReview } from "./record.ts";
import type { WorkflowSpec } from "./workflows.ts";

/**
 * Real build stages after the PRD, for each build workflow: architecture (designed, reviewed, revised), code,
 * code review, Model A's unit tests, Model B's test cases and test script written from the PRD without the
 * code, a real test run in a time-limited sandbox, and up to two fix rounds. Both sides work to one contract:
 * the module's function names and data shapes, as a design hands an API to the people who build and test it.
 */

/** What the module must export, per workflow. Behaviour comes from the approved PRD, not from here. */
export const CONTRACTS: Record<string, string> = {
  "healthcare-build":
    'appealReady(line) where line = { carc: string (a CARC code such as "CO-50"), noteRef: string (a DOC-### id or ""), filingDeadline: string ("YYYY-MM-DD" or "") }. Returns { ready: boolean, missing: string[] } where missing names what blocks readiness, using exactly "clinical-note reference" and "filing deadline".',
  "education-build":
    'riskFlag(student) where student = { present: number, schoolDays: number, failingGrades: number, clearDays: number (school days in a row with neither condition) }. Returns { flagged: boolean, reasons: string[] } with reasons from "attendance" and "grades". canSeeFlag(role) where role is one of "counsellor", "head-of-year", "teacher", "student", "parent"; returns boolean. rosterFor(classId) returns an array of { id, classId } rows for the class roster.',
  "fmcg-build":
    "daysOfCover(stock, sellOut, weeks) where sellOut is units sold over the last `weeks` weeks of history; returns days of cover as a number (Infinity when nothing sold). createAlerter() returns { check({ distributor, sku, stock, sellOut, weeks, date }) } where date is \"YYYY-MM-DD\"; check returns an alert object { distributor, sku, cover } when one should be sent, or null.",
  "finance-build":
    'prequalify(input) where input = { grossMonthlyIncome, monthlyDebt, newPayment, creditScore } (numbers). Returns { prequalified: boolean, dti: number (a fraction such as 0.43), reasons: string[] (plain-words reasons; empty when pre-qualified) }. Throws an Error whose message is "unknown field: <name>" if input has any other field.',
  "logistics-build":
    'minutesLate(promised, etaUtc) where promised = { local: "YYYY-MM-DDTHH:mm", zone: an IANA zone such as "Asia/Kolkata" } and etaUtc = "YYYY-MM-DDTHH:mmZ"; returns whole minutes late (negative if early). toUtc(zoned) returns "YYYY-MM-DDTHH:mmZ". createNotifier() returns { update(id, promised, etaUtc) } returning a notice object { id, late } when the customer should be told, or null. formatForCustomer(etaUtc, zone) returns text such as "12 Nov, 21:00 (India time)" (Asia/Kolkata is "India time", America/New_York is "New York time").',
};

const CODE_RULES =
  "Write plain modern JavaScript: one expression that evaluates to an object with exactly the contract's functions, for example ({ fn(a) { ... } }) or (() => { ...; return { fn }; })(). " +
  "No imports, require, network, timers, console, globals or eval. Use only standard JavaScript (Math, Date, Intl, Map, Set, JSON).";

const TEST_RULES =
  "Write the body of a test script. It may call test(name, fn) and assert.equal(actual, expected), assert.deepEqual, assert.ok, assert.match(text, regex), assert.throws(fn, regex). " +
  "The module under test is `code`. No imports, require, network, timers or globals. Each test name says what it checks in plain words.";

/** Model B's acceptance test cases, from the PRD only. Mutation testing on ten live builds showed the earlier prompt
 * ("at most 8") left ordinary boundaries untested (a single carton, a price of 0 or 1, a date on the 1st or the 31st),
 * so this one asks for the edges where code usually goes wrong. */
export const ACCEPTANCE_CASES_PROMPT =
  "Write the acceptance test cases for this feature from the PRD only: one line each, 'TC-n · <requirement> · <inputs> → <expected result>'. At most 16. " +
  "Cover every requirement and acceptance criterion, then the edges where code usually goes wrong: for each limit or threshold, the value exactly at it and one step on either side; " +
  "zero, one and the smallest allowed value; an empty list and a single item; an item a rule picks out being first, in the middle and last; " +
  "for dates, the 1st and the last day of a month, December and January, and a leap day; " +
  "for rounding, the closest values on each side of the halfway point that the inputs can actually produce (work out the smallest step the unrounded result can move by, which may be smaller than one step of the input); " +
  "when an input may be written in more than one form (such as \"3\" and \"3.0\"), each form, mixed within one case; and one case for each error the PRD names. " +
  "Choose input values so that a plausible mistake gives a different answer: avoid values where, for example, dropping the wrong item or rounding the other way happens to give the same result, and use unequal amounts, because a mistake that scales every item alike can cancel out. " +
  "Work out every expected result exactly from the PRD, showing the arithmetic briefly where it is not obvious. Do not test behaviour the PRD leaves open.";
export const ACCEPTANCE_SCRIPT_PROMPT = `Write the test script for these cases, one test per case, using the exact expected values the case gives. You have never seen the code; work from the contract. ${TEST_RULES}`;

const Architecture = z.object({ text: z.string() });
const Revision = z.object({ text: z.string(), resolutions: z.array(z.object({ finding: z.string(), outcome: z.enum(["applied", "declined"]), note: z.string() })) });
const Code = z.object({ code: z.string(), summary: z.string() });
const CodeRevision = z.object({ code: z.string(), resolutions: z.array(z.object({ finding: z.string(), outcome: z.enum(["applied", "declined"]), note: z.string() })) });
export const Script = z.object({ script: z.string() });
export const Cases = z.object({ cases: z.array(z.string()) });
const Fix = z.object({ code: z.string(), change: z.string(), unitScript: z.string().optional() });

export const BuildRecordingSchema = z.object({
  id: z.string(),
  recordedAt: z.string(),
  contract: z.string(),
  calls: z.array(z.object({ role: z.string(), model: z.string(), seconds: z.number(), inputTokens: z.number(), outputTokens: z.number(), costUsd: z.number() })),
  architecture: z.object({ draft: z.string(), review: z.string(), final: z.string(), resolutions: z.string() }),
  code: z.object({ first: z.string(), summary: z.string(), review: z.string(), revised: z.string(), resolutions: z.string() }),
  unitScript: z.string(),
  testCases: z.array(z.string()),
  testScript: z.string(),
  /** `failing` counts acceptance tests; `unitFailing` counts Model A's unit tests (absent in older recordings). */
  runs: z.array(z.object({ round: z.number(), code: z.string(), acceptance: z.string(), unit: z.string(), failing: z.number(), unitFailing: z.number().optional() })),
  /** `unitScriptChanged`: Model A judged one of its own unit tests wrong and rewrote the unit tests in this round. */
  fixes: z.array(z.object({ round: z.number(), change: z.string(), unitScriptChanged: z.boolean().optional() })),
  finalCode: z.string(),
  /** Drawn by Model A and checked against the design, for a build that has no hand-drawn diagram. */
  diagram: ArchDiagramSchema.optional(),
  /** What the diagram check found: what the correction fixed, or why there is no diagram. */
  diagramIssues: z.array(z.string()).optional(),
});
export type BuildRecording = z.infer<typeof BuildRecordingSchema>;

/**
 * Runs a test script against model-written code in an isolated child process (see isolate.ts): empty environment,
 * no file, process or network access, and a time, memory and output limit. The browser's safety scan is not what
 * protects the server, so a build never runs model code in this process.
 */
export function sandboxRun(code: string, script: string, timeoutMs = 10_000): Promise<TestOutcome> {
  // On a hosted server the code never runs without a network namespace, whatever else is set.
  return runIsolated(code, script, { timeoutMs, requireNetworkIsolation: process.env.STUDIO_HOSTED === "1" });
}

export function reportOf(outcome: TestOutcome): string {
  if (outcome.error && !outcome.results.length) return `✗ the tests could not run\n  ${outcome.error}`;
  const failing = outcome.results.filter((result) => !result.pass).length;
  const lines = outcome.results.map((result) => (result.pass ? `✓ ${result.name}` : `✗ ${result.name}\n  ${result.message}`));
  lines.push(failing ? `${failing} failing, ${outcome.results.length - failing} passing` : `${outcome.results.length} passing`);
  return lines.join("\n");
}

const failingOf = (outcome: TestOutcome) => (outcome.error && !outcome.results.length ? 1 : outcome.results.filter((result) => !result.pass).length);

/** One step of a running build, for a page that shows each call as it lands. `call` is null for a sandbox run. */
export interface BuildProgress {
  role: string;
  call: RecordedCall | null;
  text: string;
}

export interface BuildOptions {
  /** The module contract. Without one (and without a prepared one for the workflow) the contract is drafted and checked first. */
  contract?: string;
  onProgress?: (event: BuildProgress) => void;
  /** Stops the build before the next call once the calls so far cost this much. */
  maxCostUsd?: number;
  /** Stops the build before the next call once it has run this long. */
  maxSeconds?: number;
  /** Has Model A draw the final design as a data-flow diagram, and checks the drawing against the design. */
  diagram?: boolean;
}

/** A build stopped by its own cost or time limit. The calls made so far are billed and reported. */
export class BuildLimitError extends Error {}

const Contract = z.object({ contract: z.string() });
const ContractRevision = z.object({ contract: z.string(), resolutions: z.array(z.object({ finding: z.string(), outcome: z.enum(["applied", "declined"]), note: z.string() })) });

/** The text a person reads for one answer. */
const REVIEW_PREFIX: Record<string, string> = { archReview: "AR-", codeReview: "CR-", contractReview: "K-" };
function describe(value: unknown, role: string): string {
  const item = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["text", "contract", "summary", "code", "script", "change"]) if (typeof item[key] === "string") parts.push(item[key] as string);
  if (Array.isArray(item.cases)) parts.push((item.cases as string[]).join("\n"));
  if (Array.isArray(item.nodes)) {
    const nodes = item.nodes as Array<{ id: string; label: string; area: string; file?: string }>;
    parts.push(`Boxes:\n${nodes.map((node) => `- ${node.label} (${node.area}${node.file ? `, ${node.file}` : ""})`).join("\n")}`);
    parts.push(`Data flows:\n${((item.edges ?? []) as Array<{ from: string; to: string; label: string }>).map((edge) => `- ${edge.from} to ${edge.to}: ${edge.label}`).join("\n")}`);
  }
  if (Array.isArray(item.findings)) parts.push(renderReview(item as ReviewAnswer, "D-A").replace(/^D-A(\d+)/gm, `${REVIEW_PREFIX[role] ?? "F-"}$1`));
  if (Array.isArray(item.resolutions)) parts.push((item.resolutions as Array<{ finding: string; outcome: string; note: string }>).map((entry) => `${entry.finding} ${entry.outcome}: ${entry.note}`).join("\n"));
  return parts.join("\n\n");
}

export interface BuildSeats {
  /** Model A for one task, given instructions and an answer schema. */
  a(instructions: string, schema: z.ZodType<unknown>): ModelProvider;
  /** Model B for one task. */
  b(instructions: string, schema: z.ZodType<unknown>): ModelProvider;
  run: typeof sandboxRun;
}

export function liveBuildSeats(context: string): BuildSeats {
  const all = (seat: SeatSpec) => ({ analystA: seat, analystB: seat, critiqueOfA: seat, critiqueOfB: seat, synthesizer: seat });
  return {
    a: (instructions, schema) => new ClaudeModel(context, all({ instructions, schema })),
    b: (instructions, schema) => new GrokModel(context, { analystA: { instructions, schema } }),
    run: sandboxRun,
  };
}

/** Records the real build stages for one workflow, on top of its recorded PRD (the panel's merged document). */
export async function recordBuild(spec: WorkflowSpec, prd: string, seats: BuildSeats, now = () => new Date(), options: BuildOptions = {}): Promise<BuildRecording> {
  const startedAt = Date.now();
  const calls: RecordedCall[] = [];
  // Every stage's prompt starts with the PRD (and, once there is one, the contract). That part is sent as shared
  // material, so the providers can cache it across the build's calls instead of paying for it each time.
  const sharedPrefixes: string[] = [];
  const requestFor = (prompt: string) => {
    const shared = sharedPrefixes.filter((prefix) => prompt.startsWith(prefix)).sort((x, y) => y.length - x.length)[0];
    if (!shared) return { role: "analystA" as const, prompt };
    return { role: "analystA" as const, shared, prompt: prompt.slice(shared.length).trim() || "Work from the PRD and contract above." };
  };
  const ask = async <T>(seat: ModelProvider, role: string, prompt: string, schema: z.ZodType<T>, model: string, attempt = 1): Promise<T> => {
    const spent = calls.reduce((total, call) => total + call.costUsd, 0);
    if (options.maxCostUsd !== undefined && spent >= options.maxCostUsd) throw new BuildLimitError(`The build stopped before "${role}": its calls so far cost $${spent.toFixed(2)}, which is the limit of $${options.maxCostUsd.toFixed(2)}.`);
    if (options.maxSeconds !== undefined && (Date.now() - startedAt) / 1000 >= options.maxSeconds) throw new BuildLimitError(`The build stopped before "${role}": it ran for more than ${Math.round(options.maxSeconds / 60)} minutes.`);
    const started = Date.now();
    let answer: Awaited<ReturnType<ModelProvider["complete"]>>;
    try {
      answer = await seat.complete(requestFor(prompt));
    } catch (error) {
      // A model now and then returns an answer that does not match the schema (3 of 23 of Model B's longer test-case
      // answers in one trial). Ask once more, and count what the failed attempt cost.
      if (!(error instanceof CompletionError) || !error.message.startsWith("model-unparsed") || attempt > 1) throw error;
      calls.push({
        role,
        model: error.model,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        inputTokens: error.usage.inputTokens + error.usage.cacheReadTokens + error.usage.cacheWriteTokens,
        outputTokens: error.usage.outputTokens,
        costUsd: error.costUsd ?? callCost(error.model.startsWith("grok") ? GROK_MODEL : CLAUDE_MODEL, error.usage) ?? 0,
      });
      return ask(seat, role, prompt, schema, model, attempt + 1);
    }
    const usage = answer.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const answered = answer.model ?? model;
    calls.push({
      role,
      model: answered,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      inputTokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
      outputTokens: usage.outputTokens,
      costUsd: answer.costUsd ?? callCost(answered.startsWith("grok") ? GROK_MODEL : CLAUDE_MODEL, usage) ?? 0,
    });
    const value = schema.parse(JSON.parse(answer.text));
    options.onProgress?.({ role, call: calls[calls.length - 1]!, text: describe(value, role) });
    return value;
  };
  // Models sometimes return a whole module on one line. Reprint code readably (same meaning) before it is run
  // and stored; the recorder runs where esbuild is installed, and the server never loads this path.
  let pretty = (source: string, _expression: boolean) => source;
  try {
    const { transformSync } = await import("esbuild");
    pretty = (source, expression) => {
      try {
        const out = expression ? transformSync(`(${source});`, { loader: "js" }).code.trim().replace(/;$/, "") : transformSync(source, { loader: "js" }).code.trim();
        return out.replace(/\/\* @__PURE__ \*\/ ?/g, "");
      } catch {
        return source;
      }
    };
  } catch {
    // Without esbuild the code is stored as written.
  }
  const A = CLAUDE_MODEL;
  const B = GROK_MODEL;
  const REVIEW = "Rate each finding P0 (would cause a wrong result, a broken rule or a security problem), P1 (should be fixed) or P2 (optional). Title in at most six words, explain in at most 50, quote the exact text at fault. At most four findings; return none rather than invent one. Name one strength.";
  const resolutionsText = (items: Array<{ finding: string; outcome: string; note: string }>) => items.map((item) => `${item.finding} ${item.outcome}: ${item.note}`).join("\n");

  // A request with no prepared contract (a visitor's) gets one first: Model A drafts it from the PRD, Model B checks that
  // every requirement can be tested through it, and Model A revises it only if Model B raised a finding.
  const draftContract = async (): Promise<string> => {
    const brief = `The approved PRD:\n${prd}`;
    sharedPrefixes.push(brief);
    const first = await ask(
      seats.a(
        `Write the module contract for this feature: the exact function names, and the data shapes of their inputs and results, in one short paragraph. Describe no behaviour, because the PRD gives it. The module is plain JavaScript functions with no input or output, so every requirement can be tested through them. Match the style of this example: ${CONTRACTS["finance-build"]}`,
        Contract,
      ),
      "contractDraft",
      brief,
      Contract,
      A,
    );
    const review = renumberAs(await ask(seats.b(`Check this contract against the PRD. Can every requirement and acceptance criterion be tested through these functions and data shapes alone? ${REVIEW} Use ids K-1, K-2, ...`, Review), "contractReview", `${brief}\n\nThe contract:\n${first.contract}`, Review, B), "K-");
    if (!review.findings.length) return first.contract;
    const final = await ask(
      seats.a("Revise the contract to resolve every finding: apply it, or decline it with a reason. Return the full contract.", ContractRevision),
      "contractFinal",
      `${brief}\n\nYour contract:\n${first.contract}\n\nThe review:\n${renderReviewAs(review, "K-")}`,
      ContractRevision,
      A,
    );
    return final.contract;
  };
  const contract = options.contract ?? CONTRACTS[spec.id] ?? (await draftContract());
  const PRD = `The approved PRD:\n${prd}\n\nThe module contract:\n${contract}`;
  sharedPrefixes.push(PRD);

  // Architecture: Model A designs, Model B reviews, Model A revises.
  const draft = await ask(seats.a("Design how to build this: the components, the data, and the exact files that may change (the file fence). Plain text, at most 10 lines.", Architecture), "archDraft", PRD, Architecture, A);
  const archReview = renumberAs(await ask(seats.b(`Review this architecture against the PRD. ${REVIEW} Use ids AR-1, AR-2, ...`, Review), "archReview", `${PRD}\n\nThe architecture:\n${draft.text}`, Review, B), "AR-");
  const archFinal = await ask(seats.a("Revise the architecture to resolve every finding: apply it, or decline it with a reason. Plain text, at most 10 lines.", Revision), "archFinal", `${PRD}\n\nYour architecture:\n${draft.text}\n\nThe review:\n${renderReviewAs(archReview, "AR-")}`, Revision, A);

  // The design as a picture, for a person who must approve it. A failed drawing never fails the build: only a limit does.
  let diagram: BuildRecording["diagram"];
  let diagramIssues: string[] | undefined;
  if (options.diagram) {
    try {
      const drawn = await generateDiagram(ask, (instructions, schema) => seats.a(instructions, schema), { draft: draft.text, review: renderReviewAs(archReview, "AR-"), final: archFinal.text }, A);
      diagram = drawn.diagram ?? undefined;
      diagramIssues = drawn.issues;
      options.onProgress?.({
        role: "diagramCheck",
        call: null,
        text: drawn.diagram ? (drawn.issues.length ? `The diagram passed the check after one correction. The first drawing had these problems:\n- ${drawn.issues.join("\n- ")}` : "The diagram passed the check against the design.") : `No diagram. It failed the check twice:\n- ${drawn.issues.join("\n- ")}`,
      });
    } catch (error) {
      if (error instanceof BuildLimitError) throw error;
      diagramIssues = [`the diagram could not be drawn: ${error instanceof Error ? error.message.slice(0, 160) : "an error"}`];
      options.onProgress?.({ role: "diagramCheck", call: null, text: `No diagram. ${diagramIssues[0]}` });
    }
  }

  // Code: Model A writes it; Model B reviews it; Model A applies or declines each point.
  const first = await ask(seats.a(`Write the module. ${CODE_RULES}`, Code), "code", `${PRD}\n\nThe architecture:\n${archFinal.text}`, Code, A);
  const codeReview = renumberAs(await ask(seats.b(`Review this code against the PRD and the contract. ${REVIEW} Use ids CR-1, CR-2, ...`, Review), "codeReview", `${PRD}\n\nThe code:\n${first.code}`, Review, B), "CR-");
  const revised = await ask(seats.a(`Apply the review points you agree with and decline the rest with a reason. Return the full revised module. ${CODE_RULES}`, CodeRevision), "codeRevise", `${PRD}\n\nYour code:\n${first.code}\n\nThe review:\n${renderReviewAs(codeReview, "CR-")}`, CodeRevision, A);

  // Tests: Model A's unit tests of its own code; Model B's cases and script from the PRD and contract only.
  const [unit, cases] = await Promise.all([
    ask(seats.a(`Write unit tests for your own module, at most 6 tests. ${TEST_RULES}`, Script), "unitTests", `${PRD}\n\nYour code:\n${revised.code}`, Script, A),
    ask(seats.b(ACCEPTANCE_CASES_PROMPT, Cases), "testCases", PRD, Cases, B),
  ]);
  const script = await ask(seats.b(ACCEPTANCE_SCRIPT_PROMPT, Script), "testScript", `${PRD}\n\nThe test cases:\n${cases.cases.join("\n")}`, Script, B);

  // Run, and let Model A fix failures from either suite, up to two rounds. Model A wrote the unit tests, so a failing
  // one may be the test's fault: the fix may rewrite them, and the record says so. The acceptance tests are never
  // rewritten; they are the independent check.
  first.code = pretty(first.code, true);
  revised.code = pretty(revised.code, true);
  unit.script = pretty(unit.script, false);
  script.script = pretty(script.script, false);
  let code = revised.code;
  const runs: BuildRecording["runs"] = [];
  const fixes: BuildRecording["fixes"] = [];
  for (let round = 1; round <= 3; round += 1) {
    const [acceptance, unitRun] = await Promise.all([seats.run(code, script.script), seats.run(code, unit.script)]);
    const failing = failingOf(acceptance);
    const unitFailing = failingOf(unitRun);
    runs.push({ round, code, acceptance: reportOf(acceptance), unit: reportOf(unitRun), failing, unitFailing });
    options.onProgress?.({ role: `run${round}`, call: null, text: `Acceptance tests:\n${reportOf(acceptance)}\n\nModel A's unit tests:\n${reportOf(unitRun)}` });
    if ((!failing && !unitFailing) || round === 3) break;
    const fix = await ask(
      seats.a(
        "The acceptance tests below were written from the PRD by someone who never saw your code; the unit tests are your own. Fix the code so it meets the PRD. " +
          "If an acceptance test contradicts the PRD, keep the code and say so. If one of your own unit tests is wrong rather than the code, return the full corrected unit test script as unitScript and say why; otherwise leave unitScript out. " +
          `Return the full module. ${CODE_RULES} For unitScript: ${TEST_RULES}`,
        Fix,
      ),
      `fix${round}`,
      `${PRD}\n\nYour code:\n${code}\n\nThe acceptance test script:\n${script.script}\n\nThe acceptance test run:\n${reportOf(acceptance)}\n\nYour unit test script:\n${unit.script}\n\nThe unit test run:\n${reportOf(unitRun)}`,
      Fix,
      A,
    );
    const unitScriptChanged = Boolean(fix.unitScript && fix.unitScript.trim());
    fixes.push({ round, change: fix.change, ...(unitScriptChanged ? { unitScriptChanged } : {}) });
    code = pretty(fix.code, true);
    if (unitScriptChanged) unit.script = pretty(fix.unitScript!, false);
  }

  // Models sometimes return a whole module on one line. Reprint it readably (same meaning) before storing; the
  // recorder runs where esbuild is installed, and the server never loads this path.
  return BuildRecordingSchema.parse({
    id: spec.id,
    recordedAt: now().toISOString(),
    contract,
    calls,
    architecture: { draft: draft.text, review: renderReviewAs(archReview, "AR-"), final: archFinal.text, resolutions: resolutionsText(archFinal.resolutions) },
    code: { first: first.code, summary: first.summary, review: renderReviewAs(codeReview, "CR-"), revised: revised.code, resolutions: resolutionsText(revised.resolutions) },
    unitScript: unit.script,
    testCases: cases.cases,
    testScript: script.script,
    runs,
    fixes,
    finalCode: code,
    ...(diagram ? { diagram } : {}),
    ...(diagramIssues ? { diagramIssues } : {}),
  });
}

type ReviewAnswer = z.infer<typeof Review>;
function renumberAs(review: ReviewAnswer, prefix: string): ReviewAnswer {
  return { ...review, findings: review.findings.map((finding, index) => ({ ...finding, id: `${prefix}${index + 1}` })) };
}
function renderReviewAs(review: ReviewAnswer, prefix: string): string {
  return renderReview(review, "D-A").replace(/^D-A(\d+)/gm, `${prefix}$1`);
}

const BUILD_DIR = () => join(repoRoot(), "packages/studio/recordings/build");

export function buildRecordingFor(id: string, dir = BUILD_DIR()): BuildRecording | null {
  const path = join(dir, `${id}.json`);
  return existsSync(path) ? BuildRecordingSchema.parse(JSON.parse(readFileSync(path, "utf8"))) : null;
}
