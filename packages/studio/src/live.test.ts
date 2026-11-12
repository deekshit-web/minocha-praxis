import assert from "node:assert/strict";
import test from "node:test";
import { type BuildOptions, BuildLimitError, type BuildRecording, BuildRecordingSchema } from "./build.ts";
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

const callOf = (role: string, model: string, seconds: number, costUsd: number) => ({ role, model, seconds, inputTokens: 900, outputTokens: 400, costUsd });
const wholeBuild = BuildRecordingSchema.parse({
  id: "live-x",
  recordedAt: "2026-11-12T10:00:00Z",
  contract: "orderTotal(items) returns a number.",
  calls: [
    callOf("contractDraft", "claude-opus-5-5", 8, 0.02),
    callOf("contractReview", "grok-4.7", 100, 0.004),
    callOf("archDraft", "claude-opus-5-5", 10, 0.03),
    callOf("archReview", "grok-4.7", 120, 0.005),
    callOf("archFinal", "claude-opus-5-5", 12, 0.03),
    callOf("code", "claude-opus-5-5", 15, 0.04),
    callOf("codeReview", "grok-4.7", 200, 0.004),
    callOf("codeRevise", "claude-opus-5-5", 12, 0.04),
    callOf("unitTests", "claude-opus-5-5", 14, 0.04),
    callOf("testCases", "grok-4.7", 60, 0.005),
    callOf("testScript", "grok-4.7", 90, 0.01),
  ],
  architecture: { draft: "Draft design.", review: "No defects found.", final: "Final design.", resolutions: "" },
  code: { first: "({ total() { return 1; } })", summary: "The module.", review: "No defects found.", revised: "({ total() { return 1; } })", resolutions: "" },
  unitScript: 'test("unit", () => assert.equal(code.total(), 1));',
  testCases: ["TC-1 · REQ-1 · [] → 1"],
  testScript: 'test("one", () => assert.equal(code.total(), 1));',
  runs: [{ round: 1, code: "({ total() { return 1; } })", acceptance: "1 passing", unit: "1 passing", failing: 0 }],
  fixes: [],
  finalCode: "({ total() { return 1; } })",
});

async function finishedBuild(fixRound = false) {
  const fake = runners();
  const build = fixRound ? { ...wholeBuild, fixes: [{ round: 1, change: "Fixed the total." }], runs: [{ ...wholeBuild.runs[0]!, failing: 1, acceptance: "✗ one\n  expected 1, received 2" }, { ...wholeBuild.runs[0]!, round: 2 }], calls: [...wholeBuild.calls, callOf("fix1", "claude-opus-5-5", 9, 0.03)] } : wholeBuild;
  fake.build = async (_spec, _prd, options) => {
    options.onProgress?.({ role: "archDraft", call: callOf("archDraft", "claude-opus-5-5", 10, 0.03), text: "d" });
    return build;
  };
  const live = createLiveService({ passcode: "booth-2026", fullBuild: true, dailyCapUsd: 2, runners: fake });
  const started = live.submit(fullBrief);
  assert.ok("jobId" in started);
  await settle();
  return { live, id: (started as { jobId: string }).jobId };
}

test("A finished full build is a workflow that has only the steps that ran.", async () => {
  const { live, id } = await finishedBuild();
  const flow = live.workflow(`live-${id}`)!;
  assert.deepEqual(flow.steps.map((item) => item.id), ["brief", "route", "draftA", "draftB", "reviewOfB", "reviewOfA", "merge", "contract", "archDraft", "archReview", "archFinal", "code", "codeReview", "codeRevise", "unitTests", "unitRun", "testCases", "testScript", "testsRed"]);
  assert.ok(flow.steps.every((item) => item.kind !== "human"), "a live build has no approval gate");
  assert.ok(!flow.steps.some((item) => item.actor === "jev-1.14.0"), "no decision is replayed that did not run");
  assert.equal(flow.build, null, "the code of a stranger's brief never runs in a browser");
  assert.equal(flow.phases.length, 4);
  assert.ok(!flow.stages.includes("Deployment"));
  assert.match(flow.title, /^Your request:/);
  assert.ok(!flow.output.includes("## Deployment"));
  assert.equal(flow.live?.costUsd, live.job(id)!.costUsd);
});

