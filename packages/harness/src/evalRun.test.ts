import assert from "node:assert/strict";
import test from "node:test";
import { recordedLines, type Completion, type PanelRole, type Prd, type SeatSpec } from "@northwind/orchestrator";
import { evalBriefs, plantedCases } from "./evalCases.ts";
import { assertServedModels, gradeBrief, gradePlanted, runBrief, runPlanted, STRICT_SEVERITY, type EvalCall, type EvalModels, type JsonCaller } from "./evalRun.ts";
import { prdPanel } from "./panels.ts";

const usage = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** A fake caller: answers each seat from the recorded PRD panel, or from a scripted judge reply. */
function fake(model: string, answer: (role: PanelRole, prompt: string, seat: SeatSpec) => unknown, log: string[] = []): JsonCaller {
  return {
    model,
    async call(_system, role, prompt, seat): Promise<Completion> {
      log.push(`${model}:${role}`);
      return { text: JSON.stringify(answer(role, prompt, seat)), model, usage };
    },
  };
}

const [proposalA, proposalB, critiqueOfA, critiqueOfB, wrapped] = recordedLines(prdPanel()).map((line) => JSON.parse(line) as unknown);

function seatAnswer(role: PanelRole): unknown {
  if (role === "analystA") return proposalA;
  if (role === "analystB") return proposalB;
  if (role === "critiqueOfA") return critiqueOfA;
  if (role === "critiqueOfB") return critiqueOfB;
  return wrapped;
}

function models(judge: (prompt: string, seat: SeatSpec) => unknown, log: string[] = []): EvalModels {
  return {
    claude: fake("claude-opus-5", (role) => seatAnswer(role), log),
    grok: fake("grok-4.7", (role) => seatAnswer(role), log),
    judgeClaude: fake("claude-sonnet-5", (_role, prompt, seat) => judge(prompt, seat), log),
    judgeGrok: fake("grok-4.7", (_role, prompt, seat) => judge(prompt, seat), log),
  };
}

test("a planted case asks one reviewer, and the jury's share of yes votes is the detection grade", async () => {
  const planted = plantedCases().find((item) => item.id === "A01");
  assert.ok(planted);
  const log: string[] = [];
  let vote = 0;
  const jury = models(() => ({ detected: vote++ === 0, defect_id: vote === 1 ? "D-1" : "", reason: "r" }), log);
  const run = await runPlanted(planted, "v1", jury);
  assert.deepEqual(log, ["grok-4.7:critiqueOfA"]);
  assert.equal(run.calls[0]?.requested, "grok-4.7");
  const critique = { ...(critiqueOfA as object), defects: [{ id: "D-1", severity: "P0", code: "OTHER", point: "15 days is soon, not urgent" }] };
  const calls: EvalCall[] = [];
  const graded = await gradePlanted(planted, critique as never, jury, calls);
  assert.equal(graded.grade.detected, 0.5);
  assert.equal(graded.grade.detected_p0, 0.5);
  assert.equal(calls.length, 2);
  assert.match(graded.explanation.detected ?? "", /claude-sonnet-5: yes \(D-1\)[\s\S]*grok-4\.7: no/);
});

test("a clean control only counts the serious defects a reviewer raised, with no jury call", async () => {
  const clean = plantedCases().find((item) => item.kind === "clean");
  assert.ok(clean);
  const calls: EvalCall[] = [];
  const critique = { ...(critiqueOfA as object), defects: [{ id: "D-1", severity: "P0", code: "OTHER", point: "invented" }] };
  const graded = await gradePlanted(clean, critique as never, models(() => assert.fail("no jury on a clean draft")), calls);
  assert.deepEqual(graded.grade, { p0_raised: 1, defects_raised: 1 });
  assert.equal(calls.length, 0);
});

