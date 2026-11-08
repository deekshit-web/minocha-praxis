import type { Architecture, Prd, QuestionSet, TestCaseSet } from "../../orchestrator/src/documents.ts";
import { STAGE_METHODS } from "../../orchestrator/src/method.ts";
import type { ReviewPanel } from "../../orchestrator/src/panel.ts";
import type { Run } from "../../orchestrator/src/run.ts";
import type { State } from "../../orchestrator/src/states.ts";

/** What the factory page renders. Nothing here reads or changes a session. */
export interface Block {
  heading: string;
  lines: string[];
}

export interface ViewTab {
  id: string;
  label: string;
  blocks: Block[];
}

export interface FactoryAction {
  id: string;
  label: string;
  enabled: boolean;
  reason: string;
}

export interface FactoryView {
  id: string;
  state: State;
  mode: "recorded";
  workbench: string;
  title: string;
  subtitle: string;
  method: string;
  methodNote: string;
  blockedReason: string | null;
  banner: string | null;
  rail: Array<{ id: string; label: string; status: "done" | "current" | "upcoming" }>;
  tabs: ViewTab[];
  questions: Array<{ id: string; prompt: string; why: string; options: Array<{ id: string; label: string }>; defaultOptionId: string }> | null;
  knowledge: Array<{ path: string; score: number }>;
  log: string[];
  approvals: Array<{ gate: string; hash: string; matches: boolean }>;
  actions: FactoryAction[];
  p0Green: boolean;
  knowledgeError: string | null;
  proposed: Array<{ id: string; title: string; href: string }> | null;
}

export const RAIL_LABELS: Record<string, string> = {
  intake: "Intake",
  clarifying: "Questions",
  prd_draft: "PRD draft",
  prd_gate: "PRD approval",
  architecture_draft: "Architecture",
  architecture_gate: "Architecture approval",
  implementing: "Implementation plan",
  unit_loop: "Unit tests",
  test_design: "Test design",
  test_gate: "Test approval",
  automating: "Trace check",
  e2e: "Scenario trace",
  record_gate: "Record",
  recorded: "Recorded",
};

export function prdBlocks(prd: Prd): Block[] {
  return [
    { heading: "Problem", lines: [prd.problem] },
    { heading: "In scope", lines: prd.inScope },
    { heading: "Out of scope", lines: prd.outOfScope },
    { heading: "Assumptions", lines: prd.assumptions.map((item) => `${item.answerId}: ${item.text}`) },
    { heading: "Requirements", lines: prd.requirements.map((item) => `${item.id}. ${item.statement}`) },
    {
      heading: "Acceptance criteria",
      lines: prd.acceptanceCriteria.map((item) => `${item.id} ${item.priority} ${item.requirementId}: Given ${item.given}. When ${item.when}. Then ${item.then}.`),
    },
    {
      heading: "Scenarios",
      lines: prd.scenarios.map((item) => `${item.id} (${item.role}): ${item.expected}`),
    },
    { heading: "Proposed screens", lines: prd.screens.map((item) => `${item.id} ${item.title}: ${item.purpose}`) },
  ];
}

export function architectureBlocks(architecture: Architecture): Block[] {
  const suggestion = architecture.suggestions[0];
  return [
    { heading: "Context", lines: [architecture.context] },
    { heading: "Modules", lines: architecture.modules.map((item) => `${item.name}: ${item.responsibility}`) },
    { heading: "File fence", lines: architecture.fileFence },
    {
      heading: "Suggestion S-1",
      lines: [
        suggestion?.text ?? "",
        `Decision: ${suggestion?.decision ?? "missing"}`,
        suggestion?.appliedChange ? `Change if accepted: ${suggestion.appliedChange}` : "No change recorded.",
      ],
    },
    { heading: "PHI", lines: [architecture.phiNote] },
    {
      heading: "Requirement map",
      lines: architecture.requirementMap.map((item) => `${item.acceptanceCriterionId} → ${item.module} (${item.testKind})`),
    },
  ];
}

function attributeLines(panel: ReviewPanel<unknown>): string[] {
  return (panel.rationale.attributes ?? []).map((item) => `${item.attribute}: ${item.met ? "met" : "unmet"}. ${item.note}`);
}