test("Each recorded step of a live workflow carries its token counts, because the page reads them.", async () => {
  const { live, id } = await finishedBuild();
  for (const item of live.workflow(`live-${id}`)!.steps.filter((entry) => entry.recorded)) assert.ok(item.tokens && Number.isFinite(item.tokens.input), `${item.id} has no token counts`);
});

test("The steps of a live workflow have no gap in their columns. Each step follows a step that exists.", async () => {
  const { live, id } = await finishedBuild();
  const flow = live.workflow(`live-${id}`)!;
  const ids = new Set(flow.steps.map((item) => item.id));
  for (const phase of [0, 1, 2, 3]) {
    const columns = [...new Set(flow.steps.filter((item) => item.phase === phase).map((item) => item.col))].sort((a, b) => a - b);
    assert.deepEqual(columns, columns.map((_, at) => at), `phase ${phase} has a gap`);
  }
  for (const item of flow.steps) for (const before of item.after) assert.ok(ids.has(before), `${item.id} follows ${before}, which did not run`);
  assert.equal(flow.walls[0]?.col, flow.steps.find((item) => item.id === "draftA")!.col);
});

test("The contract step carries the real contract and the real cost of its calls.", async () => {
  const { live, id } = await finishedBuild();
  const contract = live.workflow(`live-${id}`)!.steps.find((item) => item.id === "contract")!;
  assert.equal(contract.output, "orderTotal(items) returns a number.");
  assert.equal(contract.recorded, true);
  assert.equal(contract.seconds, 108);
  assert.ok(Math.abs((contract.estimatedCostUsd ?? 0) - 0.024) < 1e-9);
});

test("A live workflow keeps the fix round when the build needed one.", async () => {
  const { live, id } = await finishedBuild(true);
  const flow = live.workflow(`live-${id}`)!;
  assert.deepEqual(flow.steps.slice(-3).map((item) => item.id), ["testsRed", "fix", "testsGreen"]);
  assert.equal(flow.steps.find((item) => item.id === "testsRed")!.verdict, "flagged");
});

test("A workflow is served only for a finished full build.", async () => {
  const { live } = await finishedBuild();
  assert.equal(live.workflow("live-nope"), null);
  const plain = createLiveService({ passcode: "booth-2026", runners: runners() });
  const started = plain.submit(brief);
  await settle();
  assert.equal(plain.workflow(`live-${(started as { jobId: string }).jobId}`), null);
  const stopped = createLiveService({ passcode: "booth-2026", fullBuild: true, dailyCapUsd: 2, runners: runners(false, true) });
  const failed = stopped.submit(fullBrief);
  await settle();
  assert.equal(stopped.workflow(`live-${(failed as { jobId: string }).jobId}`), null);
  assert.equal(stopped.record((failed as { jobId: string }).jobId), null);
});

test("The server serves a finished live build as a workflow and as a record. The poll leaves out the heavy copy.", async () => {
  const { live, id } = await finishedBuild();
  const server = createStudioServer({ hosted: true, decider: createDecider({ apiKey: "" }), live });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  try {
    const flow = (await (await fetch(`${origin}/api/workflows/live-${id}`)).json()) as { steps: Array<{ id: string }>; build: unknown };
    assert.ok(flow.steps.some((item) => item.id === "contract"));
    assert.equal(flow.build, null);
    assert.equal((await fetch(`${origin}/api/workflows/live-nope`)).status, 404);
    const polled = (await (await fetch(`${origin}/api/live/jobs/${id}`)).json()) as Record<string, unknown>;
    assert.ok(!("recording" in polled), "the poll does not carry the requirements panel");
    assert.ok(polled.build, "the poll still carries the build, for the diagram");
    const record = await fetch(`${origin}/api/live/jobs/${id}/record?download=1`);
    assert.match(record.headers.get("content-disposition") ?? "", /attachment; filename="kodiflex-live-build-[a-f0-9]+\.json"/);
    const body = (await record.json()) as { panel: { merge: unknown }; build: { contract: string }; events: unknown[]; passcode?: string };
    assert.ok(body.panel.merge);
    assert.equal(body.build.contract, "orderTotal(items) returns a number.");
    assert.ok(body.events.length > 0);
    assert.ok(!JSON.stringify(body).includes("booth-2026"), "the passcode is never in the record");
    assert.equal((await fetch(`${origin}/api/live/jobs/deadbeef/record`)).status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
