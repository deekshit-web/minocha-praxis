import assert from "node:assert/strict";
import test from "node:test";
import type { CompletionRequest, ModelProvider } from "@northwind/orchestrator";
import { GROK_USD_PER_SECOND, panelContext, recordPanel, recordingFor, renderMerge, renderReview, withGrokReasoning } from "./record.ts";
import { loadSpecs } from "./workflows.ts";

const spec = loadSpecs(undefined, { recordings: false }).find((item) => item.id === "fmcg-document")!;

function fake(answers: Record<string, unknown>, model: string): ModelProvider & { prompts: CompletionRequest[] } {
  const prompts: CompletionRequest[] = [];
  return {
    mode: "live",
    prompts,
    async complete(request) {
      prompts.push(request);
      return { text: JSON.stringify(answers[request.role]), model, usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    },
  };
}

test("The panel context contains the facts. It does not contain the prepared drafts or reviews.", () => {
  const context = panelContext(spec, "FMCG");
  assert.match(context, /SKU-5502/);
  assert.match(context, /35%/);
  assert.doesNotMatch(context, /4\.20|Clinically proven|D-A1/);
});

test("A recording runs the drafts, the crossed reviews and the merge. It renumbers the findings. It gives a price to each call.", async () => {
  const review = { findings: [{ id: "x", severity: "P0", title: "Breaks the floor", detail: "21.4% is below 35%.", quote: "30% off" }], strengths: "Clear." };
  const claude = fake({ analystA: { text: "A plan." }, critiqueOfB: { findings: [], strengths: "Fine." }, synthesizer: { document: "Final.", keptFromA: "a", keptFromB: "b", resolutions: [{ finding: "D-A1", outcome: "fixed", note: "15% off." }] } }, "claude-opus-5");
  const grok = fake({ analystB: { text: "B plan." }, critiqueOfA: review }, "grok-4.7");
  const recording = await recordPanel(spec, { claude, grok }, () => new Date("2026-11-11T10:00:00Z"));
  assert.equal(recording.calls.length, 5);
  assert.equal(recording.reviewOfA.findings[0]?.id, "D-A1");
  assert.ok(recording.calls.every((call) => call.costUsd > 0));
  assert.match(claude.prompts.find((prompt) => prompt.role === "critiqueOfB")?.prompt ?? "", /B plan\./);
  assert.match(grok.prompts.find((prompt) => prompt.role === "critiqueOfA")?.prompt ?? "", /A plan\./);
  assert.match(renderReview(recording.reviewOfA, "D-A"), /^D-A1 · P0 · Breaks the floor$/m);
  assert.match(renderReview(recording.reviewOfB, "D-B"), /No defects found/);
  assert.match(renderMerge(recording.merge, 1), /Fixed D-A1: 15% off\.\nDefects resolved: 1 of 1\./);
});

test("In the final check, Model B reviews the merged document. Model A makes a fix only when Model B raises a finding.", async () => {
  const merge = { document: "Final, with 18% less trial.", keptFromA: "a", keptFromB: "b", resolutions: [] };
  const claude = fake({ analystA: { text: "A plan." }, critiqueOfB: { findings: [], strengths: "Fine." }, synthesizer: merge }, "claude-opus-5");
  const raised = { findings: [{ id: "x", severity: "P0", title: "Wrong trial figure", detail: "It is 15.3%.", quote: "18% less trial" }], strengths: "Clear." };
  for (const finalReview of [raised, { findings: [], strengths: "Clean." }]) {
    let reviews = 0;
    const grok: ModelProvider = {
      mode: "live",
      async complete(request) {
        const answer = request.role === "analystB" ? { text: "B plan." } : reviews++ === 0 ? { findings: [], strengths: "Fine." } : finalReview;
        return { text: JSON.stringify(answer), model: "grok-4.7", usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 } };
      },
    };
    const fixer = fake({ synthesizer: { document: "Final, with 15.3% less trial.", resolutions: [{ finding: "D-F1", outcome: "fixed", note: "15.3%." }] } }, "claude-opus-5");
    const recording = await recordPanel(spec, { claude, grok, fixer });
    assert.equal(recording.finalReview?.findings[0]?.id, finalReview.findings.length ? "D-F1" : undefined);
    if (finalReview.findings.length) {
      assert.deepEqual(recording.calls.slice(5).map((call) => call.role), ["finalReview", "finalFix"]);
      assert.match(fixer.prompts[0]?.prompt ?? "", /18% less trial[\s\S]*D-F1 · P0 · Wrong trial figure/);
      assert.equal(recording.finalFix?.document, "Final, with 15.3% less trial.");
    } else {
      assert.deepEqual(recording.calls.slice(5).map((call) => call.role), ["finalReview"]);
      assert.equal(recording.finalFix, undefined);
      assert.equal(fixer.prompts.length, 0);
    }
  }
});

test("Grok calls recorded before reasoning was counted are priced from their time, and never lowered.", () => {
  const calls = [
    { model: "claude-opus-5-5", seconds: 100, costUsd: 0.03 },
    { model: "grok-4.7", seconds: 100, costUsd: 0.003 },
    { model: "grok-4.7", seconds: 1, costUsd: 0.01 },
  ];
  const before = withGrokReasoning(calls, "2026-11-11T07:43:20Z");
  assert.deepEqual(before[0], calls[0]);
  assert.equal(before[1]?.costUsd, Number((100 * GROK_USD_PER_SECOND).toFixed(6)));
  assert.equal(before[1]?.costEstimated, true);
  assert.deepEqual(before[2], calls[2]);
  assert.deepEqual(withGrokReasoning(calls, "2026-11-14T00:00:00Z"), calls);
});

test("A recording loads with the estimate, and raw for code that saves it back.", () => {
  const estimated = recordingFor("healthcare-build")!;
  const raw = recordingFor("healthcare-build", undefined, { raw: true })!;
  const grok = (calls: { model: string; costUsd: number }[]) => calls.filter((call) => call.model.startsWith("grok")).reduce((total, call) => total + call.costUsd, 0);
  assert.ok(grok(estimated.calls) > grok(raw.calls) * 5);
  assert.ok(raw.calls.every((call) => call.costEstimated === undefined));
});
