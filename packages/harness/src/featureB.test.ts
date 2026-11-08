import assert from "node:assert/strict";
import test from "node:test";
import { appealReady, appealReadyBuggy, buildSeed, co50MissingNoteSample } from "../../domain/src/index.ts";
import { applyRecord } from "../../orchestrator/src/record.ts";
import { automationIssues } from "../../orchestrator/src/documents.ts";
import { fenceViolations } from "../../orchestrator/src/fence.ts";
import { hashValue } from "../../orchestrator/src/hash.ts";
import { reviewPanelIssues } from "../../orchestrator/src/panel.ts";
import { findPhi } from "../../orchestrator/src/phi.ts";
import { TransitionError } from "../../orchestrator/src/run.ts";
import { alignTestCases } from "../../orchestrator/src/documents.ts";
import {
  FEATURE_B_BRIEF,
  architecturePanel,
  leakedAnalystPrompt,
  panelCalls,
  playwrightTitles,
  testCasePanel,
} from "./panels.ts";
import { blockSsn, featureCCitesFeatureA, recordInput, stallRun, synthesisHash, walkFeatureB } from "./walk.ts";

function hashOfPanel(panel: unknown): string {
  return hashValue(panel);
}

test("Feature B walks every gate to recorded and approves the synthesis", () => {
  const { run, unitLog, droppedCases } = walkFeatureB();
  assert.equal(run.state, "recorded");
  assert.match(unitLog[0]!, /AC-CO50-NOTE/);
  assert.match(unitLog[1]!, /passed/);
  assert.ok(droppedCases.includes("SCN-404"));
  const panel = architecturePanel();
  const hashes = synthesisHash(panel);
  assert.notEqual(hashes.synthesis, hashes.proposalA);
  assert.equal(panel.synthesis.suggestions[0]?.decision, "pending");
  assert.equal(run.artifacts.get("architecture.panel")?.hash, hashOfPanel(panel));
  const approved = run.artifacts.get("architecture")?.body as { suggestions: Array<{ decision: string }> };
  assert.equal(approved.suggestions[0]?.decision, "accept");
  assert.notEqual(run.artifacts.get("architecture")?.hash, hashes.proposalA);
  assert.equal(run.approvalMatches("architecture", "architecture"), true);
  assert.equal(run.approvalMatches("prd", "prd"), true);
  assert.ok(architecturePanel().synthesis.fileFence.some((pattern) => pattern.startsWith("packages/domain")));
  run.putArtifact("architecture", { ...architecturePanel().synthesis, context: "edited after approval" });
  assert.equal(run.approvalMatches("architecture", "architecture"), false);
});

test("a missing critique or a leaked proposal cannot open the architecture gate", () => {
  const panel = architecturePanel();
  const calls = panelCalls(panel, FEATURE_B_BRIEF);
  const withoutCritique = calls.filter((call) => call.role !== "critiqueOfA");
  assert.ok(reviewPanelIssues(panel, withoutCritique).includes("missing-call:critiqueOfA"));
  assert.ok(reviewPanelIssues(panel, leakedAnalystPrompt(FEATURE_B_BRIEF)).includes("analyst-b-saw-proposal-a"));
});

test("the seeded CO-50 bug fails the oracle and the repair passes it", () => {
  const sample = co50MissingNoteSample();
  assert.equal(appealReadyBuggy(sample).ready, true);
  assert.equal(appealReady(sample).ready, false);
});

test("a repeated unit failure stalls", () => {
  const run = stallRun();
  assert.equal(run.state, "blocked");
  assert.equal(run.blockedReason, "stalled");
});

test("a factory path is outside the Feature B fence", () => {
  const hits = fenceViolations(
    ["packages/factory/src/page.ts", "packages/domain/src/appealReady.ts"],
    architecturePanel().synthesis.fileFence,
  );
  assert.deepEqual(hits, [{ file: "packages/factory/src/page.ts", reason: "forbidden" }]);
});

test("an SSN in the brief blocks intake before a document exists", () => {
  const run = blockSsn();
  assert.equal(run.state, "blocked");
  assert.equal(run.history[0]?.from, "intake");
  assert.equal(run.artifacts.size, 0);
  assert.match(run.blockedReason ?? "", /ssn/);
});

test("dropping a P0 id from the Playwright titles fails the automation check", () => {
  const prdScenarios = ["SCN-1", "SCN-2", "SCN-3", "SCN-4", "SCN-5", "SCN-6"];
  const aligned = alignTestCases(testCasePanel().synthesis, prdScenarios);
  const titles = playwrightTitles().filter((title) => !title.startsWith("TC-2"));
  assert.ok(automationIssues(aligned.cases, titles).includes("p0-without-test:TC-2"));
});

test("the run stays on the record gate while a P0 is red, then records when it is green", () => {
  const { run } = walkFeatureB({ record: false });
  assert.equal(run.state, "record_gate");
  const red = applyRecord(run, recordInput(run, { unitGreen: true, p0Green: false }));
  assert.deepEqual(red, { ok: false, reasons: ["p0-red"] });
  assert.equal(run.state, "record_gate");
  const green = applyRecord(run, recordInput(run, { unitGreen: true, p0Green: true }));
  assert.equal(green.ok, true);
  assert.equal(run.state, "recorded");
});

test("recording refuses a red unit run and scans what the run produced, not the seed", () => {
  const { run } = walkFeatureB({ record: false });
  assert.deepEqual(applyRecord(run, recordInput(run, { unitGreen: false, p0Green: true })), { ok: false, reasons: ["unit-red"] });
  run.putArtifact("code.diff", "+ // call the patient at 415-555-0134\n+ const apiKey = sk-abcdef123456;");
  assert.deepEqual(applyRecord(run, recordInput(run, { unitGreen: true, p0Green: true })), {
    ok: false,
    reasons: ["phi", "secrets"],
  });
  assert.equal(run.state, "record_gate");
});

test("Feature C cites the coverage decision written for Feature A", () => {
  assert.equal(featureCCitesFeatureA(), true);
});

test("the synthetic seed has no PHI and no secret", () => {
  assert.deepEqual(findPhi(JSON.stringify(buildSeed())), []);
});

test("recorded cannot jump back to intake", () => {
  const { run } = walkFeatureB();
  assert.throws(() => run.transition("intake", "agent"), TransitionError);
});
