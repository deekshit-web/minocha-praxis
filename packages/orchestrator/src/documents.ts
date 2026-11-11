import { carcRule, type CarcRule } from "@northwind/domain";
import { fencePatternIssues } from "./fence.ts";

export interface Assumption {
  answerId: string;
  text: string;
}

export interface Requirement {
  id: string;
  statement: string;
  rationale: string;
}

export interface AcceptanceCriterion {
  id: string;
  requirementId: string;
  given: string;
  when: string;
  then: string;
  priority: "P0" | "P1";
}

export interface Scenario {
  id: string;
  criterionIds: string[];
  role: string;
  startingState: string;
  steps: string[];
  expected: string;
}

export interface ScreenSpec {
  id: string;
  title: string;
  purpose: string;
  scenarioIds: string[];
}

export interface CarcReference {
  code: string;
  nextAction: string;
}

export interface Prd {
  problem: string;
  users: string[];
  inScope: string[];
  outOfScope: string[];
  assumptions: Assumption[];
  requirements: Requirement[];
  acceptanceCriteria: AcceptanceCriterion[];
  scenarios: Scenario[];
  screens: ScreenSpec[];
  openQuestions: Array<{ id: string; text: string }>;
  citations: string[];
  carcReferences: CarcReference[];
}

export interface Suggestion {
  id: string;
  text: string;
  impact: string;
  decision: "accept" | "reject" | "pending";
  appliedChange: string;
}

export interface Architecture {
  context: string;
  modules: Array<{ name: string; responsibility: string }>;
  dataModel: Array<{ entity: string; fields: string[] }>;
  requirementMap: Array<{ acceptanceCriterionId: string; module: string; testKind: "unit" | "e2e" }>;
  fileFence: string[];
  suggestions: Suggestion[];
  risks: string[];
  phiNote: string;
  citations: string[];
  carcReferences: CarcReference[];
}

export interface TestCase {
  id: string;
  scenarioIds: string[];
  priority: "P0" | "P1";
  preconditions: string;
  steps: string[];
  expected: string;
  automation: "unit" | "e2e";
}

export interface TestCaseSet {
  cases: TestCase[];
}

export interface QuestionOption {
  id: string;
  label: string;
  consequence: string;
}

export interface Question {
  id: string;
  prompt: string;
  why: string;
  options: QuestionOption[];
  defaultOptionId: string;
}

export interface QuestionSet {
  questions: Question[];
}

export interface ImplementationPlan {
  summary: string;
  files: string[];
  assertionIds: string[];
}

function unique(ids: string[]): boolean {
  return new Set(ids).size === ids.length;
}

function carcIssues(references: CarcReference[], rules: readonly CarcRule[]): string[] {
  const issues: string[] = [];
  for (const reference of references) {
    const rule = rules.find((item) => item.code === reference.code) ?? carcRule(reference.code);
    if (!rule) {
      issues.push(`unmapped-carc:${reference.code}`);
      continue;
    }
    if (reference.nextAction !== rule.nextAction) issues.push(`carc-action-mismatch:${reference.code}`);
  }
  return issues;
}

function citationIssues(citations: string[], known: Set<string>): string[] {
  return citations.filter((citation) => !known.has(citation)).map((citation) => `missing-citation:${citation}`);
}

export function questionSetIssues(set: QuestionSet): string[] {
  const issues: string[] = [];
  if (set.questions.length === 0 || set.questions.length > 5) issues.push("question-count");
  for (const question of set.questions) {
    if (question.options.length < 2) issues.push(`question-options:${question.id}`);
    if (!question.options.some((option) => option.id === question.defaultOptionId)) {
      issues.push(`question-default:${question.id}`);
    }
  }
  return issues;
}

export function prdIssues(prd: Prd, knownCitations: Set<string>, rules: readonly CarcRule[] = []): string[] {
  const issues: string[] = [];
  if (prd.requirements.length < 4) issues.push("requirement-minimum");
  const requirementIds = prd.requirements.map((item) => item.id);
  const criterionIds = prd.acceptanceCriteria.map((item) => item.id);
  const scenarioIds = prd.scenarios.map((item) => item.id);
  if (!unique(requirementIds) || requirementIds.some((id) => !/^REQ-\d+$/.test(id))) issues.push("requirement-ids");
  if (!unique(criterionIds) || criterionIds.some((id) => !/^AC-\d+$/.test(id))) issues.push("criterion-ids");
  if (!unique(scenarioIds) || scenarioIds.some((id) => !/^SCN-\d+$/.test(id))) issues.push("scenario-ids");
  if (prd.screens.length !== 3 || prd.screens.some((screen) => !/^SCR-\d+$/.test(screen.id))) issues.push("screen-count");

  for (const requirement of prd.requirements) {
    if (!prd.acceptanceCriteria.some((criterion) => criterion.requirementId === requirement.id)) {
      issues.push(`requirement-without-criterion:${requirement.id}`);
    }
  }
  for (const criterion of prd.acceptanceCriteria) {
    if (!requirementIds.includes(criterion.requirementId)) issues.push(`orphan-criterion:${criterion.id}`);
    if (!criterion.given || !criterion.when || !criterion.then) issues.push(`unobservable-criterion:${criterion.id}`);
    if (
      criterion.priority === "P0" &&
      !prd.scenarios.some((scenario) => scenario.criterionIds.includes(criterion.id))
    ) {
      issues.push(`p0-without-scenario:${criterion.id}`);
    }
  }
  for (const scenario of prd.scenarios) {
    if (!scenario.role.trim()) issues.push(`scenario-role:${scenario.id}`);
    if (scenario.steps.length === 0) issues.push(`scenario-steps:${scenario.id}`);
    if (scenario.criterionIds.some((id) => !criterionIds.includes(id))) issues.push(`scenario-criterion:${scenario.id}`);
  }
  for (const screen of prd.screens) {
    if (screen.scenarioIds.length === 0 || screen.scenarioIds.some((id) => !scenarioIds.includes(id))) {
      issues.push(`screen-scenario:${screen.id}`);
    }
  }
  issues.push(...citationIssues(prd.citations, knownCitations));
  issues.push(...carcIssues(prd.carcReferences, rules));
  return issues;
}