function critiqueBlocks(panel: ReviewPanel<unknown>): Block[] {
  const blocks: Block[] = [];
  for (const [label, critique] of [
    ["Critique of A, written by B", panel.critiqueOfA],
    ["Critique of B, written by A", panel.critiqueOfB],
  ] as const) {
    blocks.push({
      heading: label,
      lines: [
        ...critique.attributes.map((item) => `${item.attribute}: ${item.met ? "met" : "unmet"}. ${item.note}`),
        ...critique.defects.map((item) => `${item.id} ${item.severity} ${item.code}: ${item.point}`),
        ...critique.strengths.map((item) => `Strength: ${item}`),
      ],
    });
  }
  blocks.push({
    heading: "Synthesis rationale",
    lines: [
      ...panel.rationale.takenFromA.map((item) => `From A: ${item}`),
      ...panel.rationale.takenFromB.map((item) => `From B: ${item}`),
      ...panel.rationale.rejected.map((item) => `Rejected: ${item}`),
      ...attributeLines(panel),
    ],
  });
  return blocks;
}

function sameDocument<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function panelTabs<T>(name: string, run: Run, render: (value: T) => Block[]): ViewTab[] {
  const panel = run.artifacts.get(`${name}.panel`)?.body as ReviewPanel<T> | undefined;
  const proposalA = run.artifacts.get(`${name}.proposalA`)?.body as T | undefined;
  const proposalB = run.artifacts.get(`${name}.proposalB`)?.body as T | undefined;
  const synthesis = run.artifacts.get(name)?.body as T | undefined;
  if (!panel || !proposalA || !proposalB || !synthesis) return [];
  const synthesisBlocks = [...render(synthesis), { heading: "Quality", lines: attributeLines(panel) }];
  if (sameDocument(proposalA, proposalB)) {
    synthesisBlocks.unshift({ heading: "Same document", lines: ["Both analysts returned the same document."] });
    return [
      { id: "synthesis", label: "Synthesis", blocks: synthesisBlocks },
      {
        id: "critiques",
        label: "Critiques",
        blocks: [
          { heading: "Same document", lines: ["The drafts match, so these notes do not record a disagreement."] },
          ...critiqueBlocks(panel),
        ],
      },
    ];
  }
  return [
    { id: "proposal-a", label: "Proposal A", blocks: render(proposalA) },
    { id: "proposal-b", label: "Proposal B", blocks: render(proposalB) },
    { id: "critiques", label: "Critiques", blocks: critiqueBlocks(panel) },
    { id: "synthesis", label: "Synthesis", blocks: synthesisBlocks },
  ];
}

export function questionBlocks(set: QuestionSet): Block[] {
  return set.questions.map((question) => ({
    heading: question.id,
    lines: [question.prompt, question.why, ...question.options.map((option) => `${option.id}: ${option.label}`)],
  }));
}

export function testBlocks(set: TestCaseSet, dropped: string[]): Block[] {
  return [
    {
      heading: "Cases",
      lines: set.cases.map((item) => `${item.id} ${item.priority} ${item.automation}: ${item.expected}`),
    },
    { heading: "Dropped", lines: dropped.length > 0 ? dropped : ["None"] },
    { heading: "Oracle", lines: ["AC-CO50-NOTE fails on the seeded bug and passes on the fix."] },
  ];
}

export function stageMethod(state: State): string {
  if (state === "unit_loop" || state === "implementing") return STAGE_METHODS.repair.method;
  if (state === "test_gate" || state === "test_design") return STAGE_METHODS.test_design.method;
  if (state === "architecture_gate" || state === "architecture_draft") return STAGE_METHODS.architecture.method;
  if (state === "prd_gate" || state === "prd_draft") return STAGE_METHODS.prd.method;
  if (state === "clarifying") return STAGE_METHODS.questions.method;
  if (state === "record_gate" || state === "recorded") return "deterministic gate";
  return "intake scan";
}

export function stageNote(state: State): string {
  if (state === "unit_loop") return STAGE_METHODS.repair.reason;
  if (state === "test_gate") return STAGE_METHODS.test_design.reason;
  if (state === "architecture_gate") return STAGE_METHODS.architecture.reason;
  if (state === "prd_gate") return STAGE_METHODS.prd.reason;
  if (state === "clarifying") return STAGE_METHODS.questions.reason;
  if (state === "record_gate") return "The record reads approvals, the unit oracle, the workbench priority cases, and the PHI scan. A model cannot open it.";
  return "The brief is scanned before any document is written.";
}
