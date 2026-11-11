import { CLAUDE_MODEL, ClaudeModel, GROK_MODEL, GrokModel, type ModelProvider, type SeatSpec, callCost, repoRoot } from "@northwind/orchestrator";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import * as z from "zod/v4";
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

const Architecture = z.object({ text: z.string() });
const Revision = z.object({ text: z.string(), resolutions: z.array(z.object({ finding: z.string(), outcome: z.enum(["applied", "declined"]), note: z.string() })) });
const Code = z.object({ code: z.string(), summary: z.string() });
const CodeRevision = z.object({ code: z.string(), resolutions: z.array(z.object({ finding: z.string(), outcome: z.enum(["applied", "declined"]), note: z.string() })) });
const Script = z.object({ script: z.string() });
const Cases = z.object({ cases: z.array(z.string()) });
const Fix = z.object({ code: z.string(), change: z.string() });

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
  runs: z.array(z.object({ round: z.number(), code: z.string(), acceptance: z.string(), unit: z.string(), failing: z.number() })),
  fixes: z.array(z.object({ round: z.number(), change: z.string() })),
  finalCode: z.string(),
});
export type BuildRecording = z.infer<typeof BuildRecordingSchema>;

interface TestOutcome {
  results: Array<{ name: string; pass: boolean; message: string | null }>;
  error: string | null;
}

/**
 * Runs a test script against model-written code in a worker with a time and memory limit. The browser's
 * safety scan (public/tests.js) is applied first, so code that reaches for the network or globals never runs.
 */
export function sandboxRun(code: string, script: string, timeoutMs = 10_000): Promise<TestOutcome> {
  const testsUrl = pathToFileURL(join(repoRoot(), "packages/studio/public/tests.js")).href;
  const worker = new Worker(
    `const { parentPort, workerData } = require("node:worker_threads");
     import(workerData.testsUrl).then((m) => {
       try { parentPort.postMessage({ results: m.runRecorded(workerData.code, workerData.script), error: null }); }
       catch (error) { parentPort.postMessage({ results: [], error: String(error && error.message || error) }); }
     });`,
    { eval: true, workerData: { testsUrl, code, script }, resourceLimits: { maxOldGenerationSizeMb: 64 } },
  );
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve({ results: [], error: `timed out after ${timeoutMs / 1000} s` });
    }, timeoutMs);
    worker.once("message", (message: TestOutcome) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(message);
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      resolve({ results: [], error: error.message });
    });
  });
}

export function reportOf(outcome: TestOutcome): string {
  if (outcome.error && !outcome.results.length) return `✗ the tests could not run\n  ${outcome.error}`;
  const failing = outcome.results.filter((result) => !result.pass).length;
  const lines = outcome.results.map((result) => (result.pass ? `✓ ${result.name}` : `✗ ${result.name}\n  ${result.message}`));
  lines.push(failing ? `${failing} failing, ${outcome.results.length - failing} passing` : `${outcome.results.length} passing`);
  return lines.join("\n");
}

