import assert from "node:assert/strict";
import test from "node:test";
import { STAGE_METHODS, executionGate, mutationOracleIssues } from "./method.ts";
import { reviewPanelIssues } from "./panel.ts";
import { FEATURE_B_BRIEF, architecturePanel, panelCalls, prdPanel } from "@northwind/harness";

test("Quality has a higher priority than a second code generation.", () => {
  assert.equal(STAGE_METHODS.prd.method, "analyze-critique-synthesize");
  assert.equal(STAGE_METHODS.architecture.method, "analyze-critique-synthesize");
  assert.equal(STAGE_METHODS.implementation.method, "plan-then-review-and-execute");
  assert.equal(STAGE_METHODS.test_design.method, "analyze-critique-synthesize-plus-oracle");
  assert.ok(STAGE_METHODS.implementation.modelCalls < 5 + 5);
  for (const stage of ["prd", "architecture", "implementation", "test_design"] as const) {
    assert.deepEqual(STAGE_METHODS[stage].attributes, ["security", "accuracy", "maintainability"]);
  }
});

test("A PRD critique that omits security cannot open the gate.", () => {
  const panel = prdPanel();
  panel.critiqueOfA.attributes = panel.critiqueOfA.attributes.filter((item) => item.attribute !== "security");
  const issues = reviewPanelIssues(panel, panelCalls(panel, FEATURE_B_BRIEF));
  assert.ok(issues.includes("quality-attribute-missing:critique-of-a:security"));
});

test("The architecture synthesis must meet the accuracy limit. The rejected option records the reason that it failed.", () => {
  const panel = architecturePanel();
  const issues = reviewPanelIssues(panel, panelCalls(panel, FEATURE_B_BRIEF));
  assert.deepEqual(issues, []);
  const accuracy = panel.critiqueOfA.attributes.find((item) => item.attribute === "accuracy");
  assert.equal(accuracy?.met, false);
  assert.equal(panel.rationale.attributes.find((item) => item.attribute === "accuracy")?.met, true);
});

test("The code rejects a review that calls a failed test accurate. It also rejects a blind test.", () => {
  const lie = executionGate("implementation", {
    sawDiff: true,
    attributes: [
      { attribute: "security", met: true, note: "Synthetic ids only." },
      { attribute: "accuracy", met: true, note: "Looks fine." },
      { attribute: "maintainability", met: true, note: "One function." },
    ],
    tests: [{ id: "AC-CO50-NOTE", passed: false }],
  });
  assert.ok(lie.includes("accuracy-oracle-red:AC-CO50-NOTE"));
  assert.ok(lie.includes("review-contradicts-oracle"));
  assert.deepEqual(
    mutationOracleIssues([{ caseId: "AC-CO50-NOTE", failsOnDefect: false, passesOnFix: true }]),
    ["oracle-blind:AC-CO50-NOTE"],
  );
});
