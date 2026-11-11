// Runs the PRD panel eval. One invocation runs one part and one variant:
//   npm run eval-prd -- --part a --variant baseline --reps 2
//   npm run eval-prd -- --part b --variant v3 --cases B01
//   npm run eval-prd -- --part a --summarize
// Properties carried over from the eval guide's runner scaffold: rows written as cases finish, resume at
// (case, rep), failed attempts in errors.jsonl with a failure class and their billed usage, jittered backoff on
// transient errors, a hard per-case wall-clock ceiling, a served-model check on every call, and a harness gate
// that refuses to spend until a person approves the harness with --approve-harness.
import { PanelCallError, repoRoot, type Prd } from "@northwind/orchestrator";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { evalBriefs, plantedCases, type EvalBrief, type PlantedCase } from "./evalCases.ts";
import {
  PART_A_REVIEWERS,
  PART_B_SETUPS,
  assertServedModels,
  gradeBrief,
  gradePlanted,
  liveModels,
  runBrief,
  runPlanted,
  type EvalCall,
  type EvalModels,
  type PartBVariant,
} from "./evalRun.ts";

interface Args {
  part: "a" | "b";
  variant: string;
  reps: number;
  concurrency: number;
  timeoutS: number;
  cases: string[] | null;
  approveHarness: boolean;
  summarize: boolean;
  graderCheck: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    part: "a",
    variant: "baseline",
    reps: 1,
    concurrency: 4,
    timeoutS: 3600,
    cases: null,
    approveHarness: false,
    summarize: false,
    graderCheck: false,
  };
  const value = (index: number) => {
    const next = argv[index];
    if (next === undefined) throw new Error(`missing value for ${argv[index - 1]}`);
    return next;
  };
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (key === "--part") args.part = value(++index) === "b" ? "b" : "a";
    else if (key === "--variant") args.variant = value(++index);
    else if (key === "--reps") args.reps = Number(value(++index));
    else if (key === "--concurrency") args.concurrency = Number(value(++index));
    else if (key === "--timeout-s") args.timeoutS = Number(value(++index));
    else if (key === "--cases") args.cases = value(++index).split(",").map((item) => item.trim());
    else if (key === "--approve-harness") args.approveHarness = true;
    else if (key === "--summarize") args.summarize = true;
    else if (key === "--grader-check") args.graderCheck = true;
    else throw new Error(`unknown argument: ${key}`);
  }
  const allowed = args.part === "a" ? Object.keys(PART_A_REVIEWERS) : Object.keys(PART_B_SETUPS);
  if (!args.summarize && !allowed.includes(args.variant)) throw new Error(`--variant for part ${args.part} must be one of ${allowed.join(", ")}`);
  if (!Number.isInteger(args.reps) || args.reps < 1 || !Number.isInteger(args.concurrency) || args.concurrency < 1) throw new Error("bad --reps or --concurrency");
  return args;
}

const flowDir = (part: "a" | "b") => join(repoRoot(), ".claude/hillclimb", part === "a" ? "prd-planted" : "prd-briefs");

/** sha256 over the harness files listed in _state.json. Spending waits until a person has approved this sha. */
function checkHarness(statePath: string, approve: boolean): void {
  const state = JSON.parse(readFileSync(statePath, "utf8")) as { harness_paths?: string[]; harness_sha?: string };
  const paths = [...new Set((state.harness_paths ?? []).map((item) => resolve(repoRoot(), item)))].sort();
  const hash = createHash("sha256");
  for (const path of paths) hash.update(relative(repoRoot(), path)).update("\0").update(readFileSync(path)).update("\0");
  const sha = hash.digest("hex");
  if (state.harness_sha === sha) return;
  if (approve) {
    writeFileSync(statePath, JSON.stringify({ ...state, harness_sha: sha }, null, 2) + "\n");
    console.error(`harness approved: sha256 ${sha.slice(0, 12)} over ${paths.length} file(s)`);
    return;
  }
  console.error(
    state.harness_sha
      ? `harness changed since it was approved (${state.harness_sha.slice(0, 12)} -> ${sha.slice(0, 12)}). Review the diff, then re-run with --approve-harness.`
      : `no approved harness yet (sha ${sha.slice(0, 12)} over ${paths.length} file(s)). Review the harness, then run once with --approve-harness.`,
  );
  process.exit(2);
}