/**
 * A PRD may leave something open, or propose an answer the decisions did not make, as long as it says so:
 * every open question starts with "Proposed:" or "Open:", so the approver can see what was not agreed.
 */
export function prdGateIssues(prd: Prd, structural: string[]): string[] {
  const issues = [...structural];
  for (const question of prd.openQuestions) {
    if (!/^(Proposed|Open):/.test(question.text.trim())) issues.push(`open-question-unflagged:${question.id}`);
  }
  return issues;
}

/** The human accepts a pending suggestion before the architecture hash can be approved. */
export function acceptSuggestion(architecture: Architecture, id: string): Architecture {
  const suggestion = architecture.suggestions.find((item) => item.id === id);
  if (!suggestion) throw new Error(`Unknown suggestion ${id}`);
  if (!suggestion.appliedChange.trim()) throw new Error(`Suggestion ${id} has no change to apply`);
  return {
    ...architecture,
    suggestions: architecture.suggestions.map((item) => (item.id === id ? { ...item, decision: "accept" } : item)),
  };
}

/** Reject leaves the suggestion decided and does not apply it. Approve stays closed. */
export function rejectSuggestion(architecture: Architecture, id: string): Architecture {
  const suggestion = architecture.suggestions.find((item) => item.id === id);
  if (!suggestion) throw new Error(`Unknown suggestion ${id}`);
  return {
    ...architecture,
    suggestions: architecture.suggestions.map((item) => (item.id === id ? { ...item, decision: "reject" } : item)),
  };
}

export function architectureIssues(
  architecture: Architecture,
  criterionIds: string[],
  knownCitations: Set<string>,
  rules: readonly CarcRule[] = [],
): string[] {
  const issues: string[] = [];
  const mapped = new Set(architecture.requirementMap.map((item) => item.acceptanceCriterionId));
  for (const id of criterionIds) {
    if (!mapped.has(id)) issues.push(`unmapped-criterion:${id}`);
  }
  const usedModules = new Set(architecture.requirementMap.map((item) => item.module));
  for (const module of architecture.modules) {
    if (!usedModules.has(module.name)) issues.push(`unused-module:${module.name}`);
  }
  for (const item of architecture.requirementMap) {
    if (!architecture.modules.some((module) => module.name === item.module)) issues.push(`unknown-module:${item.module}`);
  }
  issues.push(...fencePatternIssues(architecture.fileFence));
  for (const suggestion of architecture.suggestions) {
    if (suggestion.decision === "pending") issues.push(`pending-suggestion:${suggestion.id}`);
    if (suggestion.decision === "accept" && suggestion.appliedChange.trim() === "") {
      issues.push(`accepted-without-change:${suggestion.id}`);
    }
  }
  if (!architecture.phiNote.trim()) issues.push("phi-note");
  issues.push(...citationIssues(architecture.citations, knownCitations));
  issues.push(...carcIssues(architecture.carcReferences, rules));
  return issues;
}

export function alignTestCases(
  set: TestCaseSet,
  scenarioIds: string[],
): { cases: TestCase[]; dropped: string[]; issues: string[] } {
  const known = new Set(scenarioIds);
  const dropped: string[] = [];
  const cases: TestCase[] = [];
  for (const testCase of set.cases) {
    const cited = testCase.scenarioIds.filter((id) => known.has(id));
    const unknown = testCase.scenarioIds.filter((id) => !known.has(id));
    dropped.push(...unknown);
    if (cited.length === 0) {
      dropped.push(testCase.id);
      continue;
    }
    cases.push({ ...testCase, scenarioIds: cited });
  }
  const issues: string[] = [];
  if (cases.some((testCase) => !/^TC-\d+$/.test(testCase.id))) issues.push("test-case-ids");
  for (const scenarioId of scenarioIds) {
    if (!cases.some((testCase) => testCase.scenarioIds.includes(scenarioId))) issues.push(`uncovered-scenario:${scenarioId}`);
  }
  return { cases, dropped, issues };
}

export function automationIssues(cases: TestCase[], titles: string[]): string[] {
  const issues: string[] = [];
  const known = new Set(cases.map((testCase) => testCase.id));
  for (const testCase of cases) {
    if (testCase.priority !== "P0") continue;
    if (!titles.some((title) => title.includes(testCase.id))) issues.push(`p0-without-test:${testCase.id}`);
  }
  for (const title of titles) {
    for (const match of title.matchAll(/TC-\d+/g)) {
      if (!known.has(match[0])) issues.push(`unknown-test-id:${match[0]}`);
    }
  }
  return issues;
}

export function missingAssertions(source: string, ids: string[]): string[] {
  return ids.filter((id) => !source.includes(id));
}
