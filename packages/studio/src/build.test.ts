import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider } from "@northwind/orchestrator";
import { BuildLimitError, type BuildSeats, recordBuild, sandboxRun } from "./build.ts";
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

/** Seats that answer from a script, in the order each side is asked. */
function scripted(order: { a: string[]; b: string[] }, answers: Record<string, unknown>, costUsd = 0.01): BuildSeats {
  const seat = (side: "a" | "b", model: string) => (): ModelProvider => {
    const key = order[side].shift();
    if (!key) throw new Error(`no scripted answer for side ${side}`);
    return { mode: "live", complete: async () => ({ text: JSON.stringify(answers[key]), model, costUsd, usage: { inputTokens: 500, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 } }) };
  };
  return { a: seat("a", "claude-opus-5-5"), b: seat("b", "grok-4.7"), run: sandboxRun };
}

const requestSpec = { ...spec, id: "live-request" };
const requestAnswers = {
  contractDraft: { contract: "orderTotal(items) returns a number." },
  contractReview: { findings: [{ id: "x", severity: "P1", title: "Empty order", detail: "The contract does not say what an empty list returns.", quote: "returns a number" }], strengths: "" },
  contractFinal: { contract: "orderTotal(items) returns a number; an empty list returns 0.", resolutions: [{ finding: "K-1", outcome: "applied", note: "Added." }] },
  arch: { text: "Components." },
  archReview: { findings: [], strengths: "Clear." },
  archFinal: { text: "Components, revised.", resolutions: [] },
  code: { code: "({ orderTotal(items) { return items.reduce((sum, item) => sum + item, 0); } })", summary: "The module." },
  codeReview: { findings: [], strengths: "Fine." },
  codeRevise: { code: "({ orderTotal(items) { return items.reduce((sum, item) => sum + item, 0); } })", resolutions: [] },
  unit: { script: 'test("unit", () => assert.equal(code.orderTotal([]), 0));' },
  cases: { cases: ["TC-1 · REQ-1 · [2, 3] → 5"] },
  script: { script: 'test("adds the items", () => assert.equal(code.orderTotal([2, 3]), 5));' },
};
const requestOrder = () => ({ a: ["contractDraft", "contractFinal", "arch", "archFinal", "code", "codeRevise", "unit"], b: ["contractReview", "archReview", "codeReview", "cases", "script"] });

test("A request with no prepared contract gets one first. Model A drafts it, Model B checks it, and Model A revises it.", async () => {
  const events: string[] = [];
  const recording = await recordBuild(requestSpec, "REQ-1 The order total is the sum of the items.", scripted(requestOrder(), requestAnswers), undefined, {
    onProgress: ({ role, call }) => events.push(`${role}${call ? "" : " (no call)"}`),
  });
  assert.equal(recording.contract, "orderTotal(items) returns a number; an empty list returns 0.");
  assert.deepEqual(recording.calls.slice(0, 3).map((call) => call.role), ["contractDraft", "contractReview", "contractFinal"]);
  assert.deepEqual(events, ["contractDraft", "contractReview", "contractFinal", "archDraft", "archReview", "archFinal", "code", "codeReview", "codeRevise", "unitTests", "testCases", "testScript", "run1 (no call)"]);
  assert.equal(recording.runs.at(-1)?.failing, 0);
});

test("When Model B finds nothing in the contract, Model A does not revise it.", async () => {
  const answers = { ...requestAnswers, contractReview: { findings: [], strengths: "Testable." } };
  const order = requestOrder();
  order.a.splice(order.a.indexOf("contractFinal"), 1);
  const recording = await recordBuild(requestSpec, "REQ-1 The order total is the sum of the items.", scripted(order, answers));
  assert.equal(recording.contract, "orderTotal(items) returns a number.");
  assert.ok(!recording.calls.some((call) => call.role === "contractFinal"));
});

test("A build stops before the next call when its calls have reached the cost limit. The progress it reported stays.", async () => {
  const seen: string[] = [];
  await assert.rejects(
    recordBuild(requestSpec, "REQ-1 The order total is the sum of the items.", scripted(requestOrder(), requestAnswers, 0.05), undefined, { maxCostUsd: 0.12, onProgress: ({ role }) => seen.push(role) }),
    (error: Error) => error instanceof BuildLimitError && /stopped before "archDraft".*limit of \$0\.12/.test(error.message),
  );
  assert.deepEqual(seen, ["contractDraft", "contractReview", "contractFinal"]);
});

test("A build stops when it has run longer than its time limit.", async () => {
  await assert.rejects(recordBuild(requestSpec, "REQ-1 The order total is the sum of the items.", scripted(requestOrder(), requestAnswers), undefined, { maxSeconds: 0 }), BuildLimitError);
});

test("A workflow with a prepared contract does not draft another one.", async () => {
  const seats = scripted({ a: ["arch", "archFinal", "code", "codeRevise", "unit"], b: ["archReview", "codeReview", "cases", "script"] }, {
    ...requestAnswers,
    code: { code: "({ daysOfCover() { return 1; }, createAlerter() { return {}; } })", summary: "The module." },
    codeRevise: { code: "({ daysOfCover() { return 1; }, createAlerter() { return {}; } })", resolutions: [] },
    unit: { script: 'test("unit", () => assert.ok(code.daysOfCover));' },
    script: { script: 'test("one", () => assert.equal(code.daysOfCover(1, 1, 4), 1));' },
  });
  const recording = await recordBuild(spec, "REQ-1 Days of cover.", seats);
  assert.ok(!recording.calls.some((call) => call.role.startsWith("contract")));
});
