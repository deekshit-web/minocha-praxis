import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CompletionError, GROK_MODEL, callCost, repoRoot } from "@northwind/orchestrator";
import type * as z from "zod/v4";
import { ACCEPTANCE_CASES_PROMPT, ACCEPTANCE_SCRIPT_PROMPT, Cases, Script, liveBuildSeats } from "./build.ts";
import { specFor } from "./live.ts";
import { panelContext } from "./record.ts";
import { DOMAINS, type DomainId } from "./workflows.ts";

/**
 * `npm run acceptance-eval -- [--run=evals/live-build] [--variants=before,after] [--samples=2] [--cap=1.00]`: re-runs
 * only Model B's two test steps (the cases, then the script) on a run's ten live builds (<run>/records/), on the same
 * PRD and contract the build gave Model B, with each prompt named: "before" (the first run's), "after" (13 November,
 * which the second run's builds used) and "current" (ACCEPTANCE_CASES_PROMPT as it is now). Each answer is saved to
 * <run>/acceptance-prompt/<build>.<variant>.<n>.json, and a saved answer is not asked again, so a run can be resumed.
 * Spends real money on Model B (about $0.007 a call); stops before the cap.
 */

// The prompts the ten live builds were recorded with, kept to compare against.
const BEFORE_CASES = "Write the acceptance test cases for this feature from the PRD only: one line each, 'TC-n · <requirement> · <inputs> → <expected result>'. At most 8.";
const TEST_RULES =
  "Write the body of a test script. It may call test(name, fn) and assert.equal(actual, expected), assert.deepEqual, assert.ok, assert.match(text, regex), assert.throws(fn, regex). " +
  "The module under test is `code`. No imports, require, network, timers or globals. Each test name says what it checks in plain words.";
const BEFORE_SCRIPT = `Write the test script for these cases. You have never seen the code; work from the contract. ${TEST_RULES}`;
// The prompt of 13 November, which the second run's builds used, kept to compare against.
const AFTER_CASES =
  "Write the acceptance test cases for this feature from the PRD only: one line each, 'TC-n · <requirement> · <inputs> → <expected result>'. At most 16. " +
  "Cover every requirement and acceptance criterion, then the edges where code usually goes wrong: for each limit or threshold, the value exactly at it and one step on either side; " +
  "zero, one and the smallest allowed value; an empty list and a single item; an item a rule picks out being first, in the middle and last; " +
  "for dates, the 1st and the last day of a month, December and January, and a leap day; and one case for each error the PRD names. " +
  "Choose input values so that a plausible mistake gives a different answer: avoid values where, for example, dropping the wrong item or rounding the other way happens to give the same result. " +
  "Work out every expected result exactly from the PRD, showing the arithmetic briefly where it is not obvious. Do not test behaviour the PRD leaves open.";
const VARIANTS = {
  before: [BEFORE_CASES, BEFORE_SCRIPT],
  after: [AFTER_CASES, ACCEPTANCE_SCRIPT_PROMPT],
  current: [ACCEPTANCE_CASES_PROMPT, ACCEPTANCE_SCRIPT_PROMPT],
} as const;
type Variant = keyof typeof VARIANTS;

const args = process.argv.slice(2);
const samples = Number(args.find((arg) => arg.startsWith("--samples="))?.split("=")[1] ?? 2);
const cap = Number(args.find((arg) => arg.startsWith("--cap="))?.split("=")[1] ?? 1);
const chosen = (args.find((arg) => arg.startsWith("--variants="))?.split("=")[1] ?? "before,after").split(",") as Variant[];
for (const variant of chosen) if (!(variant in VARIANTS)) throw new Error(`unknown variant ${variant}; use ${Object.keys(VARIANTS).join(", ")}`);
const root = repoRoot();
const runDir = resolve(root, args.find((arg) => arg.startsWith("--run="))?.split("=")[1] ?? "evals/live-build");
const recordsDir = join(runDir, "records");
const outDir = join(runDir, "acceptance-prompt");
mkdirSync(outDir, { recursive: true });
const briefs = JSON.parse(readFileSync(join(runDir, "briefs.json"), "utf8")) as Array<{ id: string; domain: DomainId; brief: string; facts?: string }>;

