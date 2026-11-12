import assert from "node:assert/strict";
import test from "node:test";
import { createDecider } from "./jev.ts";
import { type LiveRunners, createLiveService } from "./live.ts";
import type { Recording } from "./record.ts";
import { createStudioServer } from "./server.ts";

const call = (role: string, model: string, costUsd: number) => ({ role, model, seconds: 10, inputTokens: 900, outputTokens: 400, costUsd });
const recording: Recording = {
  id: "live-x",
  recordedAt: "2026-11-11T10:00:00Z",
  calls: [],
  draftA: "A.",
  draftB: "B.",
  reviewOfA: { findings: [], strengths: "" },
  reviewOfB: { findings: [{ id: "D-B1", severity: "P1", title: "Gap", detail: "Missing.", quote: "B." }], strengths: "" },
  merge: { document: "Final document.", keptFromA: "a", keptFromB: "b", resolutions: [] },
};

function runners(low = false): LiveRunners & { panels: number } {
  const state = { panels: 0 };
  return Object.assign(state, {
    async route() {
      return { text: low ? "Decision: one model and a person." : "Decision: the full panel.", low };
    },
    async panel(_spec: unknown, onProgress: (event: { role: string; call: ReturnType<typeof call>; text: string }) => void) {
      state.panels += 1;
      for (const role of ["analystA", "analystB", "critiqueOfB", "critiqueOfA", "synthesizer"]) onProgress({ role, call: call(role, role.endsWith("B") && role !== "critiqueOfB" ? "grok-4.7" : "claude-opus-5-5", 0.02), text: `${role} text` });
      return recording;
    },
    async single() {
      return { role: "single", label: "one model", model: "claude-opus-5-5", seconds: 9, costUsd: 0.01, text: "Single draft." };
    },
  });
}

const brief = { passcode: "booth-2026", domain: "fmcg", kind: "document", brief: "Plan a two-week promotion for a new shampoo that keeps margin above 35%." };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("The full panel runs live on the brief of a visitor. The page shows each call, its cost and the final version.", async () => {
  const fake = runners();
  const live = createLiveService({ passcode: "booth-2026", runners: fake });
  const started = live.submit(brief);
  assert.ok("jobId" in started);
  await settle();
  const job = live.job(started.jobId)!;
  assert.equal(job.status, "done");
  assert.equal(job.events.length, 5);
  assert.equal(job.final, "Final document.");
  assert.equal(job.findings, 1);
  assert.ok(Math.abs(job.costUsd - 0.1) < 1e-9);
  assert.equal(live.status().spentTodayUsd.toFixed(2), "0.10");
});

test("Model C rates a request as low risk. The request goes to one model and not to the panel.", async () => {
  const fake = runners(true);
  const live = createLiveService({ passcode: "booth-2026", runners: fake });
  const started = live.submit(brief);
  await settle();
  const job = live.job("jobId" in started ? started.jobId : "")!;
  assert.equal(job.route?.path, "single");
  assert.equal(fake.panels, 0);
  assert.equal(job.final, "Single draft.");
});

test("A live run rejects a wrong passcode, personal data and a bad length. It rejects a second run at the same time. It rejects a run when the budget is spent.", async () => {
  const live = createLiveService({ passcode: "booth-2026", dailyCapUsd: 0.3, runEstimateUsd: 0.25, runners: runners() });
  assert.deepEqual(live.submit({ ...brief, passcode: "nope" }), { error: "That passcode is not right.", status: 403 });
  assert.equal((live.submit({ ...brief, brief: "Too short" }) as { status: number }).status, 400);
  assert.equal((live.submit({ ...brief, domain: "mars" }) as { status: number }).status, 400);
  assert.match((live.submit({ ...brief, brief: "Appeal for John Smith, MRN 12345678, born 1980-01-01, denied." }) as { error: string }).error, /personal data/);
  const first = live.submit(brief);
  assert.ok("jobId" in first);
  assert.equal((live.submit(brief) as { status: number }).status, 429);
  await settle();
  assert.match((live.submit(brief) as { error: string }).error, /budget/);
  assert.equal(createLiveService({ runners: runners() }).enabled, false);
});

test("On a hosted server, only one write is permitted. The write is JSON from the same origin to the live run.", async () => {
  const live = createLiveService({ passcode: "booth-2026", runners: runners() });
  const server = createStudioServer({ hosted: true, decider: createDecider({ apiKey: "" }), live });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  try {
    const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${origin}/api/live/run`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    assert.equal((await post(brief, { origin: "https://evil.example" })).status, 403);
    assert.equal((await fetch(`${origin}/api/live/run`, { method: "POST", body: "x" })).status, 415);
    const accepted = await post(brief);
    assert.equal(accepted.status, 202);
    const { jobId } = (await accepted.json()) as { jobId: string };
    await settle();
    const job = (await (await fetch(`${origin}/api/live/jobs/${jobId}`)).json()) as { status: string; final: string };
    assert.equal(job.status, "done");
    assert.ok(!JSON.stringify(job).includes("booth-2026"), "the passcode is never echoed");
    assert.equal((await fetch(`${origin}/api/catalog`, { method: "POST" })).status, 405);
    assert.equal(((await (await fetch(`${origin}/api/live`)).json()) as { enabled: boolean }).enabled, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
