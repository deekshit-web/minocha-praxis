import {
  STAGE_METHODS,
  type Architecture,
  type CallRow,
  type PanelCritique,
  type Prd,
  type QuestionSet,
  type ReviewPanel,
  type Run,
  type State,
  type TestCaseSet,
} from "@northwind/orchestrator";
import type { LiveShowcase } from "@northwind/harness";

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
  /** Every model call so far, with time, cost, and quality. */
  calls: CallRow[];
  /** Epoch milliseconds. The page counts the elapsed time from these. */
  timing: { startedAt: number | null; finishedAt: number | null };
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
    synthesisBlocks.unshift({ heading: "Recorded stage", lines: ["This recording uses one draft for both analysts, so there is no disagreement to show at this step."] });
    return [
      { id: "synthesis", label: "Synthesis", blocks: synthesisBlocks },
      {
        id: "critiques",
        label: "Critiques",
        blocks: [
          { heading: "Recorded stage", lines: ["Both drafts in this recording are the same, so these notes do not record a disagreement."] },
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

const SEAT_NAME: Record<string, string> = {
  analystA: "Draft A",
  analystB: "Draft B",
  critiqueOfA: "Critique of draft A",
  critiqueOfB: "Critique of draft B",
  synthesizer: "Synthesis",
};

const MODEL_NAME: Record<string, string> = { "claude-opus-5": "Claude Opus 5", "grok-4.7": "Grok 4.7" };

function modelName(model: string | null): string {
  return model ? (MODEL_NAME[model] ?? model) : "an unknown model";
}

function duration(ms: number | null): string {
  if (ms === null) return "time not recorded";
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

function dollars(cost: number | null): string {
  return cost === null ? "price unknown" : `$${cost.toFixed(2)}`;
}

/**
 * A real two-model run on the same brief, shown beside the recorded requirements. It is for comparison:
 * the person still approves the recorded document the later steps are built on.
 */
export function liveTabs(show: LiveShowcase): ViewTab[] {
  const seat = (role: string) => show.seats.find((item) => item.role === role);
  const a = modelName(seat("analystA")?.model ?? null);
  const b = modelName(seat("analystB")?.model ?? null);
  const merger = modelName(seat("synthesizer")?.model ?? null);
  const findings = (critique: PanelCritique) => {
    const p0 = critique.defects.filter((item) => item.severity === "P0");
    const p1 = critique.defects.length - p0.length;
    return [...p0.map((item) => `P0: ${item.point}`), ...(p1 > 0 ? [`Plus ${p1} lesser (P1) defect${p1 === 1 ? "" : "s"}.`] : [])];
  };
  const resolved = show.panel.rationale.defects.filter((item) => item.disposition === "resolved").length;
  return [
    {
      id: "live-overview",
      label: `${a.split(" ")[0]} vs ${b.split(" ")[0]}`,
      blocks: [
        {
          heading: "A real run on the same brief",
          lines: [
            `${a} wrote draft A and ${b} wrote draft B, without seeing each other's. Each model critiqued the other's draft, and ${merger} merged them.`,
            `Every PRD gate passed. ${dollars(show.chainCostUsd)} and ${duration(show.chainDurationMs)} across ${show.paidAttempts} paid attempt${show.paidAttempts === 1 ? "" : "s"}${show.paidAttempts > 1 ? ", each resuming where the last one stopped" : ""}.`,
            "You approve the recorded requirements; the later steps are built on them. This run is shown for comparison.",
          ],
        },
        {
          heading: "Each call",
          lines: show.seats.map(
            (item) =>
              `${SEAT_NAME[item.role] ?? item.role} · ${modelName(item.model)} · ${duration(item.durationMs)} · ${dollars(item.costUsd)}` +
              (item.quality ? ` · ${item.quality.verdict === "pass" ? "Pass" : "Flagged"}: ${item.quality.summary}` : ""),
          ),
        },
        { heading: `What ${b} caught in ${a}'s draft`, lines: findings(show.panel.critiqueOfA) },
        { heading: `What ${a} caught in ${b}'s draft`, lines: findings(show.panel.critiqueOfB) },
        {
          heading: "How the synthesis settled it",
          lines: [
            `${resolved} of ${show.panel.rationale.defects.length} defects resolved.`,
            ...show.panel.rationale.takenFromA.slice(0, 2).map((item) => `From ${a}: ${item}`),
            ...show.panel.rationale.takenFromB.slice(0, 2).map((item) => `From ${b}: ${item}`),
          ],
        },
      ],
    },
    { id: "live-a", label: `${a.split(" ")[0]}'s draft`, blocks: prdBlocks(show.panel.proposalA) },
    { id: "live-b", label: `${b.split(" ")[0]}'s draft`, blocks: prdBlocks(show.panel.proposalB) },
    { id: "live-synthesis", label: "Live synthesis", blocks: prdBlocks(show.panel.synthesis) },
  ];
}
