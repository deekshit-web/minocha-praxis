import { join } from "node:path";
import { appealReady, appealReadyBuggy, co50MissingNoteSample } from "../../domain/src/index.ts";
import { FeatureBTree, failureExcerpt } from "../../implementer/src/tree.ts";
import { loadPack, retrieve } from "../../knowledge/src/retrieve.ts";
import { applyRecord, recordDecision } from "../../orchestrator/src/record.ts";
import {
  acceptSuggestion,
  rejectSuggestion,
  alignTestCases,
  architectureIssues,
  missingAssertions,
  prdGateIssues,
  prdIssues,
  questionSetIssues,
  type Architecture,
  type ImplementationPlan,
  type Prd,
  type QuestionSet,
  type TestCaseSet,
} from "../../orchestrator/src/documents.ts";
import { fenceViolations } from "../../orchestrator/src/fence.ts";
import { recordInput } from "../../harness/src/walk.ts";
import {
  FEATURE_B_BRIEF,
  KNOWN_CITATIONS,
  RULES,
  architecturePanel,
  implementationPanel,
  panelCalls,
  prdPanel,
  questionPanel,
  testCasePanel,
} from "../../harness/src/panels.ts";
import { executionGate, mutationOracleIssues, STAGE_METHODS } from "../../orchestrator/src/method.ts";
import { reviewPanelIssues, untestableFenceIssues, type PanelCall, type ReviewPanel } from "../../orchestrator/src/panel.ts";
import { FixturePlayer, playPanel, recordedLines } from "../../orchestrator/src/provider.ts";
import { intakeDecision, intakeNouns } from "../../orchestrator/src/phi.ts";
import { repoRoot } from "../../orchestrator/src/paths.ts";
import { Run } from "../../orchestrator/src/run.ts";
import { nextUnitAttempt } from "../../orchestrator/src/stall.ts";
import { traceMatrix } from "../../orchestrator/src/trace.ts";
import { MAIN_LINE, type State } from "../../orchestrator/src/states.ts";
import { readFileSync } from "node:fs";
import { runPriorityChecks, type PriorityResult } from "../../rcm/src/priority.ts";

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

