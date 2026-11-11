import assert from "node:assert/strict";
import { findPhi, repoRoot } from "@northwind/orchestrator";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { LIVE_CHECKS, runChecks } from "../public/checks.js";
import { LIVE_TESTS, fixDiff, mutationTest, report, runTests, sourceOf } from "../public/tests.js";
import { BUILD_STAGES, DOCUMENT_STAGES, DOMAINS, catalog, expand, loadSpecs, workflowIssues } from "./workflows.ts";

test("every domain offers a feature build and a document workflow", () => {
  const specs = loadSpecs();
  for (const domain of DOMAINS) {
    const kinds = specs.filter((spec) => spec.domain === domain.id).map((spec) => spec.kind).sort();
    assert.deepEqual(kinds, ["build", "document"], domain.id);
  }
});

test("every workflow is complete, laid out without overlaps, priced, and free of patient data", () => {
  for (const spec of loadSpecs()) assert.deepEqual(workflowIssues(spec), [], spec.id);
});

test("each workflow shows its model calls without making them, and estimates what a live run would cost", () => {
  for (const spec of loadSpecs()) {
    const flow = expand(spec);
    const calls = flow.steps.filter((step) => step.kind === "llm");
    assert.ok(calls.length >= 5, spec.id);
    assert.deepEqual([...new Set(calls.map((call) => call.actor))].sort(), ["claude-opus-5", "grok-4.7", "jev-1.14.0"], spec.id);
    // Every model is named by its role on the page; each role is described.
    for (const id of new Set(calls.map((call) => call.actor))) assert.ok(flow.models[id]?.label && flow.models[id]?.qualities, `${spec.id}:${id}`);
    assert.ok(flow.estimatedCostUsd > 0.5 && flow.estimatedCostUsd < 5, `${spec.id} costs ${flow.estimatedCostUsd}`);
    // The two drafts never depend on each other: that is the wall.
    const draftA = flow.steps.find((step) => step.id === "draftA");
    const draftB = flow.steps.find((step) => step.id === "draftB");
    assert.ok(draftA && draftB && !draftA.after.includes("draftB") && !draftB.after.includes("draftA"), spec.id);
    // Each review reads only the other model's draft.
    assert.deepEqual(flow.steps.find((step) => step.id === "reviewOfA")?.after, ["draftA"], spec.id);
    assert.deepEqual(flow.steps.find((step) => step.id === "reviewOfB")?.after, ["draftB"], spec.id);
  }
});

test("each workflow has a caught-it moment: a review flags a serious defect that the merge resolves", () => {
  for (const spec of loadSpecs()) {
    const flow = expand(spec);
    const flagged = flow.steps.filter((step) => step.id.startsWith("reviewOf") && step.verdict === "flagged");
    assert.ok(flagged.length >= 1, spec.id);
    assert.match(spec.synthesis, /Defects resolved: (\d+) of \1\./, spec.id);
  }
});

