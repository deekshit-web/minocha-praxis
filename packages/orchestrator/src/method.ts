import type { PanelStage } from "./panel.ts";

/**
 * Quality is the first ordering rule, cost the second, speed the third.
 * Security, accuracy, and maintainability are the quality attributes every
 * product stage has to account for. A stage adds a model call only when that
 * call can catch a defect the cheaper check cannot.
 */
export const QUALITY_ATTRIBUTES = ["security", "accuracy", "maintainability"] as const;

export type QualityAttribute = (typeof QUALITY_ATTRIBUTES)[number];

export type StageMethod =
  | "analyze-critique-synthesize"
  | "plan-then-review-and-execute"
  | "review-and-execute"
  | "analyze-critique-synthesize-plus-oracle";

export interface StageMethodSpec {
  method: StageMethod;
  /** Attributes a critique must write a note for. Missing a note blocks the gate. */
  attributes: readonly QualityAttribute[];
  /** Model calls on the happy path. Used as the cost comparison, not as a quality score. */
  modelCalls: number;
  reason: string;
}

export const STAGE_METHODS: Record<PanelStage, StageMethodSpec> = {
  questions: {
    method: "analyze-critique-synthesize",
    attributes: ["accuracy"],
    modelCalls: 5,
    reason: "A wrong question changes the requirement. Two analysts and a cross-critique are enough. Security is judged on the requirement document, not on the question list.",
  },
  prd: {
    method: "analyze-critique-synthesize",
    attributes: ["security", "accuracy", "maintainability"],
    modelCalls: 5,
    reason:
      "A wrong requirement is the most expensive defect. Two independent analyses and a cross-critique find omissions one draft misses. Deterministic checks then prove testability, PHI rules, and CARC wording. Another model cannot replace those checks.",
  },
  architecture: {
    method: "analyze-critique-synthesize",
    attributes: ["security", "accuracy", "maintainability"],
    modelCalls: 5,
    reason:
      "Two options are scored the way an architecture tradeoff review scores them: security, accuracy, and maintainability. Cross-critique makes the losing option defend itself. The synthesis records which option won and why. Code is not written twice.",
  },
  implementation: {
    method: "plan-then-review-and-execute",
    attributes: ["security", "accuracy", "maintainability"],
    modelCalls: 7,
    reason:
      "The plan is analyze, cross-critique, and synthesize, because a wrong file list is cheap to catch in prose. The code is written once. An independent reviewer reads the diff for security and maintainability. The test run is the accuracy oracle. A second implementation merged by a third model costs more and disagrees with the executable result.",
  },
  repair: {
    method: "review-and-execute",
    attributes: ["accuracy", "security"],
    modelCalls: 2,
    reason:
      "The failing assertion already names the defect. One reviewer reads that output and one patch follows. A fresh pair of implementations would ignore the evidence the test just produced.",
  },
  test_design: {
    method: "analyze-critique-synthesize-plus-oracle",
    attributes: ["security", "accuracy", "maintainability"],
    modelCalls: 5,
    reason:
      "Cases are analyzed from the approved scenarios only, then cross-critiqued for missing negative cases. The oracle executes a P0 case against the known bug and the fix. A case that stays green on the bug is inaccurate, whatever the critique says.",
  },
};

export interface AttributeFinding {
  attribute: QualityAttribute;
  met: boolean;
  note: string;
}

export function missingAttributes(
  findings: readonly AttributeFinding[] | undefined,
  required: readonly QualityAttribute[],
  label: string,
): string[] {
  const issues: string[] = [];
  for (const attribute of required) {
    const finding = findings?.find((item) => item.attribute === attribute && item.note.trim().length > 0);
    if (!finding) issues.push(`quality-attribute-missing:${label}:${attribute}`);
  }
  return issues;
}

export interface ExecutionCheck {
  attributes: AttributeFinding[];
  sawDiff: boolean;
  tests: Array<{ id: string; passed: boolean }>;
}

/**
 * Code and repair accuracy comes from the test run.
 * A review that calls accuracy met while a required test is red is discarded.
 */
export function executionGate(stage: "implementation" | "repair", check: ExecutionCheck): string[] {
  const issues = missingAttributes(check.attributes, STAGE_METHODS[stage].attributes, stage);
  if (!check.sawDiff) issues.push("reviewer-missed-diff");
  const red = check.tests.filter((test) => !test.passed);
  for (const test of red) issues.push(`accuracy-oracle-red:${test.id}`);
  const accuracy = check.attributes.find((item) => item.attribute === "accuracy");
  if (accuracy?.met === true && red.length > 0) issues.push("review-contradicts-oracle");
  for (const finding of check.attributes) {
    if (finding.met === false && red.length === 0 && finding.attribute === "accuracy") {
      issues.push("accuracy-unmet-without-red-test");
    }
  }
  return issues;
}

export interface MutationOracle {
  caseId: string;
  /** The case fails while the known defect is present. */
  failsOnDefect: boolean;
  /** The same case passes once the defect is gone. */
  passesOnFix: boolean;
}

/** A test that cannot see the bug it claims to cover does not count. */
export function mutationOracleIssues(results: readonly MutationOracle[]): string[] {
  const issues: string[] = [];
  for (const result of results) {
    if (!result.failsOnDefect) issues.push(`oracle-blind:${result.caseId}`);
    if (!result.passesOnFix) issues.push(`oracle-fails-fix:${result.caseId}`);
  }
  return issues;
}
