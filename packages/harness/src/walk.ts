import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Run,
  acceptSuggestion,
  alignTestCases,
  applyRecord,
  architectureIssues,
  automationIssues,
  executionGate,
  fenceViolations,
  findPhi,
  findSecrets,
  hashValue,
  intakeDecision,
  missingAssertions,
  mutationOracleIssues,
  nextUnitAttempt,
  prdGateIssues,
  prdIssues,
  questionSetIssues,
  repoRoot,
  reviewPanelIssues,
  untestableFenceIssues,
  type AttributeFinding,
  type RecordInput,
  type ReviewPanel,
} from "@northwind/orchestrator";
import { appealReady, appealReadyBuggy, co50MissingNoteSample } from "@northwind/domain";
import { citationPaths, loadPack } from "@northwind/knowledge";
import {
  FEATURE_B_BRIEF,
  FEATURE_C_CITATIONS,
  RULES,
  architecturePanel,
  groundedCitations,
  implementationPanel,
  panelCalls,
  playwrightTitles,
  prdPanel,
  questionPanel,
  testCasePanel,
} from "./panels.ts";

function codeAttributes(note: string, accuracyMet: boolean): AttributeFinding[] {
  return [
    { attribute: "security", met: true, note },
    { attribute: "accuracy", met: accuracyMet, note },
  ];
}

function demand(issues: string[], label: string): void {
  if (issues.length > 0) throw new Error(`${label}: ${issues.join(", ")}`);
}

function publishPlain<T>(run: Run, name: string, panel: ReviewPanel<T>): string[] {
  const issues = reviewPanelIssues(panel, panelCalls(panel, FEATURE_B_BRIEF));
  run.putArtifact(`${name}.proposalA`, panel.proposalA);
  run.putArtifact(`${name}.proposalB`, panel.proposalB);
  run.putArtifact(`${name}.panel`, panel);
  run.putArtifact(name, panel.synthesis);
  return issues;
}

export interface FeatureBRun {
  run: Run;
  unitLog: string[];
  droppedCases: string[];
}

const TO_RECORD_GATE = [
  "clarifying",
  "prd_draft",
  "prd_gate",
  "architecture_draft",
  "architecture_gate",
  "implementing",
  "unit_loop",
  "test_design",
  "test_gate",
  "automating",
  "e2e",
  "record_gate",
] as const;

export function reach(run: Run, target: (typeof TO_RECORD_GATE)[number]): void {
  for (const state of TO_RECORD_GATE) {
    run.transition(state, "orchestrator");
    if (state === target) return;
  }
}

/** Everything the run produced: each stored document, panel, prompt, and code diff. */
export function runOutput(run: Run): string {
  return JSON.stringify([...run.artifacts.values()].map((artifact) => artifact.body));
}

/** Approvals come from the hashes, the unit and P0 results from the caller's runs, and the scans from the run output. */
export function recordInput(run: Run, checks: { unitGreen: boolean; p0Green: boolean }): RecordInput {
  const output = runOutput(run);
  return {
    prdApproved: run.approvalMatches("prd", "prd"),
    architectureApproved: run.approvalMatches("architecture", "architecture"),
    testCasesApproved: run.approvalMatches("test_cases", "test_cases"),
    unitGreen: checks.unitGreen,
    p0Green: checks.p0Green,
    phiClean: findPhi(output).length === 0,
    secretsClean: findSecrets(output).length === 0,
  };
}