const RAIL_LABELS: Record<string, string> = {
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

export type FactoryAct =
  | { type: "begin" }
  | { type: "answers"; choices?: Record<string, string> }
  | { type: "approve" }
  | { type: "changes"; comment?: string }
  | { type: "accept-suggestion" }
  | { type: "reject-suggestion" }
  | { type: "repair" }
  | { type: "record" }
  | { type: "probe"; brief: string };

function publish<T>(run: Run, name: string, panel: ReviewPanel<T>, calls: PanelCall[] = panelCalls(panel, FEATURE_B_BRIEF)): string[] {
  const issues = reviewPanelIssues(panel, calls);
  run.putArtifact(`${name}.calls`, calls.map((call) => ({ role: call.role, prompt: call.prompt })));
  run.putArtifact(`${name}.proposalA`, panel.proposalA);
  run.putArtifact(`${name}.proposalB`, panel.proposalB);
  run.putArtifact(`${name}.panel`, panel);
  run.putArtifact(name, panel.synthesis);
  return issues;
}

function prdBlocks(prd: Prd): Block[] {
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

function architectureBlocks(architecture: Architecture): Block[] {
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

function panelTabs<T>(name: string, run: Run, render: (value: T) => Block[]): ViewTab[] {
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

let sequence = 0;

export const DEFAULT_WORKBENCH = "http://127.0.0.1:4173";

export class FactorySession {
  readonly run: Run;
  readonly id: string;
  p0Green = false;
  unitGreen = false;
  priority: PriorityResult[] = [];
  log: string[] = [];
  banner: string | null = null;
  unitFailure = "";
  unitExcerpt = "";
  sandboxPath = "";
  repairDiff = "";
  droppedCases: string[] = [];
  private tree: FeatureBTree | null = null;
  private fingerprints: string[] = [];

  constructor(
    id?: string,
    readonly workbench: string = DEFAULT_WORKBENCH,
  ) {
    sequence += 1;
    this.id = id ?? `feature-b-${sequence}`;
    this.run = new Run(this.id);
  }

  async act(action: FactoryAct): Promise<FactoryView> {
    this.banner = null;
    if (action.type === "probe") return this.probe(action.brief);
    if (this.run.state === "blocked" || this.run.state === "recorded") return this.view();
    if (action.type === "begin") this.begin();
    else if (action.type === "answers") this.answer(action.choices ?? {});
    else if (action.type === "approve") await this.approve();
    else if (action.type === "changes") this.changes(action.comment ?? "");
    else if (action.type === "accept-suggestion") this.accept();
    else if (action.type === "reject-suggestion") this.reject();
    else if (action.type === "repair") this.repair();
    else if (action.type === "record") this.record();
    return this.view();
  }

  view(): FactoryView {
    const state = this.run.state;
    const currentIndex = MAIN_LINE.indexOf(state as (typeof MAIN_LINE)[number]);
    const knowledge = this.knowledge();
    return {
      id: this.id,
      state,
      mode: "recorded",
      workbench: this.workbench,
      title: "CO-50 appeal readiness",
      subtitle: "Northwind Imaging · recorded Feature B run",
      method: this.methodLabel(),
      methodNote: this.methodNote(),
      blockedReason: this.run.blockedReason,
      banner: this.banner,
      rail: MAIN_LINE.map((id, index) => ({
        id,
        label: RAIL_LABELS[id] ?? id,
        status: state === "recorded" ? "done" : index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming",
      })),
      tabs: this.tabs(),
      questions: state === "clarifying" ? this.questionForm() : null,
      knowledge: knowledge.items,
      log: [...this.log],
      approvals: ["prd", "architecture", "test_cases"].map((gate) => {
        const name = gate;
        const artifact = this.run.artifacts.get(name);
        return {
          gate,
          hash: artifact ? artifact.hash.slice(0, 12) : "—",
          matches: this.run.approvalMatches(gate as "prd" | "architecture" | "test_cases", name),
        };
      }),
      actions: this.actions(),
      p0Green: this.p0Green,
      knowledgeError: knowledge.error,
      proposed: this.proposedLinks(),
    };
  }

  private begin(): void {
    if (this.run.state !== "intake") {
      this.banner = "Intake already finished.";
      return;
    }
    const intake = intakeDecision(FEATURE_B_BRIEF);
    if (!intake.ok) {
      this.run.block(`phi:${intake.findings.map((finding) => finding.kind).join(",")}`);
      this.log.push("Intake blocked before a document was written.");
      return;
    }
    this.run.transition("clarifying", "orchestrator");
    const questions = playPanel<QuestionSet>(new FixturePlayer(recordedLines(questionPanel())), "questions", FEATURE_B_BRIEF);
    const issues = [
      ...publish(this.run, "questions", questions.panel, questions.calls),
      ...questionSetIssues(questions.panel.synthesis),
    ];
    if (issues.length > 0) {
      this.run.block(issues[0] ?? "questions");
      return;
    }
    this.log.push("Intake clean. No PHI in the brief. Question panel stored.");
    this.log.push("Fixture player sent 5 calls. The analysts did not see each other's drafts.");
  }

  private answer(choices: Record<string, string>): void {
    if (this.run.state !== "clarifying") {
      this.banner = "Questions are not the open gate.";
      return;
    }
    const questions = this.run.artifacts.get("questions")?.body as QuestionSet;
    const missing = questions.questions.filter((question) => !choices[question.id]);
    if (missing.length > 0) {
      this.banner = "Choose an answer for each question. Nothing is selected for you.";
      return;
    }
    const offSuggestion = questions.questions.filter((question) => choices[question.id] !== question.defaultOptionId);
    if (offSuggestion.length > 0) {
      this.banner = "This recorded requirements document was written for the suggested answers. Choose those. The override suggestion is Nobody in v1.";
      return;
    }
    const picked = questions.questions.map((question) => {
      const choice = choices[question.id] ?? "";
      const label = question.options.find((option) => option.id === choice)?.label ?? choice;
      return `${question.id} ${label}`;
    });
    this.run.putArtifact("answers", { choices: picked });
    this.run.transition("prd_draft", "orchestrator");
    const prd = playPanel<Prd>(new FixturePlayer(recordedLines(prdPanel())), "prd", FEATURE_B_BRIEF);
    const issues = [
      ...publish(this.run, "prd", prd.panel, prd.calls),
      ...prdGateIssues(prd.panel.synthesis, prdIssues(prd.panel.synthesis, KNOWN_CITATIONS, RULES)),
    ];
    if (issues.length > 0) {
      this.run.block(issues[0] ?? "prd");
      return;
    }
    this.run.transition("prd_gate", "orchestrator");
    const stored = this.run.artifacts.get("prd")?.body as Prd;
    this.run.putArtifact("prd", {
      ...stored,
      assumptions: stored.assumptions.map((item) => {
        const question = questions.questions.find((entry) => entry.id === item.answerId);
        const option = question?.options.find((entry) => entry.id === choices[item.answerId]);
        if (!option || item.text.includes(option.label)) return item;
        return { ...item, text: `${option.label}. ${item.text}` };
      }),
    });
    this.log.push(`Answers recorded. ${picked.join("; ")}.`);
    this.log.push("PRD synthesis is ready. Approval will hash this synthesis, not proposal A.");
    this.log.push("Fixture player sent 5 calls. The analysts did not see each other's drafts.");
  }

  private async approve(): Promise<void> {
    if (this.run.state === "prd_gate") {
      this.run.approve("prd", "prd", "approve");
      this.run.transition("architecture_draft", "orchestrator");
      this.openArchitecture();
      return;
    }
    if (this.run.state === "architecture_gate") {
      const architecture = this.run.artifacts.get("architecture")?.body as Architecture | undefined;
      if (architecture?.suggestions.some((item) => item.decision === "pending")) {
        this.banner = "Accept suggestion S-1 first. That is the change that lets the CO-50 rule be a unit test.";
        return;
      }
      this.run.approve("architecture", "architecture", "approve");
      this.openUnit();
      return;
    }
    if (this.run.state === "test_gate") {
      this.run.approve("test_cases", "test_cases", "approve");
      await this.openRecord();
      return;
    }
    this.banner = "Nothing is waiting for approval.";
  }

  private changes(comment: string): void {
    const state = this.run.state;
    if (state !== "prd_gate" && state !== "architecture_gate" && state !== "test_gate") {
      this.banner = "Changes can be requested from an approval gate.";
      return;
    }
    const note = comment.trim() || "Revise the open document.";
    if (state === "architecture_gate") {
      const current = this.run.artifacts.get("architecture")?.body as Architecture | undefined;
      const panel = this.run.artifacts.get("architecture.panel")?.body as ReviewPanel<Architecture> | undefined;
      if (current?.suggestions.some((item) => item.decision === "reject") && panel) {
        this.run.putArtifact("architecture", panel.synthesis);
      }
    }
    this.run.requestChanges(state, note);
    const back = state === "prd_gate" ? "prd_draft" : state === "architecture_gate" ? "architecture_draft" : "test_design";
    this.run.transition(back, "agent");
    this.run.transition(state, "orchestrator");
    this.log.push(`Changes requested: ${note}`);
  }

  private accept(): void {
    if (this.run.state !== "architecture_gate") {
      this.banner = "The architecture suggestion is not open.";
      return;
    }
    const current = this.run.artifacts.get("architecture")?.body as Architecture;
    const accepted = acceptSuggestion(current, "S-1");
    const criterionIds = (this.run.artifacts.get("prd")?.body as Prd).acceptanceCriteria.map((item) => item.id);
    const panel = this.run.artifacts.get("architecture.panel")?.body as ReviewPanel<Architecture>;
    const stored = this.run.artifacts.get("architecture.calls")?.body as PanelCall[] | undefined;
    const issues = [
      ...reviewPanelIssues(panel, stored ?? panelCalls(panel, FEATURE_B_BRIEF)),
      ...untestableFenceIssues(panel),
      ...architectureIssues(accepted, criterionIds, KNOWN_CITATIONS, RULES),
    ];
    if (issues.length > 0) {
      this.run.block(issues[0] ?? "architecture");
      return;
    }
    this.run.putArtifact("architecture", accepted);
    this.log.push("Suggestion S-1 accepted. The file fence now includes packages/domain.");
  }

  private reject(): void {
    if (this.run.state !== "architecture_gate") {
      this.banner = "The architecture suggestion is not open.";
      return;
    }
    const current = this.run.artifacts.get("architecture")?.body as Architecture;
    if (!current.suggestions.some((item) => item.decision === "pending")) {
      this.banner = "The suggestion is already decided.";
      return;
    }
    this.run.putArtifact("architecture", rejectSuggestion(current, "S-1"));
    this.log.push("Suggestion S-1 rejected. Approve stays closed until you send the architecture back.");
  }

  private repair(): void {
    if (this.run.state !== "unit_loop" || !this.tree) {
      this.banner = "There is no red unit run to repair.";
      return;
    }
    const wrote = this.tree.repairClinicalNote();
    if (!wrote.ok) {
      this.banner = `Patch refused: ${wrote.reason}.`;
      this.log.push(this.banner);
      return;
    }
    this.repairDiff = wrote.diff;
    this.run.putArtifact("code.diff", wrote.diff);
    const ran = this.tree.test();
    if (!ran.passed) {
      const attempt = nextUnitAttempt({ priorFingerprints: this.fingerprints, diff: wrote.diff, failureOutput: ran.output });
      this.fingerprints.push(attempt.fingerprint);
      this.unitFailure = "AC-CO50-NOTE is still red after the patch.";
      this.unitExcerpt = failureExcerpt(ran.output);
      this.log.push(this.unitFailure);
      this.log.push(this.unitExcerpt);
      if (attempt.action === "stalled" || attempt.action === "attempt-cap") {
        this.run.block(attempt.action);
        this.log.push(`Unit loop ${attempt.action}. A second implementation was not started.`);
      }
      return;
    }
    const advanced = nextUnitAttempt({ priorFingerprints: this.fingerprints, diff: wrote.diff, failureOutput: null });
    if (advanced.action !== "advance") {
      this.run.block(advanced.action);
      return;
    }
    const sample = co50MissingNoteSample();
    const oracle = appealReady(sample);
    const green = executionGate("repair", {
      sawDiff: wrote.diff.length > 0,
      attributes: [
        { attribute: "security", met: true, note: "The patch stays inside synthetic identifiers." },
        { attribute: "accuracy", met: true, note: "AC-CO50-NOTE passes once the note is required." },
      ],
      tests: [{ id: "AC-CO50-NOTE", passed: ran.passed && oracle.ready === false }],
    });
    if (green.length > 0) {
      this.run.block(green[0] ?? "repair");
      return;
    }
    this.fingerprints.push(advanced.fingerprint);
    this.unitGreen = true;
    this.run.putArtifact("code.review", { method: "review-and-execute", sawDiff: true });
    this.run.transition("test_design", "orchestrator", "AC-CO50-NOTE passed");
    const tests = testCasePanel();
    const scenarios = (this.run.artifacts.get("prd")?.body as Prd).scenarios.map((item) => item.id);
    const aligned = alignTestCases(tests.synthesis, scenarios);
    const buggy = appealReadyBuggy(sample);
    const oracleCheck = mutationOracleIssues([
      { caseId: "AC-CO50-NOTE", failsOnDefect: buggy.ready === true, passesOnFix: oracle.ready === false },
    ]);
    const issues = [...publish(this.run, "test_cases", tests), ...aligned.issues, ...oracleCheck];
    if (issues.length > 0) {
      this.run.block(issues[0] ?? "tests");
      return;
    }
    this.droppedCases = aligned.dropped;
    this.run.transition("test_gate", "orchestrator");
    this.log.push("Patch removed the CO-50 branch that dropped clinicalNoteRef.");
    this.log.push("Repair passed AC-CO50-NOTE. Test synthesis is ready. A case that cannot see the bug was not accepted.");
  }

  private record(): void {
    if (this.run.state !== "record_gate") {
      this.banner = "Recording is only available after the trace.";
      return;
    }
    const decision = applyRecord(this.run, recordInput(this.run, { unitGreen: this.unitGreen, p0Green: this.p0Green }));
    if (!decision.ok) {
      this.log.push(`Record refused: ${decision.reasons.join(", ")}.`);
      this.banner = `The record stayed closed: ${decision.reasons.join(", ")}.`;
      return;
    }
    this.log.push("Result recorded. The workbench build is not served in this slice.");
  }

  private probe(brief: string): FactoryView {
    const decision = intakeDecision(brief);
    if (!decision.ok) {
      this.banner = `Blocked at intake (${decision.findings.map((finding) => finding.kind).join(", ")}). No document was written.`;
    } else {
      this.banner = "Intake would accept this brief.";
    }
    this.log.push(this.banner);
    return this.view();
  }

  private openArchitecture(): void {
    const played = playPanel<Architecture>(new FixturePlayer(recordedLines(architecturePanel())), "architecture", FEATURE_B_BRIEF);
    const issues = publish(this.run, "architecture", played.panel, played.calls);
    if (issues.length > 0) {
      this.run.block(issues[0] ?? "architecture");
      return;
    }
    this.run.transition("architecture_gate", "orchestrator");
    this.log.push("Architecture panel stored. Proposal A fences the screen. Proposal B fences packages/domain. Suggestion S-1 is pending.");
    this.log.push("Fixture player sent 5 calls. The analysts did not see each other's drafts.");
  }

  private openUnit(): void {
    const played = playPanel<ImplementationPlan>(new FixturePlayer(recordedLines(implementationPanel())), "implementation", FEATURE_B_BRIEF);
    const implementation = played.panel;
    const fence = (this.run.artifacts.get("architecture")?.body as Architecture).fileFence;
    const issues = [
      ...publish(this.run, "implementation", implementation, played.calls),
      ...fenceViolations(implementation.synthesis.files, fence).map((hit) => `${hit.reason}:${hit.file}`),
    ];
    if (issues.length > 0) {
      this.run.block(issues[0] ?? "implementation");
      return;
    }
    this.run.transition("implementing", "orchestrator");
    this.run.transition("unit_loop", "orchestrator");
    let tree: FeatureBTree;
    try {
      tree = FeatureBTree.seed(join(repoRoot(), "runs/implementer", this.id), fence, implementation.synthesis.assertionIds, repoRoot());
    } catch (error) {
      this.run.block(error instanceof Error ? error.message : "seed-failed");
      return;
    }
    this.tree = tree;
    this.sandboxPath = `runs/implementer/${this.id}`;
    const red = tree.test();
    if (red.passed || !/AC-CO50-NOTE/.test(red.output)) {
      this.run.block(red.passed ? "seed-was-green" : "seed-missed-AC-CO50-NOTE");
      return;
    }
    const failure = "AC-CO50-NOTE expected ready false, seeded appealReady returned ready true.";
    const first = nextUnitAttempt({ priorFingerprints: [], diff: "seed: skip the clinical note", failureOutput: red.output });
    if (first.action !== "retry") {
      this.run.block(first.action);
      return;
    }
    const redReview = executionGate("repair", {
      sawDiff: true,
      attributes: [
        { attribute: "security", met: true, note: "The sandbox uses synthetic identifiers. It is not the workbench." },
        { attribute: "accuracy", met: false, note: "AC-CO50-NOTE is red. node:test shows ready true." },
      ],
      tests: [{ id: "AC-CO50-NOTE", passed: false }],
    });
    this.fingerprints = [first.fingerprint];
    this.unitFailure = failure;
    this.unitExcerpt = failureExcerpt(red.output);
    this.run.transition("unit_loop", "orchestrator", failure);
    this.run.putArtifact("code.review.red", { failure, action: first.action, excerpt: this.unitExcerpt, issues: redReview });
    this.log.push(failure);
    this.log.push(this.unitExcerpt);
    this.log.push(`node:test is red in ${this.sandboxPath}. Review cannot call this test accurate. Repair is one patch, not a second implementation.`);
  }

  private async openRecord(): Promise<void> {
    const cases = this.run.artifacts.get("test_cases")?.body as TestCaseSet;
    const aligned = alignTestCases(cases, (this.run.artifacts.get("prd")?.body as Prd).scenarios.map((item) => item.id));
    if (aligned.issues.length > 0) {
      this.run.block(aligned.issues[0] ?? "trace");
      return;
    }
    const source = readFileSync(join(repoRoot(), "packages/domain/src/appealReady.test.ts"), "utf8");
    const implementation = this.run.artifacts.get("implementation")?.body as ImplementationPlan;
    const missing = missingAssertions(source, implementation.assertionIds);
    if (missing.length > 0) {
      this.run.block(`missing-assertion:${missing[0]}`);
      return;
    }
    const ids = aligned.cases.filter((item) => item.priority === "P0").map((item) => item.id);
    this.priority = await runPriorityChecks(ids);
    this.p0Green = this.priority.length > 0 && this.priority.every((item) => item.passed);
    this.run.transition("automating", "orchestrator");
    this.run.transition("e2e", "orchestrator");
    this.run.transition("record_gate", "orchestrator");
    for (const item of this.priority) this.log.push(`${item.id} ${item.passed ? "passed" : "failed"}. ${item.detail}`);
    const failed = this.priority.find((item) => !item.passed);
    this.log.push(
      failed
        ? `The record stayed closed. ${failed.detail}`
        : "Priority checks passed on the workbench. The result can be recorded. The gate does not serve the workbench.",
    );
  }

  private matrixBlocks(): Block[] {
    const prd = this.run.artifacts.get("prd")?.body as Prd | undefined;
    const set = this.run.artifacts.get("test_cases")?.body as TestCaseSet | undefined;
    if (!prd || !set) return [{ heading: "Trace", lines: ["The requirements are not on this run yet."] }];
    return traceMatrix({
      prd,
      cases: set.cases,
      dropped: this.droppedCases,
      results: this.priority,
      workbench: this.workbench,
    }).map((row) => ({
      heading: [row.requirementId, row.criterionId, row.scenarioId, row.caseId ?? "no case"].join(" · "),
      lines: [
        `${row.status}. ${row.detail}`,
        row.actualUrl ? `link:${row.actualUrl} Open the workbench` : "No workbench page for this row.",
        row.proposedUrl ? `link:${row.proposedUrl} Proposed ${row.screenId}` : "No proposed screen for this row.",
      ],
    }));
  }

  private questionForm(): FactoryView["questions"] {
    const set = this.run.artifacts.get("questions")?.body as QuestionSet | undefined;
    if (!set) return null;
    return set.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      why: question.why,
      options: question.options.map((option) => ({ id: option.id, label: option.label })),
      defaultOptionId: question.defaultOptionId,
    }));
  }

  private tabs(): ViewTab[] {
    const state = this.run.state;
    if (state === "clarifying") return panelTabs("questions", this.run, (set) => questionBlocks(set as QuestionSet));
    if (state === "prd_gate" || state === "prd_draft") return panelTabs("prd", this.run, (prd) => prdBlocks(prd as Prd));
    if (state === "architecture_gate" || state === "architecture_draft") {
      return panelTabs("architecture", this.run, (architecture) => architectureBlocks(architecture as Architecture));
    }
    if (state === "unit_loop" || state === "implementing") {
      return [
        {
          id: "unit",
          label: "Unit log",
          blocks: [
            {
              heading: "Attempt 1",
              lines: [
                "The workbench already calls the fixed function. This sandbox is a seeded copy inside the file fence.",
                this.unitFailure || "Waiting for the test run.",
                this.sandboxPath ? `Sandbox ${this.sandboxPath}` : "Sandbox not seeded.",
              ],
            },
            { heading: "node:test", lines: this.unitExcerpt ? this.unitExcerpt.split("\n") : ["No runner output yet."] },
            { heading: "Method", lines: ["One patch deletes the seeded branch. A second generated implementation is not started. The runner is node:test."] },
          ],
        },
        ...panelTabs("implementation", this.run, (plan) => {
          const body = plan as ImplementationPlan;
          return [
            { heading: "Plan", lines: [body.summary] },
            { heading: "Files", lines: body.files },
            { heading: "Assertions", lines: body.assertionIds },
          ];
        }),
      ];
    }
    if (state === "test_gate" || state === "test_design") {
      const tabs = panelTabs("test_cases", this.run, (set) => testBlocks(set as TestCaseSet, this.droppedCases));
      const synthesis = tabs.find((tab) => tab.id === "synthesis");
      if (synthesis && this.repairDiff) synthesis.blocks.unshift({ heading: "Patch", lines: this.repairDiff.split("\n") });
      return tabs;
    }
    if (state === "record_gate" || state === "recorded") {
      const decision = recordDecision(recordInput(this.run, { unitGreen: this.unitGreen, p0Green: this.p0Green }));
      return [
        { id: "matrix", label: "Trace", blocks: this.matrixBlocks() },
        {
          id: "record",
          label: "Record",
          blocks: [
            {
              heading: state === "recorded" ? "Gate passed" : "Checklist",
              lines:
                decision.ok
                  ? ["Approvals match the synthesis hashes.", "Unit oracle is green.", "Priority cases passed on the workbench.", "PHI and secret scans are clean."]
                  : decision.reasons.map((reason) => `Refused: ${reason}`),
            },
            {
              heading: "Priority checks",
              lines: this.priority.length > 0 ? this.priority.map((item) => `${item.id} ${item.passed ? "passed" : "failed"}. ${item.detail}`) : ["Not run."],
            },
            { heading: "What this does not do yet", lines: ["The denial workbench is not served from this gate. The gate itself is the orchestrator."] },
          ],
        },
      ];
    }
    if (state === "intake") {
      return [
        {
          id: "brief",
          label: "Brief",
          blocks: [
            { heading: "Feature", lines: [FEATURE_B_BRIEF] },
            {
              heading: "Running product",
              lines: [
                "The workbench already calls the fixed function. This run replays the change in a fenced copy, and the trace comes after the gates. Eligibility is a static snapshot and is not a new factory run.",
                `link:${this.link("/")} Workqueue`,
                `link:${this.link("/denial/DEN-01")} Denial detail`,
                `link:${this.link("/summary")} Lead summary`,
                `link:${this.link("/eligibility")} Eligibility`,
              ],
            },
            { heading: "Record", lines: ["The drafts below will be the recorded panel, not a live model call."] },
          ],
        },
      ];
    }
    return [];
  }

  private link(path: string): string {
    return `${this.workbench.replace(/\/$/, "")}${path}`;
  }

  private proposedLinks(): FactoryView["proposed"] {
    if (this.run.state !== "prd_gate" && this.run.state !== "prd_draft") return null;
    const prd = this.run.artifacts.get("prd")?.body as Prd | undefined;
    if (!prd) return null;
    return prd.screens.map((screen) => ({ id: screen.id, title: screen.title, href: `/proposed/${screen.id}` }));
  }

  private knowledge(): { items: FactoryView["knowledge"]; error: string | null } {
    const root = join(repoRoot(), "packages/knowledge/pack");
    try {
      const chunks = loadPack(root);
      if (chunks.length === 0) return { items: [], error: `Knowledge pack at ${root} is empty.` };
      return {
        items: retrieve(chunks, intakeNouns(FEATURE_B_BRIEF), 4).map((chunk) => ({ path: chunk.path, score: chunk.score })),
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Knowledge pack failed to load.";
      return { items: [], error: message };
    }
  }

  private actions(): FactoryAction[] {
    const state = this.run.state;
    const list: FactoryAction[] = [];
    if (state === "intake") list.push({ id: "begin", label: "Begin intake", enabled: true, reason: "" });
    if (state === "clarifying") list.push({ id: "answers", label: "Use these answers", enabled: true, reason: "" });
    if (state === "prd_gate" || state === "test_gate") {
      list.push({ id: "approve", label: "Approve synthesis", enabled: true, reason: "" });
      list.push({ id: "changes", label: "Request changes", enabled: true, reason: "" });
    }
    if (state === "architecture_gate") {
      const decision = (this.run.artifacts.get("architecture")?.body as Architecture | undefined)?.suggestions[0]?.decision;
      list.push({
        id: "accept-suggestion",
        label: "Accept suggestion S-1",
        enabled: decision === "pending",
        reason: decision === "pending" ? "" : "Already decided.",
      });
      list.push({
        id: "reject-suggestion",
        label: "Reject suggestion S-1",
        enabled: decision === "pending",
        reason: decision === "pending" ? "" : "Already decided.",
      });
      list.push({
        id: "approve",
        label: "Approve architecture",
        enabled: decision === "accept",
        reason:
          decision === "pending"
            ? "Accept the suggestion first."
            : decision === "reject"
              ? "The suggestion was rejected. Send it back."
              : "",
      });
      list.push({ id: "changes", label: "Request changes", enabled: true, reason: "" });
    }
    if (state === "unit_loop") list.push({ id: "repair", label: "Apply the repair", enabled: true, reason: "" });
    if (state === "record_gate") {
      list.push({
        id: "record",
        label: "Record the result",
        enabled: this.p0Green,
        reason: this.p0Green ? "" : this.priority.find((item) => !item.passed)?.detail || "A priority case failed on the workbench.",
      });
    }
    return list;
  }

  private methodLabel(): string {
    const state = this.run.state;
    if (state === "unit_loop" || state === "implementing") return STAGE_METHODS.repair.method;
    if (state === "test_gate" || state === "test_design") return STAGE_METHODS.test_design.method;
    if (state === "architecture_gate" || state === "architecture_draft") return STAGE_METHODS.architecture.method;
    if (state === "prd_gate" || state === "prd_draft") return STAGE_METHODS.prd.method;
    if (state === "clarifying") return STAGE_METHODS.questions.method;
    if (state === "record_gate" || state === "recorded") return "deterministic gate";
    return "intake scan";
  }

  private methodNote(): string {
    const state = this.run.state;
    if (state === "unit_loop") return STAGE_METHODS.repair.reason;
    if (state === "test_gate") return STAGE_METHODS.test_design.reason;
    if (state === "architecture_gate") return STAGE_METHODS.architecture.reason;
    if (state === "prd_gate") return STAGE_METHODS.prd.reason;
    if (state === "clarifying") return STAGE_METHODS.questions.reason;
    if (state === "record_gate") return "The record reads approvals, the unit oracle, the workbench priority cases, and the PHI scan. A model cannot open it.";
    return "The brief is scanned before any document is written.";
  }
}

function questionBlocks(set: QuestionSet): Block[] {
  return set.questions.map((question) => ({
    heading: question.id,
    lines: [question.prompt, question.why, ...question.options.map((option) => `${option.id}: ${option.label}`)],
  }));
}

function testBlocks(set: TestCaseSet, dropped: string[]): Block[] {
  return [
    {
      heading: "Cases",
      lines: set.cases.map((item) => `${item.id} ${item.priority} ${item.automation}: ${item.expected}`),
    },
    { heading: "Dropped", lines: dropped.length > 0 ? dropped : ["None"] },
    { heading: "Oracle", lines: ["AC-CO50-NOTE fails on the seeded bug and passes on the fix."] },
  ];
}

