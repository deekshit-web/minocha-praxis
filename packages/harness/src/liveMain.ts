import Anthropic from "@anthropic-ai/sdk";
import {
  CLAUDE_MODEL,
  ClaudeModel,
  GROK_MODEL,
  GrokModel,
  PanelCallError,
  ResumingProvider,
  SeatRouter,
  repoRoot,
  type CallMetric,
  type ModelProvider,
  type PanelRole,
} from "@northwind/orchestrator";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { livePrdSeats, prdContext, runLivePrd, type SavedLiveRun } from "./live.ts";
import { FEATURE_B_BRIEF } from "./panels.ts";

function dollars(metrics: CallMetric[]): string {
  if (metrics.some((metric) => metric.costUsd === null)) return "unknown (a fallback model has no listed price)";
  return `$${metrics.reduce((sum, metric) => sum + (metric.costUsd ?? 0), 0).toFixed(2)}`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function save(run: SavedLiveRun): string {
  const outDir = join(repoRoot(), "runs/live");
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `prd-${run.startedAt.replaceAll(":", "-")}.json`);
  writeFileSync(file, JSON.stringify(run, null, 2));
  return file;
}

/** `--resume <file>` continues a failed run: its finished seats are replayed, only the rest are paid for. */
function resumeFrom(): { file: string; run: SavedLiveRun } | null {
  const flag = process.argv.indexOf("--resume");
  if (flag === -1) return null;
  const path = process.argv[flag + 1];
  if (!path) throw new Error("--resume needs the path of a saved run under runs/live/.");
  const run = JSON.parse(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), path), "utf8")) as SavedLiveRun;
  if (!run.failure || !run.answers?.length) throw new Error(`${path} is not a failed run with saved answers.`);
  return { file: basename(path), run };
}

const startedAt = new Date().toISOString();
const started = performance.now();
const resume = resumeFrom();
/**
 * Two different models draft and critique each other: analyst B, and its critique of A, run on Grok.
 * Without an xAI key every seat runs on Claude, and the run says so.
 */
const context = prdContext(FEATURE_B_BRIEF);
const claude = new ClaudeModel(context, livePrdSeats());
const grok = process.env.XAI_API_KEY ? new GrokModel(context, livePrdSeats()) : null;
const seats: Record<PanelRole, string> = {
  analystA: CLAUDE_MODEL,
  analystB: grok ? GROK_MODEL : CLAUDE_MODEL,
  critiqueOfA: grok ? GROK_MODEL : CLAUDE_MODEL,
  critiqueOfB: CLAUDE_MODEL,
  synthesizer: CLAUDE_MODEL,
};
const routed = grok
  ? new SeatRouter({ analystA: claude, analystB: grok, critiqueOfA: grok, critiqueOfB: claude, synthesizer: claude })
  : claude;
const model: ModelProvider = resume ? new ResumingProvider(resume.run.answers ?? [], routed) : routed;
const lineup = [...new Set(Object.values(seats))].join(" + ");
console.log(resume ? `Resuming ${resume.file}: replaying ${resume.run.answers?.length} finished seat(s).` : "Playing the Feature B PRD panel: five calls, one at a time.");
for (const [role, seatModel] of Object.entries(seats)) console.log(`  ${role.padEnd(12)} ${seatModel}`);
if (!grok) console.log("XAI_API_KEY is not set, so both analysts run on Claude.");
try {
  const result = await runLivePrd(model);
  const file = save({
    format: 2,
    model: lineup,
    brief: FEATURE_B_BRIEF,
    startedAt,
    durationMs: result.durationMs,
    metrics: result.metrics,
    resumedFrom: resume?.file,
    issues: result.issues,
    quality: result.quality,
    calls: result.calls,
    panel: result.panel,
  });
  for (const metric of result.metrics) {
    const usage = metric.usage;
    const quality = result.quality[metric.role];
    console.log(
      `  ${metric.role.padEnd(12)} ${metric.source === "resumed" ? "resumed" : metric.model ?? "?"}  ${seconds(metric.durationMs)}  in ${usage?.inputTokens ?? 0}  out ${usage?.outputTokens ?? 0}  cache read ${usage?.cacheReadTokens ?? 0}  ${quality.verdict}: ${quality.summary}`,
    );
  }
  console.log(`Run took ${seconds(result.durationMs)}. Cost at list prices: ${dollars(result.metrics)}`);
  console.log(result.issues.length === 0 ? "Every PRD gate passed." : `Gates refused the PRD:\n  ${result.issues.join("\n  ")}`);
  console.log(`Panel, prompts, timing and gate results saved to ${file}`);
  process.exitCode = result.issues.length === 0 ? 0 : 1;
} catch (error) {
  const metrics = error instanceof PanelCallError ? error.metrics : [];
  const answers = error instanceof PanelCallError ? error.answers : [];
  const cause = error instanceof PanelCallError ? error.cause : error;
  const message = cause instanceof Error ? cause.message : String(cause);
  if (metrics.length > 0) {
    const file = save({
      format: 2,
      model: lineup,
      brief: FEATURE_B_BRIEF,
      startedAt,
      durationMs: performance.now() - started,
      metrics,
      failure: message,
      answers,
      resumedFrom: resume?.file,
    });
    console.error(`Stopped after ${metrics.length} call(s), ${dollars(metrics)} billed. Saved to ${file}`);
    if (answers.length > 0) console.error(`Continue without paying for the finished seats: npm run live-prd -- --resume ${file}`);
  }
  if (cause instanceof Anthropic.AuthenticationError) {
    console.error("Claude rejected the credentials. Set ANTHROPIC_API_KEY or run `ant auth login`.");
  } else if (cause instanceof Anthropic.RateLimitError) {
    console.error("Rate limited by the Claude API. Try again shortly.");
  } else if (cause instanceof Anthropic.APIError) {
    console.error(`Claude API error ${cause.status}: ${cause.message}`);
  } else {
    console.error(message);
    // The SDK reports missing credentials as a plain Error before any request is sent.
    if (metrics.length === 0 && !(cause instanceof Anthropic.AnthropicError)) {
      console.error("If no call reached Claude, add credentials: set ANTHROPIC_API_KEY or run `ant auth login`.");
    }
  }
  process.exitCode = 2;
}
