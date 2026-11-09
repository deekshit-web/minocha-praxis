import { CARC_RULES } from "@northwind/domain";
import { loadPack, relevant } from "@northwind/knowledge";
import {
  CritiqueSchema,
  PrdSchema,
  findPhi,
  intakeNouns,
  playPanel,
  prdGateIssues,
  prdIssues,
  repoRoot,
  reviewPanelIssues,
  synthesisSchema,
  type ModelProvider,
  type PanelCall,
  type PanelRole,
  type Prd,
  type ReviewPanel,
  type SeatSpec,
} from "@northwind/orchestrator";
import { join } from "node:path";
import { FEATURE_B_BRIEF, RULES, groundedCitations, questionPanel } from "./panels.ts";

/**
 * Everything every PRD seat is told: the brief, the question-round answers, the CARC table,
 * the pack files retrieval finds for the brief, and the document conventions. The gates are not
 * restated as rules to satisfy; they judge the result.
 */
export function prdContext(brief: string): string {
  const answers = questionPanel().synthesis.questions.map((question) => {
    const option = question.options.find((item) => item.id === question.defaultOptionId);
    return `- ${question.id} ${question.prompt} Answer: ${option?.label}. ${option?.consequence ?? ""}`;
  });
  const carc = CARC_RULES.map((rule) => `| ${rule.code} | ${rule.carcClass} | ${rule.meaning} | ${rule.nextAction} |`);
  const pack = relevant(loadPack(join(repoRoot(), "packages/knowledge/pack")), intakeNouns(brief)).map(
    (chunk) => `### pack/${chunk.path}\n\n${chunk.text}`,
  );
  return [
    "You are one seat on a review panel that writes a product requirements document (PRD) for Northwind Imaging's denial workbench, a demo revenue-cycle product. Every patient, claim, and document in it is synthetic.",
    `## Feature brief\n\n${brief}`,
    `## Answers from the question round\n\nThe requester chose these answers. Record each one as an assumption.\n\n${answers.join("\n")}`,
    `## CARC table\n\nThe only codes and next actions this product knows. Copy a next action exactly when you reference a code.\n\n| Code | Class | Meaning | Next action |\n| --- | --- | --- | --- |\n${carc.join("\n")}`,
    `## Knowledge pack\n\nThe files retrieval found for this brief. Cite them by the path in their heading; no other file can be cited.\n\n${pack.join("\n\n")}`,
    [
      "## PRD conventions",
      "",
      "- Ids: requirements REQ-1, REQ-2, ...; acceptance criteria AC-1, AC-2, ...; scenarios SCN-1, SCN-2, ...; screens SCR-1, SCR-2, SCR-3.",
      "- Every requirement has at least one acceptance criterion. Each criterion is a given / when / then an observer can check, with priority P0 (blocks release) or P1.",
      "- Every P0 criterion is exercised by at least one scenario. A scenario names the role acting, the starting state, the steps, and the expected result.",
      "- Propose three screens, each tied to the scenarios it serves.",
      "- Use only synthetic identifiers shaped PAT-###, CLM-###, and DOC-###. Never write a real name, SSN, MRN, phone number, email address, or date of birth.",
      "- List anything still undecided under openQuestions.",
    ].join("\n"),
  ].join("\n\n");
}

const CRITIQUE_RULES = [
  "For each quality attribute (security, accuracy, maintainability), write one finding: met or not, and a note saying why.",
  "Any attribute you mark unmet must be backed by a defect that names that attribute.",
  "Give each defect a severity: P0 when it would make the PRD wrong, untestable, or unsafe; P1 otherwise.",
].join(" ");

/** Seat instructions and answer shapes for the PRD panel. The user message is the seat prompt playPanel builds. */
export function livePrdSeats(): Record<PanelRole, SeatSpec> {
  return {
    analystA: {
      instructions:
        "You are analyst A. Write a complete PRD for the brief, working alone. Lean toward the denial specialist's day-to-day workflow.",
      schema: PrdSchema,
    },
    analystB: {
      instructions:
        "You are analyst B. Write a complete PRD for the brief, working alone. Lean toward payer rules, compliance, and what could go wrong.",
      schema: PrdSchema,
    },
    critiqueOfA: {
      instructions: `You are analyst B, reviewing analyst A's PRD, which follows <<PROPOSAL_A>> in the message. Set of to "A" and author to "B". Number your defects D-A1, D-A2, .... ${CRITIQUE_RULES}`,
      schema: CritiqueSchema,
    },
    critiqueOfB: {
      instructions: `You are analyst A, reviewing analyst B's PRD, which follows <<PROPOSAL_B>> in the message. Set of to "B" and author to "A". Number your defects D-B1, D-B2, .... ${CRITIQUE_RULES}`,
      schema: CritiqueSchema,
    },
    synthesizer: {
      instructions: [
        "You are the synthesizer. The message holds both PRDs and both critiques. Merge them into one PRD that a person will approve.",
        "In the rationale, say what you kept from A and from B, and what you rejected and why.",
        "List every defect id raised in either critique as resolved or unresolved. Resolve every P0.",
        "Write one finding per quality attribute saying how the merged PRD meets it.",
        "The merged PRD goes to approval, so it leaves no open questions.",
      ].join(" "),
      schema: synthesisSchema(PrdSchema),
    },
  };
}

export interface LivePrdResult {
  panel: ReviewPanel<Prd>;
  calls: PanelCall[];
  /** Every gate finding. Empty means the PRD could go to a person for approval. */
  issues: string[];
}

/**
 * Plays the PRD panel on any provider and runs the gates the factory runs at the PRD stage,
 * plus a PHI scan of everything the seats returned, since a live model can write anything.
 */
export async function runLivePrd(provider: ModelProvider, brief = FEATURE_B_BRIEF): Promise<LivePrdResult> {
  const { panel, calls } = await playPanel<Prd>(provider, "prd", brief);
  const issues = [
    ...reviewPanelIssues(panel, calls),
    ...prdGateIssues(panel.synthesis, prdIssues(panel.synthesis, groundedCitations(brief), RULES)),
    ...findPhi(JSON.stringify(panel)).map((finding) => `phi:${finding.kind}:${finding.match}`),
  ];
  return { panel, calls, issues };
}