test("each workflow ends with a readable output that carries the fixes, not the defects", () => {
  const caught: Record<string, RegExp> = {
    "healthcare-document": /diagnosis code/i,
    "education-document": /1\/6/,
    "fmcg-build": /= 2 days|420 a week/,
    "fmcg-document": /Clinically proven to/,
    "finance-build": /over 60|35% or less/,
    "finance-document": /Recommendation: approve/,
    "logistics-document": /Claim 1,200|net cost to the company: 0/i,
  };
  for (const spec of loadSpecs()) {
    const flow = expand(spec);
    assert.match(flow.output, /^## /m, spec.id);
    const pattern = caught[spec.id];
    if (pattern) assert.doesNotMatch(flow.output.replace(/never change the code|request to revise the diagnosis code is gone/gi, ""), pattern, spec.id);
  }
});

test("a build's generated tests match its test run, and the code writer never sees them", () => {
  for (const spec of loadSpecs().filter((item) => item.kind === "build")) {
    const cases = (spec.testCases ?? "").split("\n").filter((line) => line.startsWith("TC-"));
    const passing = (spec.testsGreen ?? "").split("\n").filter((line) => line.startsWith("✓"));
    const scripted = [...(spec.testScript ?? "").matchAll(/^test\("([^"]+)"/gm)].map((match) => match[1]);
    assert.equal(cases.length, passing.length, spec.id);
    assert.deepEqual(scripted, passing.map((line) => line.slice(2)), spec.id);
    const flow = expand(spec);
    const code = flow.steps.find((item) => item.id === "code");
    assert.ok(code && !code.after.includes("testCases") && !code.after.includes("testScript"), spec.id);
    assert.equal(flow.steps.find((item) => item.kind === "llm" && item.id === "testCases")?.actor, "grok-4.7", spec.id);
    assert.match(flow.output, /## Generated test script/, spec.id);
  }
});

test("a build workflow goes red before it goes green", () => {
  for (const spec of loadSpecs().filter((item) => item.kind === "build")) {
    assert.match(spec.testsRed ?? "", /✗/, spec.id);
    assert.doesNotMatch(spec.testsGreen ?? "", /✗/, spec.id);
    const flow = expand(spec);
    assert.deepEqual(flow.phases, ["PRD", "Architecture", "Code and review", "Test", "Deploy"], spec.id);
  }
});

test("the catalog lists every domain with its workflows and their estimates", () => {
  const entries = catalog();
  assert.equal(entries.length, DOMAINS.length);
  for (const entry of entries) {
    assert.equal(entry.workflows.length, 2, entry.id);
    for (const workflow of entry.workflows) assert.ok(workflow.calls >= 5 && workflow.estimatedSeconds > 600, workflow.id);
  }
});

test("the real-run evidence adds up and carries no patient data", () => {
  const run = JSON.parse(readFileSync(join(repoRoot(), "packages/studio/evidence/live-prd-2026-11-09.json"), "utf8")) as {
    calls: Array<{ costUsd: number; seconds: number; note?: string }>;
    totals: { calls: number; modelSeconds: number; costUsd: number; costIncludingRetryUsd: number };
  };
  const used = run.calls.filter((call) => !call.note);
  assert.equal(run.totals.calls, used.length);
  assert.equal(run.totals.modelSeconds, used.reduce((total, call) => total + call.seconds, 0));
  assert.equal(run.totals.costUsd, Math.round(used.reduce((total, call) => total + call.costUsd, 0) * 100) / 100);
  assert.equal(run.totals.costIncludingRetryUsd, Math.round(run.calls.reduce((total, call) => total + call.costUsd, 0) * 100) / 100);
  assert.deepEqual(findPhi(JSON.stringify(run)), []);
  const transcript = readFileSync(join(repoRoot(), "packages/studio/evidence/live-prd-2026-11-09-transcript.json"), "utf8");
  assert.deepEqual(findPhi(transcript), []);
});

test("each before-and-after quotes a flagged draft and the output that replaced it", () => {
  for (const spec of loadSpecs()) {
    const flow = expand(spec);
    const draft = spec.contrast.draft === "A" ? spec.draftA : spec.draftB;
    const review = spec.contrast.draft === "A" ? spec.reviewOfA : spec.reviewOfB;
    assert.ok(draft.includes(spec.contrast.before), `${spec.id}: before is not in draft ${spec.contrast.draft}`);
    assert.match(review, /\bP0\b/, `${spec.id}: draft ${spec.contrast.draft} was not flagged`);
    assert.ok(flow.output.includes(spec.contrast.after), `${spec.id}: after is not in the output`);
  }
});

test("every workflow's live checks pass on the approved figures and fail on the flagged draft's", () => {
  for (const spec of loadSpecs()) {
    const live = LIVE_CHECKS[spec.id as keyof typeof LIVE_CHECKS];
    assert.ok(live, spec.id);
    assert.ok(runChecks(spec.id).every((check) => check.pass), `${spec.id}: approved figures fail`);
    for (const claim of live.claims) {
      const results = runChecks(spec.id, { [claim.id]: claim.draft });
      assert.ok(results.some((check) => !check.pass), `${spec.id}: draft ${claim.draftFrom}'s ${claim.id} passes`);
    }
  }
  assert.equal(Object.keys(LIVE_CHECKS).length, loadSpecs().length);
});

test("each build's tests really run: one fails on the first version, all pass after the fix", () => {
  const builds = loadSpecs().filter((spec) => spec.kind === "build");
  assert.deepEqual([...LIVE_TESTS].sort(), builds.map((spec) => spec.id).sort());
  const source = readFileSync(join(repoRoot(), "packages/studio/public/tests.js"), "utf8");
  for (const spec of builds) {
    const first = runTests(spec.id, "first");
    const fixed = runTests(spec.id, "fixed");
    assert.equal(first.filter((result) => !result.pass).length, 1, spec.id);
    assert.ok(fixed.every((result) => result.pass), spec.id);
    // What the workflow shows is what the runner prints.
    assert.equal(spec.testsRed, report(first), spec.id);
    assert.equal(spec.testsGreen, report(fixed), spec.id);
    // The script the workflow shows is the code that runs.
    const start = source.indexOf(`"${spec.id}": (test, assert, code) => {`);
    const from = source.indexOf("// <test-script>", start) + "// <test-script>".length;
    const block = source.slice(from, source.indexOf("// </test-script>", from)).split("\n").map((line) => line.replace(/^ {4}/, "")).join("\n").trim();
    assert.equal(spec.testScript, block, spec.id);
  }
});

test("a build walks every stage of software development, in order, each with a person or a check at its end", () => {
  for (const spec of loadSpecs().filter((item) => item.kind === "build")) {
    const flow = expand(spec);
    assert.deepEqual(flow.stages, BUILD_STAGES, spec.id);
    const order = flow.steps.map((item) => BUILD_STAGES.indexOf(item.stage ?? ""));
    assert.ok(order.every((at) => at >= 0), `${spec.id}: a step has no stage`);
    assert.deepEqual([...new Set(order)], BUILD_STAGES.map((_, index) => index), `${spec.id}: stages out of order or missing`);
    // Claude's unit tests pass on the code as first written; the independent tests are what catch the bug.
    assert.ok(runTests(spec.id, "first", "unit").every((result) => result.pass), spec.id);
    assert.equal(spec.unitRun, report(runTests(spec.id, "first", "unit")), spec.id);
    // Each design and deployment ends with a person.
    for (const id of ["archApprove", "deployApprove"]) assert.equal(flow.steps.find((item) => item.id === id)?.kind, "human", `${spec.id}:${id}`);
  }
});

test("a document walks its own stages in order", () => {
  for (const spec of loadSpecs().filter((item) => item.kind === "document")) {
    const flow = expand(spec);
    assert.deepEqual(flow.stages, DOCUMENT_STAGES, spec.id);
    const order = flow.steps.map((item) => DOCUMENT_STAGES.indexOf(item.stage ?? ""));
    assert.deepEqual([...new Set(order)], DOCUMENT_STAGES.map((_, index) => index), spec.id);
  }
});

test("the decision model routes every request, triages findings in line with what follows, and costs a fraction of a cent", () => {
  for (const spec of loadSpecs()) {
    const flow = expand(spec);
    const decisions = flow.steps.filter((item) => item.actor === "jev-1.14.0");
    assert.ok(decisions.some((item) => item.id === "route") && decisions.some((item) => item.id === "triage"), spec.id);
    for (const item of decisions) {
      assert.ok(item.seconds < 1, `${spec.id}:${item.id} seconds`);
      assert.ok((item.estimatedCostUsd ?? 1) < 0.001, `${spec.id}:${item.id} cost`);
      assert.match(item.output, /· 0\.\d\d/, `${spec.id}:${item.id} confidence`);
    }
    // Triage marks every finding the merge goes on to resolve.
    const triage = flow.steps.find((item) => item.id === "triage")?.output ?? "";
    const resolved = Number(spec.synthesis.match(/Defects resolved: (\d+)/)?.[1]);
    assert.equal((triage.match(/→ yes/g) ?? []).length, resolved, spec.id);
    if (spec.kind === "build") {
      // Model C's apply/decline calls match what Model A then applies and declines.
      const apply = flow.steps.find((item) => item.id === "reviewTriage")?.output ?? "";
      const revise = spec.codeReview?.revise ?? "";
      assert.equal((apply.match(/→ yes/g) ?? []).length, (revise.match(/ applied/g) ?? []).length, spec.id);
      assert.equal((apply.match(/→ no/g) ?? []).length, (revise.match(/ declined/g) ?? []).length, spec.id);
    }
  }
});

test("the code shown is the code tested: the first version is the fixed source with its one planted patch", () => {
  for (const spec of loadSpecs().filter((item) => item.kind === "build")) {
    assert.notEqual(sourceOf(spec.id, "first"), sourceOf(spec.id, "fixed"), spec.id);
    assert.match(fixDiff(spec.id), /^- /m, spec.id);
    assert.match(fixDiff(spec.id), /^\+ /m, spec.id);
    // Any count of passing tests the output cites is the real one.
    const passing = (spec.testsGreen?.match(/^✓/gm) ?? []).length;
    for (const match of spec.output.matchAll(/(\d+) tests passing/g)) assert.equal(Number(match[1]), passing, spec.id);
  }
});

test("mutation testing: the tests catch most deliberately broken versions of each feature", () => {
  for (const id of LIVE_TESTS) {
    const result = mutationTest(id);
    assert.ok(result.total >= 5, `${id}: only ${result.total} mutants`);
    assert.ok(result.killed / result.total >= 0.7, `${id}: ${result.killed}/${result.total}`);
  }
});
