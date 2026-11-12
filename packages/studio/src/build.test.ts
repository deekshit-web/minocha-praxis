import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider } from "@northwind/orchestrator";
import { type BuildSeats, recordBuild, sandboxRun } from "./build.ts";
import { loadSpecs } from "./workflows.ts";

const spec = loadSpecs(undefined, { recordings: false }).find((item) => item.id === "fmcg-build")!;

test("The sandbox runs the tests that the model wrote. It rejects unsafe code. It stops a loop that does not end.", async () => {
  const ok = await sandboxRun("({ add(a, b) { return a + b; } })", 'test("adds", () => assert.equal(code.add(2, 2), 4));');
  assert.deepEqual(ok.results.map((result) => result.pass), [true]);
  const unsafe = await sandboxRun('({ steal() { return fetch("https://example.com"); } })', 'test("x", () => assert.ok(true));');
  assert.match(unsafe.error ?? "", /refused to run: uses fetch/);
  const loop = await sandboxRun("({ spin() { for (;;) {} } })", 'test("spins", () => code.spin());', 500);
  assert.match(loop.error ?? "", /timed out/);
});

test("A build recording runs the real tests. When a run fails, the model fixes the code and the tests run again.", async () => {
  const fixed = "({ daysOfCover(stock, sellOut, weeks) { return sellOut === 0 ? Infinity : stock / (sellOut / (weeks * 7)); }, createAlerter() { return { check() { return null; } }; } })";
  const buggy = fixed.replace("weeks * 7", "weeks");
  const answers: Record<string, unknown> = {
    arch: { text: "Components." },
    archReview: { findings: [], strengths: "Clear." },
    archFinal: { text: "Components, revised.", resolutions: [] },
    code: { code: buggy, summary: "The module." },
    codeReview: { findings: [], strengths: "Fine." },
    codeRevise: { code: buggy, resolutions: [] },
    unit: { script: 'test("unit", () => assert.ok(code.daysOfCover));' },
    cases: { cases: ["TC-1 · REQ-1 · 840 units, 1,680 sold in 4 weeks → 14 days"] },
    script: { script: 'test("840 units at 60 a day is 14 days", () => assert.equal(code.daysOfCover(840, 1680, 4), 14));' },
    fix: { code: fixed, change: "Divide by weeks times seven." },
  };
  const order = { a: ["arch", "archFinal", "code", "codeRevise", "unit", "fix"], b: ["archReview", "codeReview", "cases", "script"] };
  const seat = (side: "a" | "b", model: string) => (): ModelProvider => {
    const key = order[side].shift() ?? "fix";
    return { mode: "live", complete: async () => ({ text: JSON.stringify(answers[key]), model, usage: { inputTokens: 500, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 } }) };
  };
  const seats: BuildSeats = { a: seat("a", "claude-opus-5-5"), b: seat("b", "grok-4.7"), run: sandboxRun };
  const recording = await recordBuild(spec, "REQ-1 Days of cover = stock ÷ (4-week sell-out ÷ 28).", seats);
  assert.equal(recording.runs.length, 2);
  assert.equal(recording.runs[0]?.failing, 1);
  assert.match(recording.runs[0]?.acceptance ?? "", /✗ 840 units at 60 a day is 14 days\n {2}expected 14, received 2/);
  assert.equal(recording.runs[1]?.failing, 0);
  assert.match(recording.finalCode, /weeks \* 7/);
  assert.equal(recording.fixes[0]?.change, "Divide by weeks times seven.");
  assert.ok(recording.calls.every((call) => call.costUsd > 0));
});
