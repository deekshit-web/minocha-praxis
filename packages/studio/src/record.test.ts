import assert from "node:assert/strict";
import test from "node:test";
import type { CompletionRequest, ModelProvider } from "@northwind/orchestrator";
import { panelContext, recordPanel, renderMerge, renderReview } from "./record.ts";
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

test("the panel context carries the facts, never the prepared drafts or reviews", () => {
  const context = panelContext(spec, "FMCG");
  assert.match(context, /SKU-5502/);
  assert.match(context, /35%/);
  assert.doesNotMatch(context, /4\.20|Clinically proven|D-A1/);
});

test("a recording runs drafts, crossed reviews and a merge, renumbers findings, and prices every call", async () => {
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
