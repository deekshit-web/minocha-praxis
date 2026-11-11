import assert from "node:assert/strict";
import test from "node:test";
import { createDecider } from "./jev.ts";
import { loadSpecs } from "./workflows.ts";

const spec = loadSpecs().find((item) => item.id === "healthcare-build")!;

function fakeJev(reply: (body: { model: string; state: string; questions: Record<string, { type: string }> }) => unknown, status = 200) {
  const calls: Array<{ headers: Record<string, string>; body: { model: string; state: string; questions: Record<string, { type: string }> } }> = [];
  const fetchImpl = (async (_url: string, init: { headers: Record<string, string>; body: string }) => {
    const body = JSON.parse(init.body);
    calls.push({ headers: init.headers, body });
    return new Response(JSON.stringify(reply(body)), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const confident = (body: { model: string; questions: Record<string, { type: string }> }) => ({
  model: "jev-1.14.0",
  answers: Object.fromEntries(
    Object.entries(body.questions).map(([key, question]) =>
      question.type === "choice" ? [key, { type: "choice", choice: "high", probabilities: { low: 0.03, medium: 0.08, high: 0.89 } }] : [key, { type: "noul", noul: 0.97 }],
    ),
  ),
  usage: { input_tokens: 2400 },
});

test("without a key, decisions replay and say why", async () => {
  const decider = createDecider({ apiKey: "" });
  const result = await decider.decide(spec, "route");
  assert.equal(result?.live, false);
  assert.match(result?.reason ?? "", /no decision-model key/);
  assert.match(result?.text ?? "", /Decision: the full panel/);
});

test("a live decision sends fixed typed questions with the key, and shows the real answers, time and cost", async () => {
  const { calls, fetchImpl } = fakeJev(confident);
  const decider = createDecider({ apiKey: "test-key", fetchImpl });
  const result = await decider.decide(spec, "triage");
  assert.equal(result?.live, true);
  assert.equal(calls[0]?.headers.authorization, "Bearer test-key");
  assert.equal(calls[0]?.body.model, "jev-latest");
  assert.deepEqual(Object.keys(calls[0]?.body.questions ?? {}), ["D_A1", "D_A2", "D_B1"]);
  assert.match(result?.text ?? "", /Must the next step fix D-A1 \(date arithmetic\)\?  → yes · 0\.97/);
  assert.equal(result?.model, "jev-1.14.0");
  assert.ok((result?.costUsd ?? 1) > 0 && (result?.costUsd ?? 1) < 0.001);
});

test("live answers are cached, and a daily cap bounds the spend", async () => {
  const { calls, fetchImpl } = fakeJev(confident);
  const decider = createDecider({ apiKey: "test-key", fetchImpl, dailyCap: 2 });
  await decider.decide(spec, "route");
  const again = await decider.decide(spec, "route");
  assert.equal(again?.cached, true);
  assert.equal(calls.length, 1);
  await decider.decide(spec, "triage");
  const capped = await decider.decide(spec, "goNoGo");
  assert.equal(capped?.live, false);
  assert.match(capped?.reason ?? "", /cap/);
  assert.equal(calls.length, 2);
});

test("an error or an unreadable answer falls back to the replay", async () => {
  const failing = createDecider({ apiKey: "test-key", fetchImpl: fakeJev(() => ({}), 503).fetchImpl });
  assert.match((await failing.decide(spec, "route"))?.reason ?? "", /503/);
  const garbled = createDecider({ apiKey: "test-key", fetchImpl: fakeJev(() => ({ answers: {} })).fetchImpl });
  assert.match((await garbled.decide(spec, "route"))?.reason ?? "", /could not be read/);
});

test("a live answer that differs from what happens next is reported, not hidden", async () => {
  const unsure = (body: { questions: Record<string, { type: string }> }) => ({
    answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { type: "noul", noul: key === "CR_3" ? 0.54 : 0.95 }])),
    usage: { input_tokens: 500 },
  });
  const decider = createDecider({ apiKey: "test-key", fetchImpl: fakeJev(unsure).fetchImpl });
  const result = await decider.decide(spec, "reviewTriage");
  assert.equal(result?.disagreements?.length, 1);
  assert.match(result?.disagreements?.[0] ?? "", /CR-3.*said yes \(0\.54, a close call\).*went with no/);
});