function failureClass(error: unknown): string {
  const cause = error instanceof PanelCallError ? error.cause : error;
  const own = (cause as { failure_class?: string } | null)?.failure_class ?? (error as { failure_class?: string } | null)?.failure_class;
  if (own) return own;
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/^model-refused/.test(message)) return "refusal";
  if (/^model-truncated/.test(message)) return "truncated";
  if (/^model-unparsed/.test(message)) return "unparsed";
  if (/wall-clock/.test(message)) return "timeout";
  return "error";
}

function transient(error: unknown): boolean {
  const cause = error instanceof PanelCallError ? error.cause : error;
  const status = (cause as { status?: number } | null)?.status;
  const message = cause instanceof Error ? cause.message : String(cause);
  return status === 429 || status === 529 || (status !== undefined && status >= 500 && status < 600) || /xai-error (429|5\d\d)|overloaded|rate.?limit/i.test(message);
}

async function withBackoff<T>(run: () => Promise<T>, retries: { count: number }, deadline: number, tries = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (Date.now() >= deadline) throw Object.assign(new Error("wall-clock ceiling reached before an attempt"), { failure_class: "timeout" });
    try {
      return await run();
    } catch (error) {
      if (!transient(error) || attempt >= tries - 1) throw error;
      const delay = Math.min(60_000, 1000 * 2 ** attempt) * (0.5 + Math.random());
      if (Date.now() + delay >= deadline) throw error;
      retries.count++;
      await new Promise((done) => setTimeout(done, delay));
    }
  }
}

