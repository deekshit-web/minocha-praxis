import assert from "node:assert/strict";
import test from "node:test";
import { type BuildOptions, BuildLimitError, type BuildRecording } from "./build.ts";
import { networkIsolated } from "./isolate.ts";
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

const builtModule = {
  contract: "daysLeft(order) returns a whole number.",
  architecture: { draft: "d", review: "AR-1 · P1 · Gap\n  Missing.", final: "f", resolutions: "" },
  code: { first: "c", summary: "s", review: "CR-1 · P1 · Gap\n  Missing.\nCR-2 · P2 · Style\n  Minor.", revised: "c", resolutions: "" },
  runs: [{ round: 1, code: "c", acceptance: "3 passing", unit: "1 passing", failing: 0 }],
  fixes: [],
  finalCode: "({ daysLeft() { return 5; } })",
} as unknown as BuildRecording;

function runners(low = false, stopBuild = false): LiveRunners & { panels: number; builds: number; limits: Array<number | undefined>; diagramAsked: Array<boolean | undefined> } {
  const state = { panels: 0, builds: 0, limits: [] as Array<number | undefined>, diagramAsked: [] as Array<boolean | undefined> };
  return Object.assign(state, {
    async build(_spec: unknown, _prd: string, options: BuildOptions) {
      state.builds += 1;
      state.limits.push(options.maxCostUsd);
      state.diagramAsked.push(options.diagram);
      for (const role of ["archDraft", "archReview", "archFinal", "code"]) options.onProgress?.({ role, call: call(role, "claude-opus-5-5", 0.03), text: `${role} text` });
      if (stopBuild) throw new BuildLimitError("The build stopped before \"codeReview\": its calls so far cost $0.20, which is the limit of $0.20.");
      options.onProgress?.({ role: "run1", call: null, text: "3 passing" });
      return builtModule;
    },
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

const fullBrief = { ...brief, kind: "fullbuild" };

test("A full build is off unless the server switches it on.", () => {
  const fake = runners();
  const live = createLiveService({ passcode: "booth-2026", runners: fake });
  assert.deepEqual(live.submit(fullBrief), { error: "Full builds are not switched on here.", status: 404 });
  assert.equal(live.status().fullBuild, false);
  assert.equal(fake.panels, 0);
});

test("A full build runs the panel, then every build stage. The page shows each call and each test run.", async () => {
  const fake = runners();
  const live = createLiveService({ passcode: "booth-2026", fullBuild: true, fullBuildCapUsd: 0.75, dailyCapUsd: 2, runners: fake });
  const started = live.submit(fullBrief);
  assert.ok("jobId" in started);
  await settle();
  const job = live.job(started.jobId)!;
  assert.equal(job.status, "done");
  assert.equal(job.kind, "fullbuild");
  assert.deepEqual(job.events.map((event) => event.role), ["analystA", "analystB", "critiqueOfB", "critiqueOfA", "synthesizer", "archDraft", "archReview", "archFinal", "code", "run1"]);
  assert.equal(job.events.at(-1)?.model, "sandbox");
  assert.equal(job.events.at(-1)?.costUsd, 0);
  assert.equal(job.build, builtModule);
  assert.match(job.final ?? "", /The module contract:\ndaysLeft/);
  assert.match(job.final ?? "", /all passing/);
  assert.equal(job.findings, 1 + 1 + 2);
  assert.equal(fake.builds, 1);
});

test("A full build gets what is left of its cost limit. The panel cost comes off first.", async () => {
  const fake = runners();
  const live = createLiveService({ passcode: "booth-2026", fullBuild: true, fullBuildCapUsd: 0.75, dailyCapUsd: 2, runners: fake });
  live.submit(fullBrief);
  await settle();
  assert.equal(fake.limits.length, 1);
  assert.ok(Math.abs((fake.limits[0] ?? 0) - 0.65) < 1e-9, "0.75 minus the 0.10 that the panel cost");
});

test("A full build asks for the design as a diagram.", async () => {
  const fake = runners();
  const live = createLiveService({ passcode: "booth-2026", fullBuild: true, dailyCapUsd: 2, runners: fake });
  live.submit(fullBrief);
  await settle();
  assert.deepEqual(fake.diagramAsked, [true]);
});

test("A build that reaches its limit stops. The run keeps the calls it made, and the page shows the reason.", async () => {
  const fake = runners(false, true);
  const live = createLiveService({ passcode: "booth-2026", fullBuild: true, dailyCapUsd: 2, runners: fake });
  const started = live.submit(fullBrief);
  await settle();
  const job = live.job("jobId" in started ? started.jobId : "")!;
  assert.equal(job.status, "failed");
  assert.match(job.error ?? "", /The build stopped before "codeReview"/);
  assert.equal(job.events.length, 9);
  assert.ok(job.costUsd > 0 && live.status().spentTodayUsd > 0, "the calls that were made are charged");
  assert.equal(job.build, null);
});

test("A full build needs the whole cost limit free in the daily budget.", () => {
  const live = createLiveService({ passcode: "booth-2026", fullBuild: true, fullBuildCapUsd: 0.75, dailyCapUsd: 0.5, runners: runners() });
  assert.equal((live.submit(fullBrief) as { status: number }).status, 429);
});

test("A hosted server switches the full build on only when the sandbox can isolate the network.", async () => {
  const saved = process.env.LIVE_BUILD;
  process.env.LIVE_BUILD = "1";
  const server = createStudioServer({ hosted: true, decider: createDecider({ apiKey: "" }) });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const status = (await (await fetch(`http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api/live`)).json()) as { enabled: boolean; fullBuild?: boolean };
    assert.equal(status.fullBuild, networkIsolated());
  } finally {
    if (saved === undefined) delete process.env.LIVE_BUILD;
    else process.env.LIVE_BUILD = saved;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
