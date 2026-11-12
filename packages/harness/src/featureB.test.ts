import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { appealReady, appealReadyBuggy, buildSeed, co50MissingNoteSample } from "@northwind/domain";
import { loadPack, retrieve } from "@northwind/knowledge";
import {
  TransitionError,
  alignTestCases,
  applyRecord,
  automationIssues,
  fenceViolations,
  findPhi,
  hashValue,
  intakeNouns,
  repoRoot,
  reviewPanelIssues,
} from "@northwind/orchestrator";
import {
  FEATURE_B_BRIEF,
  architecturePanel,
  groundedCitations,
  leakedAnalystPrompt,
  panelCalls,
  playwrightTitles,
  prdPanel,
  testCasePanel,
} from "./panels.ts";
import { blockSsn, featureCCitesFeatureA, recordInput, stallRun, synthesisHash, walkFeatureB } from "./walk.ts";

function hashOfPanel(panel: unknown): string {
  return hashValue(panel);
}

test("Feature B goes through each gate to the recorded state. The synthesis is approved.", () => {
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

test("The architecture gate stays closed when a critique is missing. It also stays closed when a proposal leaks.", () => {
  const panel = architecturePanel();
  const calls = panelCalls(panel, FEATURE_B_BRIEF);
  const withoutCritique = calls.filter((call) => call.role !== "critiqueOfA");
  assert.ok(reviewPanelIssues(panel, withoutCritique).includes("missing-call:critiqueOfA"));
  assert.ok(reviewPanelIssues(panel, leakedAnalystPrompt(FEATURE_B_BRIEF)).includes("analyst-b-saw-proposal-a"));
});

test("The seeded CO-50 bug fails the oracle. The repair passes the oracle.", () => {
  const sample = co50MissingNoteSample();
  assert.equal(appealReadyBuggy(sample).ready, true);
  assert.equal(appealReady(sample).ready, false);
});

test("A repeated unit failure stops the run.", () => {
  const run = stallRun();
  assert.equal(run.state, "blocked");
  assert.equal(run.blockedReason, "stalled");
});

test("A factory path is outside the fence of Feature B.", () => {
  const hits = fenceViolations(
    ["packages/factory/src/page.ts", "packages/domain/src/appealReady.ts"],
    architecturePanel().synthesis.fileFence,
  );
  assert.deepEqual(hits, [{ file: "packages/factory/src/page.ts", reason: "forbidden" }]);
});

test("An SSN in the brief stops the intake. No document is made.", () => {
  const run = blockSsn();
  assert.equal(run.state, "blocked");
  assert.equal(run.history[0]?.from, "intake");
  assert.equal(run.artifacts.size, 0);
  assert.match(run.blockedReason ?? "", /ssn/);
});

test("If a P0 ID is removed from the Playwright titles, the automation check fails.", () => {
  const prdScenarios = ["SCN-1", "SCN-2", "SCN-3", "SCN-4", "SCN-5", "SCN-6"];
  const aligned = alignTestCases(testCasePanel().synthesis, prdScenarios);
  const titles = playwrightTitles().filter((title) => !title.startsWith("TC-2"));
  assert.ok(automationIssues(aligned.cases, titles).includes("p0-without-test:TC-2"));
});

test("The run stays at the record gate while a P0 case fails. It records the run when the P0 case passes.", () => {
  const { run } = walkFeatureB({ record: false });
  assert.equal(run.state, "record_gate");
  const red = applyRecord(run, recordInput(run, { unitGreen: true, p0Green: false }));
  assert.deepEqual(red, { ok: false, reasons: ["p0-red"] });
  assert.equal(run.state, "record_gate");
  const green = applyRecord(run, recordInput(run, { unitGreen: true, p0Green: true }));
  assert.equal(green.ok, true);
  assert.equal(run.state, "recorded");
});

test("The record step rejects a failed unit run. It scans the output of the run and not the seed.", () => {
  const { run } = walkFeatureB({ record: false });
  assert.deepEqual(applyRecord(run, recordInput(run, { unitGreen: false, p0Green: true })), { ok: false, reasons: ["unit-red"] });
  run.putArtifact("code.diff", "+ // call the patient at 415-555-0134\n+ const apiKey = sk-abcdef123456;");
  assert.deepEqual(applyRecord(run, recordInput(run, { unitGreen: true, p0Green: true })), {
    ok: false,
    reasons: ["phi", "secrets"],
  });
  assert.equal(run.state, "record_gate");
});

test("Feature C cites the coverage decision that was written for Feature A.", () => {
  assert.equal(featureCCitesFeatureA(), true);
});

test("The synthetic seed contains no PHI and no secret.", () => {
  assert.deepEqual(findPhi(JSON.stringify(buildSeed())), []);
});

test("The recorded state cannot go back to intake.", () => {
  const { run } = walkFeatureB();
  assert.throws(() => run.transition("intake", "agent"), TransitionError);
});

test("Retrieval for the Feature B brief finds each file that the PRD and the architecture cite.", () => {
  const grounded = groundedCitations(FEATURE_B_BRIEF);
  const cited = [...prdPanel().synthesis.citations, ...architecturePanel().synthesis.citations];
  assert.ok(cited.includes("pack/phi-policy.md"));
  assert.ok(cited.includes("pack/roles.md"));
  assert.deepEqual(cited.filter((citation) => !grounded.has(citation)), []);
  const shown = retrieve(loadPack(join(repoRoot(), "packages/knowledge/pack")), intakeNouns(FEATURE_B_BRIEF), 4);
  assert.equal(shown[0]?.path, "phi-policy.md");
});