// Every failed attempt is logged with its variant, so the prompts' failure rates can be compared too: a failure here
// would fail the same step of a real build. Failed calls that were charged count towards the cap.
const failuresPath = join(outDir, "failures.jsonl");
let spent = 0;
for (const file of readdirSync(outDir).filter((name) => name.endsWith(".json"))) spent += JSON.parse(readFileSync(join(outDir, file), "utf8")).costUsd ?? 0;
if (existsSync(failuresPath)) for (const line of readFileSync(failuresPath, "utf8").split("\n").filter(Boolean)) spent += JSON.parse(line).costUsd ?? 0;
console.log(`Already spent on earlier answers: $${spent.toFixed(3)}. Cap for this run: $${cap.toFixed(2)} in all.`);

interface Job {
  build: string;
  variant: Variant;
  n: number;
  context: string;
  prd: string;
}
const jobs: Job[] = [];
for (const file of readdirSync(recordsDir).filter((name) => name.endsWith(".json")).sort()) {
  const id = file.replace(/\.json$/, "");
  const record = JSON.parse(readFileSync(join(recordsDir, file), "utf8"));
  const brief = briefs.find((item) => item.id === id);
  if (!brief) throw new Error(`no brief for ${id}`);
  const spec = specFor({ domain: brief.domain, kind: "build", brief: brief.brief, facts: brief.facts }, id);
  const domain = DOMAINS.find((item) => item.id === brief.domain)?.name ?? brief.domain;
  const prdText = record.panel.finalFix?.document ?? record.panel.merge.document;
  // Exactly what recordBuild gives Model B.
  const prd = `The approved PRD:\n${prdText}\n\nThe module contract:\n${record.build.contract}`;
  for (const variant of chosen) {
    for (let n = 1; n <= samples; n += 1) jobs.push({ build: id, variant, n, context: panelContext(spec, domain), prd });
  }
}

async function ask<T>(context: string, instructions: string, schema: z.ZodType<T>, prompt: string): Promise<{ value: T; costUsd: number; seconds: number }> {
  const started = Date.now();
  const answer = await liveBuildSeats(context).b(instructions, schema).complete({ role: "analystA", prompt }).catch((error: unknown) => {
    const charged = error instanceof CompletionError ? (error.costUsd ?? callCost(GROK_MODEL, error.usage) ?? 0) : 0;
    spent += charged;
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { charged });
  });
  const usage = answer.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const costUsd = answer.costUsd ?? callCost(GROK_MODEL, usage) ?? 0;
  spent += costUsd;
  return { value: schema.parse(JSON.parse(answer.text)), costUsd, seconds: Math.round((Date.now() - started) / 100) / 10 };
}

async function runJob(job: Job): Promise<void> {
  const path = join(outDir, `${job.build}.${job.variant}.${job.n}.json`);
  if (existsSync(path)) return;
  if (spent >= cap) return console.log(`${job.build} ${job.variant} ${job.n}: skipped, the cap of $${cap.toFixed(2)} is reached`);
  const [casesPrompt, scriptPrompt] = VARIANTS[job.variant];
  try {
    const cases = await ask(job.context, casesPrompt, Cases, job.prd);
    const script = await ask(job.context, scriptPrompt, Script, `${job.prd}\n\nThe test cases:\n${cases.value.cases.join("\n")}`);
    const saved = { build: job.build, variant: job.variant, n: job.n, model: GROK_MODEL, recordedAt: new Date().toISOString(), cases: cases.value.cases, script: script.value.script, costUsd: cases.costUsd + script.costUsd, seconds: cases.seconds + script.seconds };
    writeFileSync(path, `${JSON.stringify(saved, null, 2)}\n`);
    console.log(`${job.build} ${job.variant} ${job.n}: ${saved.cases.length} cases, $${saved.costUsd.toFixed(4)}, ${saved.seconds} s`);
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 200) : String(error);
    const charged = (error as { charged?: number }).charged ?? 0;
    appendFileSync(failuresPath, `${JSON.stringify({ build: job.build, variant: job.variant, n: job.n, at: new Date().toISOString(), reason, costUsd: charged })}\n`);
    console.log(`${job.build} ${job.variant} ${job.n}: FAILED ${reason}`);
  }
}

// Six at a time.
const queue = [...jobs];
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let job = queue.shift(); job; job = queue.shift()) await runJob(job);
}));
console.log(`Spent in all: $${spent.toFixed(3)}.`);