test("each Part B setup makes the calls it claims to, on the models it claims to", async () => {
  const brief = evalBriefs()[0];
  assert.ok(brief);
  const expected: Record<string, string[]> = {
    baseline: ["claude-opus-5:analystA"],
    v1: ["claude-opus-5:analystA", "claude-opus-5:critiqueOfA", "claude-opus-5:synthesizer"],
    v2: ["claude-opus-5:analystA", "claude-opus-5:analystB", "claude-opus-5:critiqueOfA", "claude-opus-5:critiqueOfB", "claude-opus-5:synthesizer"],
    v3: ["claude-opus-5:analystA", "grok-4.7:analystB", "grok-4.7:critiqueOfA", "claude-opus-5:critiqueOfB", "claude-opus-5:synthesizer"],
    v4: [
      "claude-opus-5:analystA",
      "claude-opus-5:analystB",
      "claude-opus-5:critiqueOfA",
      "claude-opus-5:critiqueOfB",
      "claude-opus-5:synthesizer",
      "grok-4.7:critiqueOfA",
    ],
  };
  for (const [variant, calls] of Object.entries(expected)) {
    const log: string[] = [];
    const run = await runBrief(brief, variant as "baseline", models(() => ({}), log));
    assert.deepEqual(log, calls, variant);
    assert.equal(run.calls.length, calls.length, variant);
    assert.ok((run.output as Prd).requirements.length > 0, variant);
    assert.match(run.transcript[0]?.content ?? "", new RegExp(brief.answers[0]?.answer.slice(0, 20) ?? "x"));
  }
});

test("Part B grading: checklist share averaged over the jury, code gates, and a blind win rate against the single draft", async () => {
  const brief = evalBriefs()[0];
  assert.ok(brief);
  const prd = (wrapped as { synthesis: Prd }).synthesis;
  const jury = models((prompt, seat) =>
    "checks" in (seat.schema as unknown as { shape: object }).shape
      ? { checks: brief.checks.map((_, index) => ({ index, met: index < (prompt.includes("Document A") ? 0 : 3), evidence: "e" })) }
      : { winner: "A", reason: "A is better" },
  );
  const calls: EvalCall[] = [];
  // random() < 0.5 shows the candidate as A for both jurors, so both vote for it.
  const graded = await gradeBrief(brief, prd, prd, jury, calls, () => 0.1);
  assert.equal(graded.grade.checklist, 3 / brief.checks.length);
  assert.equal(graded.grade.win_vs_single, 1);
  assert.equal(calls.length, 4);
  const asB = await gradeBrief(brief, prd, prd, jury, [], () => 0.9);
  assert.equal(asB.grade.win_vs_single, 0);
  const reference = await gradeBrief(brief, prd, null, jury, []);
  assert.equal(reference.grade.win_vs_single, 0.5);
});

test("a call served by a different model than it asked for fails the attempt as a substitution", () => {
  const call = (requested: string, served: string): EvalCall => ({
    label: "seat",
    requested,
    metric: { role: "analystA", source: "live", model: served, durationMs: 1, usage, costUsd: 0.01 },
  });
  assert.doesNotThrow(() => assertServedModels([call("claude-opus-5", "claude-opus-5")]));
  assert.throws(
    () => assertServedModels([call("claude-opus-5", "claude-opus-4-8")]),
    (error: Error & { failure_class?: string }) => error.failure_class === "serving_substitution",
  );
});

test("v4 reviews strictly, and Claude revises only when the final Grok review raises a defect", async () => {
  const brief = evalBriefs()[0];
  assert.ok(brief);
  const defect = { id: "D-A1", severity: "P0", code: "OTHER", point: "AC-2 uses 14 days where the brief says 10" };
  for (const defects of [[], [defect]]) {
    const log: string[] = [];
    const reviewSeats: string[] = [];
    const answer = (role: PanelRole, _prompt: string, seat: SeatSpec) => {
      if (role.startsWith("critique")) reviewSeats.push(seat.instructions);
      return seatAnswer(role);
    };
    const grok = fake("grok-4.7", (role, prompt, seat) => (answer(role, prompt, seat), { ...(critiqueOfA as object), defects }), log);
    const run = await runBrief(brief, "v4", { ...models(() => ({})), claude: fake("claude-opus-5", answer, log), grok });
    assert.deepEqual(log.slice(5), defects.length ? ["grok-4.7:critiqueOfA", "claude-opus-5:synthesizer"] : ["grok-4.7:critiqueOfA"]);
    assert.equal(run.calls.length, 5 + 1 + defects.length);
    assert.ok((run.output as Prd).requirements.length > 0);
    assert.equal(reviewSeats.length, 3);
    for (const instructions of reviewSeats) assert.ok(instructions.endsWith(STRICT_SEVERITY));
  }
});
