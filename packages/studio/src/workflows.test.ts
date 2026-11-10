import assert from "node:assert/strict";
import test from "node:test";
import { DOMAINS, catalog, expand, loadSpecs, workflowIssues } from "./workflows.ts";

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
    assert.deepEqual([...new Set(calls.map((call) => call.actor))].sort(), ["claude-opus-5", "grok-4.7"], spec.id);
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

test("a build workflow goes red before it goes green", () => {
  for (const spec of loadSpecs().filter((item) => item.kind === "build")) {
    assert.match(spec.testsRed ?? "", /✗/, spec.id);
    assert.doesNotMatch(spec.testsGreen ?? "", /✗/, spec.id);
    const flow = expand(spec);
    assert.deepEqual(flow.phases, ["Requirements", "Build and verify"], spec.id);
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