function withCeiling<T>(work: Promise<T>, seconds: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const ceiling = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${label}: exceeded the ${seconds}s wall-clock ceiling`), { failure_class: "timeout" })), seconds * 1000);
  });
  return Promise.race([work, ceiling]).finally(() => clearTimeout(timer));
}

/** Token totals in the API's field names, for the report; app calls and jury calls are kept apart. */
function usageOf(calls: EvalCall[]) {
  const sum = (pick: (call: EvalCall) => number) => calls.reduce((total, call) => total + pick(call), 0);
  return {
    input_tokens: sum((call) => call.metric.usage?.inputTokens ?? 0),
    output_tokens: sum((call) => call.metric.usage?.outputTokens ?? 0),
    cache_read_input_tokens: sum((call) => call.metric.usage?.cacheReadTokens ?? 0),
    cache_creation_input_tokens: sum((call) => call.metric.usage?.cacheWriteTokens ?? 0),
  };
}

function costOf(calls: EvalCall[]): number | null {
  return calls.some((call) => call.metric.costUsd === null) ? null : calls.reduce((total, call) => total + (call.metric.costUsd ?? 0), 0);
}

interface Task {
  id: string;
  rep: number;
  planted?: PlantedCase;
  brief?: EvalBrief;
}

async function runTask(task: Task, args: Args, models: EvalModels, refDir: string) {
  const calls: EvalCall[] = [];
  if (task.planted) {
    const run = await runPlanted(task.planted, args.variant as keyof typeof PART_A_REVIEWERS, models);
    calls.push(...run.calls);
    const appCalls = [...calls];
    assertServedModels(appCalls);
    const judged = await gradePlanted(task.planted, run.output as Parameters<typeof gradePlanted>[1], models, calls);
    return { run, appCalls, judgeCalls: calls.slice(appCalls.length), judged };
  }
  const brief = task.brief as EvalBrief;
  const run = await runBrief(brief, args.variant as PartBVariant, models);
  calls.push(...run.calls);
  const appCalls = [...calls];
  assertServedModels(appCalls);
  const refPath = join(refDir, `${task.id}.json`);
  const reference = args.variant === "baseline" ? null : (JSON.parse(readFileSync(refPath, "utf8")) as Prd);
  const judged = await gradeBrief(brief, run.output as Prd, reference, models, calls);
  if (args.variant === "baseline" && !existsSync(refPath)) {
    mkdirSync(refDir, { recursive: true });
    writeFileSync(refPath, JSON.stringify(run.output, null, 2));
  }
  return { run, appCalls, judgeCalls: calls.slice(appCalls.length), judged };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const flow = flowDir(args.part);
  if (args.summarize) return summarize(args.part, flow);
  const statePath = join(flow, "_state.json");
  checkHarness(statePath, args.approveHarness);
  if (args.approveHarness) return;
  if (args.graderCheck) return graderCheck();

  const variantDir = join(flow, args.variant);
  const refDir = join(flow, "baseline", "ref");
  mkdirSync(join(variantDir, "traces"), { recursive: true });
  const resultsPath = join(variantDir, "results.jsonl");
  const errorsPath = join(variantDir, "errors.jsonl");
  const done = new Set<string>();
  if (existsSync(resultsPath)) {
    for (const line of readFileSync(resultsPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as { prompt_id: string; rep: number };
        done.add(`${row.prompt_id}\0${row.rep}`);
      } catch {
        continue;
      }
    }
  }
  const pool: Task[] =
    args.part === "a"
      ? plantedCases().map((planted) => ({ id: planted.id, rep: 0, planted }))
      : evalBriefs().map((brief) => ({ id: brief.id, rep: 0, brief }));
  const chosen = args.cases ? pool.filter((task) => args.cases?.includes(task.id)) : pool;
  if (args.cases && chosen.length !== args.cases.length) throw new Error(`unknown case id in --cases ${args.cases.join(",")}`);
  if (args.part === "b" && args.variant !== "baseline") {
    const missing = chosen.filter((task) => !existsSync(join(refDir, `${task.id}.json`))).map((task) => task.id);
    if (missing.length) throw new Error(`run the baseline first: no frozen single-draft reference for ${missing.join(", ")}`);
  }
  const tasks = chosen.flatMap((task) => Array.from({ length: args.reps }, (_, rep) => ({ ...task, rep }))).filter((task) => !done.has(`${task.id}\0${task.rep}`));
  console.error(`[part ${args.part} · ${args.variant}] ${tasks.length} (case, rep) to run`);

  const models = liveModels();
  let next = 0;
  let ok = 0;
  let failed = 0;
  async function worker() {
    while (next < tasks.length) {
      const task = tasks[next++] as Task;
      const started = Date.now();
      const deadline = args.timeoutS > 0 ? started + args.timeoutS * 1000 : Infinity;
      const retries = { count: 0 };
      try {
        const { run, appCalls, judgeCalls, judged } = await withCeiling(
          withBackoff(() => runTask(task, args, models, refDir), retries, deadline),
          args.timeoutS,
          `${task.id} rep${task.rep}`,
        );
        const row = {
          prompt_id: task.id,
          rep: task.rep,
          prompt: task.planted ? task.planted.notice : task.brief?.brief,
          tags: task.planted ? [task.planted.kind, task.planted.defect] : [task.brief?.topic ?? ""],
          model: [...new Set(appCalls.map((call) => call.metric.model))].join(" + "),
          usage: usageOf(appCalls),
          stop_reason: "end_turn",
          status: "ok",
          judge_model: [...new Set(judgeCalls.map((call) => call.metric.model))].join(" + "),
          judge_usage: usageOf(judgeCalls),
          cost_usd: costOf(appCalls),
          judge_cost_usd: costOf(judgeCalls),
          latency_s: appCalls.reduce((total, call) => total + call.metric.durationMs, 0) / 1000,
          calls: appCalls.length,
          setup: args.part === "a" ? `reviewer: ${PART_A_REVIEWERS[args.variant as keyof typeof PART_A_REVIEWERS]}` : PART_B_SETUPS[args.variant as PartBVariant],
          meta: retries.count ? { retries: retries.count } : undefined,
          grade: judged.grade,
          explanation: judged.explanation,
        };
        appendFileSync(resultsPath, JSON.stringify(row) + "\n");
        writeFileSync(join(variantDir, "traces", `${task.id}_rep${task.rep}.json`), JSON.stringify(run.transcript, null, 2));
        ok++;
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        appendFileSync(
          errorsPath,
          JSON.stringify({
            prompt_id: task.id,
            rep: task.rep,
            failure_class: failureClass(error),
            error: message,
            retries: retries.count,
            latency_s: (Date.now() - started) / 1000,
          }) + "\n",
        );
        console.error(`  ${task.id} rep${task.rep} FAILED (${failureClass(error)}): ${message}`);
      }
      console.error(`  [${args.variant}] ${ok + failed}/${tasks.length} done (${ok} ok, ${failed} failed)`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(args.concurrency, Math.max(1, tasks.length)) }, worker));
  console.error(`[part ${args.part} · ${args.variant}] ${ok} ok, ${failed} failed -> ${relative(repoRoot(), resultsPath)}`);
  process.exitCode = failed ? 1 : 0;
}

/**
 * The jury must score a review that names the planted defect as detected, and an empty review or one raising a
 * different concern as not detected. Six small judge calls; run it before trusting the jury's numbers.
 */
async function graderCheck() {
  const planted = plantedCases().find((item) => item.id === "A01") as PlantedCase;
  const models = liveModels();
  const critique = (defects: Array<{ id: string; severity: "P0" | "P1"; code: "OTHER"; point: string }>) => ({
    of: "A" as const,
    author: "B" as const,
    strengths: [],
    defects,
    adopt: [],
    reject: [],
    attributes: [],
  });
  const probes = [
    { name: "oracle (names the defect)", expect: 1, review: critique([{ id: "D-1", severity: "P0", code: "OTHER", point: planted.notice }]) },
    { name: "null (no defects)", expect: 0, review: critique([]) },
    {
      name: "wrong concern",
      expect: 0,
      review: critique([{ id: "D-1", severity: "P0", code: "OTHER", point: "REQ-6's accessible name for the ready control is too long for a screen reader." }]),
    },
  ];
  let failures = 0;
  for (const probe of probes) {
    const calls: EvalCall[] = [];
    const graded = await gradePlanted(planted, probe.review, models, calls);
    const ok = graded.grade.detected === probe.expect;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${probe.name}: detected ${graded.grade.detected} (expected ${probe.expect}) · ${money(calls.map((call) => call.metric.costUsd))}`);
    console.log(`      ${(graded.explanation.detected ?? "").replaceAll("\n", "\n      ")}`);
  }
  process.exitCode = failures ? 1 : 0;
}

