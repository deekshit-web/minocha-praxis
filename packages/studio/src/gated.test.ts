import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider } from "@northwind/orchestrator";
import { type GatedProviders, runGated } from "./gated.ts";
import type { Recording } from "./record.ts";
import { loadSpecs } from "./workflows.ts";

const spec = loadSpecs(undefined, { recordings: false }).find((item) => item.id === "fmcg-document")!;
const call = (role: string, model: string, costUsd: number, seconds: number) => ({ role, model, seconds, inputTokens: 1000, outputTokens: 500, costUsd });
const recording: Recording = {
  id: spec.id,
  recordedAt: "2026-11-11T10:00:00Z",
  calls: [call("analystA", "claude-opus-5", 0.03, 15), call("analystB", "grok-4.7", 0.003, 50), call("critiqueOfB", "claude-opus-5", 0.04, 20), call("critiqueOfA", "grok-4.7", 0.003, 90), call("synthesizer", "claude-opus-5", 0.08, 30)],
  draftA: "Plan A.",
  draftB: "Plan B.",
  reviewOfA: { findings: [], strengths: "Good." },
  reviewOfB: { findings: [{ id: "D-B1", severity: "P1", title: "Missing week 4", detail: "Week 4 is not planned.", quote: "Plan B." }], strengths: "" },
  merge: { document: "Full merge.", keptFromA: "a", keptFromB: "b", resolutions: [{ finding: "D-B1", outcome: "fixed", note: "Added week 4." }] },
};

function providers(answers: Record<string, number>): GatedProviders & { asked: string[] } {
  const asked: string[] = [];
  const verdict = { findings: [{ id: "D-B1", version1: "addressed", version2: "addressed" }], errorsInVersion1: [], errorsInVersion2: [], preferred: "equal", reason: "Both fine." };
  const model = (text: string, name: string): ModelProvider => ({ mode: "live", complete: async () => ({ text, model: name, usage: { inputTokens: 900, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 } }) });
  return {
    asked,
    ask: async (_state, questions) => {
      asked.push(...Object.keys(questions));
      return { answers: Object.fromEntries(Object.keys(questions).map((key) => [key, key === "better" ? { type: "choice", choice: "B", probabilities: { A: 0.2, B: 0.8 } } : { type: "noul", noul: answers[key] ?? 0.5 }])), inputTokens: 400, ms: 200, model: "jev-1.14.0" };
    },
    cheapMerger: model(JSON.stringify({ document: "Cheap merge.", keptFromA: "a", keptFromB: "b", resolutions: [] }), "grok-4.7"),
    judges: { claude: model(JSON.stringify(verdict), "claude-opus-5"), grok: model(JSON.stringify(verdict), "grok-4.7") },
  };
}

test("a confident decider skips the slow review and hands a simple merge to the cheaper model", async () => {
  const p = providers({ complete: 0.9, mustFix: 0.9, simple: 0.85 });
  const result = await runGated(spec, recording, "medium", "FMCG", p);
  assert.equal(result.skippedReviewOfA, true);
  assert.equal(result.mergePath, "cheap-merge");
  assert.equal(result.gated.final, "Cheap merge.");
  assert.ok(result.gated.costUsd < result.full.costUsd);
  assert.ok(result.gated.seconds < result.full.seconds);
  assert.ok(result.judges, "different finals are judged");
});

test("an unsure decider falls back to the full path, and identical finals are not judged", async () => {
  const result = await runGated(spec, recording, "medium", "FMCG", providers({ complete: 0.6, mustFix: 0.62, simple: 0.55 }));
  assert.equal(result.skippedReviewOfA, false);
  assert.equal(result.mergePath, "full-merge");
  assert.equal(result.gated.final, "Full merge.");
  assert.equal(result.judges, null);
});

test("high-risk work never skips a review, and nothing to fix ships the better draft without a merge", async () => {
  const p = providers({ complete: 0.99, mustFix: 0.1 });
  const result = await runGated(spec, recording, "high", "FMCG", p);
  assert.equal(result.skippedReviewOfA, false);
  assert.ok(!p.asked.includes("complete"));
  assert.equal(result.mergePath, "pick-B");
  assert.equal(result.gated.final, "Plan B.");
});
