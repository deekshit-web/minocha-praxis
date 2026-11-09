import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL, ClaudeModel, repoRoot, type CallRecord } from "@northwind/orchestrator";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { livePrdSeats, prdContext, runLivePrd } from "./live.ts";
import { FEATURE_B_BRIEF } from "./panels.ts";

/** Claude Opus 5 list prices per million tokens. A fallback model may bill differently. */
const PRICE = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

function cost(calls: CallRecord[]): number {
  const total = calls.reduce(
    (sum, call) =>
      sum +
      call.inputTokens * PRICE.input +
      call.outputTokens * PRICE.output +
      call.cacheReadTokens * PRICE.cacheRead +
      call.cacheWriteTokens * PRICE.cacheWrite,
    0,
  );
  return total / 1_000_000;
}

const model = new ClaudeModel(prdContext(FEATURE_B_BRIEF), livePrdSeats());
console.log(`Playing the Feature B PRD panel on ${CLAUDE_MODEL}: five calls, one at a time.`);
try {
  const result = await runLivePrd(model);
  const outDir = join(repoRoot(), "runs/live");
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `prd-${new Date().toISOString().replaceAll(":", "-")}.json`);
  writeFileSync(
    file,
    JSON.stringify({ model: CLAUDE_MODEL, brief: FEATURE_B_BRIEF, issues: result.issues, usage: model.calls, calls: result.calls, panel: result.panel }, null, 2),
  );
  for (const call of model.calls) {
    console.log(`  ${call.role.padEnd(12)} ${call.model}  in ${call.inputTokens}  out ${call.outputTokens}  cache read ${call.cacheReadTokens}`);
  }
  console.log(`Estimated cost at ${CLAUDE_MODEL} prices: $${cost(model.calls).toFixed(2)}`);
  console.log(result.issues.length === 0 ? "Every PRD gate passed." : `Gates refused the PRD:\n  ${result.issues.join("\n  ")}`);
  console.log(`Panel, prompts, and gate results saved to ${file}`);
  process.exitCode = result.issues.length === 0 ? 0 : 1;
} catch (error) {
  if (model.calls.length > 0) console.error(`Stopped after ${model.calls.length} call(s), about $${cost(model.calls).toFixed(2)}.`);
  if (error instanceof Anthropic.AuthenticationError) {
    console.error("Claude rejected the credentials. Set ANTHROPIC_API_KEY or run `ant auth login`.");
  } else if (error instanceof Anthropic.RateLimitError) {
    console.error("Rate limited by the Claude API. Try again shortly.");
  } else if (error instanceof Anthropic.APIError) {
    console.error(`Claude API error ${error.status}: ${error.message}`);
  } else if (error instanceof Anthropic.AnthropicError) {
    console.error(`${error.message}\nSet ANTHROPIC_API_KEY or run \`ant auth login\`.`);
  } else {
    console.error(error instanceof Error ? error.message : error);
    // The SDK reports missing credentials as a plain Error before any request is sent.
    if (model.calls.length === 0) console.error("No call reached Claude. To add credentials, set ANTHROPIC_API_KEY or run `ant auth login`.");
  }
  process.exitCode = 2;
}