interface Row {
  prompt_id: string;
  rep: number;
  tags: string[];
  cost_usd: number | null;
  judge_cost_usd: number | null;
  latency_s: number;
  grade: Record<string, number>;
}

function rows(flow: string, variant: string): Row[] {
  const path = join(flow, variant, "results.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Row);
}

/** Mean with a 95% interval (normal approximation); fine for a first read at this size, labelled as such. */
function meanCi(values: number[]): string {
  if (values.length === 0) return "-";
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.length > 1 ? values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1) : 0;
  const half = 1.96 * Math.sqrt(variance / values.length);
  return `${(mean * 100).toFixed(0)}% ±${(half * 100).toFixed(0)} (n=${values.length})`;
}

function money(values: Array<number | null>): string {
  if (values.length === 0) return "-";
  return values.some((value) => value === null) ? "price unknown" : `$${values.reduce<number>((total, value) => total + (value ?? 0), 0).toFixed(2)}`;
}

function summarize(part: "a" | "b", flow: string) {
  const errorsOf = (variant: string) => {
    const path = join(flow, variant, "errors.jsonl");
    return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((line) => line.trim()).length : 0;
  };
  if (part === "a") {
    const claude = rows(flow, "baseline");
    const grok = rows(flow, "v1");
    const seeded = (list: Row[]) => list.filter((row) => row.tags[0] === "seeded");
    const clean = (list: Row[]) => list.filter((row) => row.tags[0] === "clean");
    const either = seeded(claude).flatMap((row) => {
      const other = seeded(grok).find((item) => item.prompt_id === row.prompt_id && item.rep === row.rep);
      return other ? [Math.max(row.grade.detected ?? 0, other.grade.detected ?? 0)] : [];
    });
    console.log("Part A: did the review catch the planted defect? (interval: normal approximation)");
    for (const [label, list, variant] of [["Claude reviews", claude, "baseline"], ["Grok reviews", grok, "v1"]] as const) {
      console.log(
        `  ${label.padEnd(15)} detected ${meanCi(seeded(list).map((row) => row.grade.detected ?? 0))}` +
          ` · as P0 ${meanCi(seeded(list).map((row) => row.grade.detected_p0 ?? 0))}` +
          ` · P0 alarms on clean drafts ${clean(list).reduce((total, row) => total + (row.grade.p0_raised ?? 0), 0)} over ${clean(list).length}` +
          ` · ${money(list.map((row) => row.cost_usd))} + jury ${money(list.map((row) => row.judge_cost_usd))} · ${errorsOf(variant)} not scored`,
      );
    }
    console.log(`  ${"Either reviewer".padEnd(15)} detected ${meanCi(either)}`);
    return;
  }
  console.log("Part B: final PRD quality per setup (interval: normal approximation)");
  for (const [variant, label] of Object.entries(PART_B_SETUPS)) {
    const list = rows(flow, variant);
    if (list.length === 0) continue;
    console.log(
      `  ${label.padEnd(44)} checklist ${meanCi(list.map((row) => row.grade.checklist ?? 0))}` +
        ` · gates pass ${meanCi(list.map((row) => row.grade.gates_pass ?? 0))}` +
        (variant === "baseline" ? "" : ` · beats single draft ${meanCi(list.map((row) => row.grade.win_vs_single ?? 0.5))}`) +
        ` · ${money(list.map((row) => row.cost_usd))} + jury ${money(list.map((row) => row.judge_cost_usd))}` +
        ` · ${(list.reduce((total, row) => total + row.latency_s, 0) / list.length / 60).toFixed(1)} min/brief · ${errorsOf(variant)} not scored`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