export function walkFeatureB(options: { record?: boolean } = {}): FeatureBRun {
  const run = new Run("feature-b");
  const intake = intakeDecision(FEATURE_B_BRIEF);
  if (!intake.ok) {
    run.block("phi");
    return { run, unitLog: [], droppedCases: [] };
  }
  run.transition("clarifying", "orchestrator");

  const questions = questionPanel();
  demand([...publishPlain(run, "questions", questions), ...questionSetIssues(questions.synthesis)], "questions");
  run.transition("prd_draft", "orchestrator");

  const prd = prdPanel();
  demand(
    [...publishPlain(run, "prd", prd), ...prdGateIssues(prd.synthesis, prdIssues(prd.synthesis, groundedCitations(FEATURE_B_BRIEF), RULES))],
    "prd",
  );
  run.transition("prd_gate", "orchestrator");
  run.approve("prd", "prd", "approve");
  run.transition("architecture_draft", "orchestrator");

  const architecture = architecturePanel();
  const criterionIds = prd.synthesis.acceptanceCriteria.map((criterion) => criterion.id);
  const pendingIssues = architectureIssues(architecture.synthesis, criterionIds, groundedCitations(FEATURE_B_BRIEF), RULES);
  if (!pendingIssues.includes("pending-suggestion:S-1")) {
    throw new Error(`Suggestion S-1 must stay pending until a person accepts it: ${pendingIssues.join(", ")}`);
  }
  const accepted = acceptSuggestion(architecture.synthesis, "S-1");
  demand(
    [
      ...reviewPanelIssues(architecture, panelCalls(architecture, FEATURE_B_BRIEF)),
      ...untestableFenceIssues(architecture),
      ...architectureIssues(accepted, criterionIds, groundedCitations(FEATURE_B_BRIEF), RULES),
    ],
    "architecture",
  );
  run.putArtifact("architecture.proposalA", architecture.proposalA);
  run.putArtifact("architecture.proposalB", architecture.proposalB);
  run.putArtifact("architecture.panel", architecture);
  run.putArtifact("architecture", accepted);
  run.transition("architecture_gate", "orchestrator");
  run.approve("architecture", "architecture", "approve");
  run.transition("implementing", "orchestrator");

  const implementation = implementationPanel();
  const fence = architecture.synthesis.fileFence;
  demand(
    [
      ...publishPlain(run, "implementation", implementation),
      ...fenceViolations(implementation.synthesis.files, fence).map((hit) => `${hit.reason}:${hit.file}`),
    ],
    "implementation",
  );
  run.transition("unit_loop", "orchestrator");

  const sample = co50MissingNoteSample();
  const buggy = appealReadyBuggy(sample);
  const oracle = appealReady(sample);
  const failure = `AC-CO50-NOTE expected ready false, seeded bug returned ${buggy.ready}`;
  const first = nextUnitAttempt({ priorFingerprints: [], diff: "return ready without the note", failureOutput: failure });
  if (first.action !== "retry" || !buggy.ready || oracle.ready) {
    throw new Error(`Unit oracle did not fail then stay retryable: ${first.action}`);
  }
  run.transition("unit_loop", "orchestrator", failure);
  const redReview = executionGate("repair", {
    sawDiff: true,
    attributes: codeAttributes("AC-CO50-NOTE is red. The seeded function returns ready with no note.", false),
    tests: [{ id: "AC-CO50-NOTE", passed: false }],
  });
  if (!redReview.includes("accuracy-oracle-red:AC-CO50-NOTE")) {
    throw new Error(`A red oracle must block the repair: ${redReview.join(", ")}`);
  }
  const contradicted = executionGate("repair", {
    sawDiff: true,
    attributes: codeAttributes("The reviewer claims the gate is correct.", true),
    tests: [{ id: "AC-CO50-NOTE", passed: false }],
  });
  if (!contradicted.includes("review-contradicts-oracle")) {
    throw new Error("A review cannot overrule a red test");
  }
  run.putArtifact("code.review.red", { issues: redReview, failure });
  const second = nextUnitAttempt({
    priorFingerprints: [first.fingerprint],
    diff: "require the clinical-note reference",
    failureOutput: null,
  });
  if (second.action !== "advance") throw new Error("Repair did not advance");
  const greenReview = executionGate("repair", {
    sawDiff: true,
    attributes: codeAttributes("The patch restores the missing-note branch. Identifiers stay synthetic.", true),
    tests: [{ id: "AC-CO50-NOTE", passed: oracle.ready === false }],
  });
  demand(greenReview, "repair-review");
  run.putArtifact("code.review", { method: "review-and-execute", sawDiff: true });
  run.transition("test_design", "orchestrator", "AC-CO50-NOTE passed");

  const tests = testCasePanel();
  const aligned = alignTestCases(tests.synthesis, prd.synthesis.scenarios.map((scenario) => scenario.id));
  const oracleCheck = mutationOracleIssues([
    {
      caseId: "AC-CO50-NOTE",
      failsOnDefect: buggy.ready === true,
      passesOnFix: oracle.ready === false,
    },
  ]);
  demand([...publishPlain(run, "test_cases", tests), ...aligned.issues, ...oracleCheck], "test-cases");
  run.transition("test_gate", "orchestrator");
  run.approve("test_cases", "test_cases", "approve");
  run.transition("automating", "orchestrator");
  demand(automationIssues(aligned.cases, playwrightTitles()), "automation");
  run.transition("e2e", "orchestrator");
  run.transition("record_gate", "orchestrator");

  const source = readFileSync(join(repoRoot(), "packages/domain/src/appealReady.test.ts"), "utf8");
  demand(missingAssertions(source, implementation.synthesis.assertionIds), "assertions");

  if (options.record !== false) {
    const recorded = applyRecord(run, recordInput(run, { unitGreen: oracle.ready === false, p0Green: true }));
    if (!recorded.ok) throw new Error(recorded.reasons.join(","));
  }
  return { run, unitLog: [failure, "AC-CO50-NOTE passed"], droppedCases: aligned.dropped };
}

export function blockSsn(): Run {
  const run = new Run("ssn");
  const decision = intakeDecision("Follow up on patient SSN 123-45-6789 before the statement.");
  if (!decision.ok) run.block(`phi:${decision.findings.map((finding) => finding.kind).join(",")}`);
  return run;
}

export function stallRun(): Run {
  const run = new Run("stall");
  reach(run, "unit_loop");
  const failure = "AC-CO50-NOTE expected ready false, seeded bug returned true";
  const first = nextUnitAttempt({ priorFingerprints: [], diff: "same patch", failureOutput: failure });
  const second = nextUnitAttempt({ priorFingerprints: [first.fingerprint], diff: "same patch", failureOutput: failure });
  if (second.action !== "stalled") throw new Error(second.action);
  run.block("stalled");
  return run;
}

export function featureCCitesFeatureA(): boolean {
  const packRoot = join(repoRoot(), "packages/knowledge/pack");
  const known = citationPaths(loadPack(packRoot));
  return FEATURE_C_CITATIONS.every((citation) => known.has(citation) && citation.includes("decisions/ADR-001"));
}

export function synthesisHash(panel: ReviewPanel<unknown>): { synthesis: string; proposalA: string } {
  return { synthesis: hashValue(panel.synthesis), proposalA: hashValue(panel.proposalA) };
}