const failingOf = (outcome: TestOutcome) => (outcome.error && !outcome.results.length ? 1 : outcome.results.filter((result) => !result.pass).length);

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
export async function recordBuild(spec: WorkflowSpec, prd: string, seats: BuildSeats, now = () => new Date()): Promise<BuildRecording> {
  const contract = CONTRACTS[spec.id];
  if (!contract) throw new Error(`no contract for ${spec.id}`);
  const calls: RecordedCall[] = [];
  const ask = async <T>(seat: ModelProvider, role: string, prompt: string, schema: z.ZodType<T>, model: string): Promise<T> => {
    const started = Date.now();
    const answer = await seat.complete({ role: "analystA", prompt });
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
    return schema.parse(JSON.parse(answer.text));
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
  const PRD = `The approved PRD:\n${prd}\n\nThe module contract:\n${contract}`;
  const REVIEW = "Rate each finding P0 (would cause a wrong result, a broken rule or a security problem), P1 (should be fixed) or P2 (optional). Title in at most six words, explain in at most 50, quote the exact text at fault. At most four findings; return none rather than invent one. Name one strength.";
  const resolutionsText = (items: Array<{ finding: string; outcome: string; note: string }>) => items.map((item) => `${item.finding} ${item.outcome}: ${item.note}`).join("\n");

  // Architecture: Model A designs, Model B reviews, Model A revises.
  const draft = await ask(seats.a("Design how to build this: the components, the data, and the exact files that may change (the file fence). Plain text, at most 10 lines.", Architecture), "archDraft", PRD, Architecture, A);
  const archReview = renumberAs(await ask(seats.b(`Review this architecture against the PRD. ${REVIEW} Use ids AR-1, AR-2, ...`, Review), "archReview", `${PRD}\n\nThe architecture:\n${draft.text}`, Review, B), "AR-");
  const archFinal = await ask(seats.a("Revise the architecture to resolve every finding: apply it, or decline it with a reason. Plain text, at most 10 lines.", Revision), "archFinal", `${PRD}\n\nYour architecture:\n${draft.text}\n\nThe review:\n${renderReviewAs(archReview, "AR-")}`, Revision, A);

  // Code: Model A writes it; Model B reviews it; Model A applies or declines each point.
  const first = await ask(seats.a(`Write the module. ${CODE_RULES}`, Code), "code", `${PRD}\n\nThe architecture:\n${archFinal.text}`, Code, A);
  const codeReview = renumberAs(await ask(seats.b(`Review this code against the PRD and the contract. ${REVIEW} Use ids CR-1, CR-2, ...`, Review), "codeReview", `${PRD}\n\nThe code:\n${first.code}`, Review, B), "CR-");
  const revised = await ask(seats.a(`Apply the review points you agree with and decline the rest with a reason. Return the full revised module. ${CODE_RULES}`, CodeRevision), "codeRevise", `${PRD}\n\nYour code:\n${first.code}\n\nThe review:\n${renderReviewAs(codeReview, "CR-")}`, CodeRevision, A);

  // Tests: Model A's unit tests of its own code; Model B's cases and script from the PRD and contract only.
  const [unit, cases] = await Promise.all([
    ask(seats.a(`Write unit tests for your own module, at most 6 tests. ${TEST_RULES}`, Script), "unitTests", `${PRD}\n\nYour code:\n${revised.code}`, Script, A),
    ask(seats.b("Write the acceptance test cases for this feature from the PRD only: one line each, 'TC-n · <requirement> · <inputs> → <expected result>'. At most 8.", Cases), "testCases", PRD, Cases, B),
  ]);
  const script = await ask(seats.b(`Write the test script for these cases. You have never seen the code; work from the contract. ${TEST_RULES}`, Script), "testScript", `${PRD}\n\nThe test cases:\n${cases.cases.join("\n")}`, Script, B);

  // Run, and let Model A fix failures from the acceptance tests, up to two rounds.
  first.code = pretty(first.code, true);
  revised.code = pretty(revised.code, true);
  unit.script = pretty(unit.script, false);
  script.script = pretty(script.script, false);
  let code = revised.code;
  const runs: BuildRecording["runs"] = [];
  const fixes: BuildRecording["fixes"] = [];
  for (let round = 1; round <= 3; round += 1) {
    const [acceptance, unitRun] = await Promise.all([seats.run(code, script.script), seats.run(code, unit.script)]);
    runs.push({ round, code, acceptance: reportOf(acceptance), unit: reportOf(unitRun), failing: failingOf(acceptance) });
    if (!failingOf(acceptance) || round === 3) break;
    const fix = await ask(
      seats.a(`The acceptance tests below were written from the PRD by someone who never saw your code. Fix the code so it meets the PRD. If a test contradicts the PRD, keep the code and say so. Return the full module. ${CODE_RULES}`, Fix),
      `fix${round}`,
      `${PRD}\n\nYour code:\n${code}\n\nThe test script:\n${script.script}\n\nThe test run:\n${reportOf(acceptance)}`,
      Fix,
      A,
    );
    fixes.push({ round, change: fix.change });
    code = pretty(fix.code, true);
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
