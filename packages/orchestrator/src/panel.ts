import { hashValue } from "./hash.ts";
import { missingAttributes, STAGE_METHODS, type AttributeFinding, type QualityAttribute } from "./method.ts";

export const PANEL_STAGES = ["questions", "prd", "architecture", "implementation", "repair", "test_design"] as const;

export type PanelStage = (typeof PANEL_STAGES)[number];

export const DEFECT_CODES = [
  "UNMAPPED_CARC",
  "MISSING_COVERAGE",
  "FENCE_ESCAPE",
  "PHI",
  "NO_CITATION",
  "UNTESTABLE",
  "OTHER",
] as const;

export type DefectCode = (typeof DEFECT_CODES)[number];

export interface PanelDefect {
  id: string;
  severity: "P0" | "P1";
  code: DefectCode;
  point: string;
  /** Set when the defect is the evidence that a quality attribute is not met. */
  attribute?: QualityAttribute;
}

export interface PanelCritique {
  of: "A" | "B";
  author: "A" | "B";
  strengths: string[];
  defects: PanelDefect[];
  adopt: string[];
  reject: string[];
  attributes: AttributeFinding[];
}

export interface SynthesisRationale {
  takenFromA: string[];
  takenFromB: string[];
  rejected: string[];
  defects: Array<{ defectId: string; disposition: "resolved" | "unresolved" }>;
  /** How the candidate meets every attribute this stage requires. Each one must be met. */
  attributes: AttributeFinding[];
}

export interface ReviewPanel<T> {
  stage: PanelStage;
  proposalA: T;
  proposalB: T;
  critiqueOfA: PanelCritique;
  critiqueOfB: PanelCritique;
  synthesis: T;
  rationale: SynthesisRationale;
}

export type PanelRole = "analystA" | "analystB" | "critiqueOfA" | "critiqueOfB" | "synthesizer";

/** Prompt text as sent. Seat markers are how isolation is checked without trusting the model. */
export interface PanelCall {
  role: PanelRole;
  prompt: string;
}

export const SEAT = {
  proposalA: "<<PROPOSAL_A>>",
  proposalB: "<<PROPOSAL_B>>",
  critiqueOfA: "<<CRITIQUE_OF_A>>",
  critiqueOfB: "<<CRITIQUE_OF_B>>",
} as const;

function unmetWithoutDefect(label: string, critique: PanelCritique | undefined): string[] {
  if (!critique) return [];
  const issues: string[] = [];
  for (const finding of critique.attributes ?? []) {
    if (finding.met !== false) continue;
    const tracked = critique.defects.some((defect) => defect.attribute === finding.attribute);
    if (!tracked) issues.push(`attribute-untracked:${label}:${finding.attribute}`);
  }
  return issues;
}

function hasMarker(prompt: string, marker: string): boolean {
  return prompt.includes(marker);
}

/**
 * Analysts must not see either finished proposal. Each critique must see the plan it judges.
 * The synthesizer must see both proposals and both critiques.
 */
export function isolationIssues(calls: PanelCall[]): string[] {
  const issues: string[] = [];
  const byRole = new Map(calls.map((call) => [call.role, call]));
  const required: PanelRole[] = ["analystA", "analystB", "critiqueOfA", "critiqueOfB", "synthesizer"];
  for (const role of required) {
    if (!byRole.has(role)) issues.push(`missing-call:${role}`);
  }
  const analystA = byRole.get("analystA");
  const analystB = byRole.get("analystB");
  const critiqueOfA = byRole.get("critiqueOfA");
  const critiqueOfB = byRole.get("critiqueOfB");
  const synthesizer = byRole.get("synthesizer");
  if (analystA && hasMarker(analystA.prompt, SEAT.proposalB)) issues.push("analyst-a-saw-proposal-b");
  if (analystA && hasMarker(analystA.prompt, SEAT.proposalA)) issues.push("analyst-a-saw-proposal-a");
  if (analystB && hasMarker(analystB.prompt, SEAT.proposalA)) issues.push("analyst-b-saw-proposal-a");
  if (analystB && hasMarker(analystB.prompt, SEAT.proposalB)) issues.push("analyst-b-saw-proposal-b");
  if (critiqueOfA && !hasMarker(critiqueOfA.prompt, SEAT.proposalA)) issues.push("critique-of-a-missed-proposal");
  if (critiqueOfB && !hasMarker(critiqueOfB.prompt, SEAT.proposalB)) issues.push("critique-of-b-missed-proposal");
  if (synthesizer) {
    for (const marker of [SEAT.proposalA, SEAT.proposalB, SEAT.critiqueOfA, SEAT.critiqueOfB]) {
      if (!hasMarker(synthesizer.prompt, marker)) issues.push(`synthesizer-missed:${marker}`);
    }
  }
  return issues;
}

export function reviewPanelIssues<T>(panel: ReviewPanel<T>, calls: PanelCall[]): string[] {
  const issues: string[] = [...isolationIssues(calls)];
  if (panel.proposalA === undefined || panel.proposalA === null) issues.push("missing-proposal-a");
  if (panel.proposalB === undefined || panel.proposalB === null) issues.push("missing-proposal-b");
  if (panel.synthesis === undefined || panel.synthesis === null) issues.push("missing-synthesis");
  if (panel.critiqueOfA?.author !== "B" || panel.critiqueOfA.of !== "A") issues.push("critique-of-a-seat");
  if (panel.critiqueOfB?.author !== "A" || panel.critiqueOfB.of !== "B") issues.push("critique-of-b-seat");
  if (panel.rationale.takenFromA.length + panel.rationale.takenFromB.length === 0) issues.push("empty-rationale");

  const required = STAGE_METHODS[panel.stage].attributes;
  issues.push(...missingAttributes(panel.critiqueOfA?.attributes, required, "critique-of-a"));
  issues.push(...missingAttributes(panel.critiqueOfB?.attributes, required, "critique-of-b"));
  issues.push(...missingAttributes(panel.rationale?.attributes, required, "synthesis"));
  for (const finding of panel.rationale?.attributes ?? []) {
    if (required.includes(finding.attribute) && finding.met === false) {
      issues.push(`synthesis-attribute-unmet:${finding.attribute}`);
    }
  }
  issues.push(...unmetWithoutDefect("critique-of-a", panel.critiqueOfA));
  issues.push(...unmetWithoutDefect("critique-of-b", panel.critiqueOfB));

  const defects = [...(panel.critiqueOfA?.defects ?? []), ...(panel.critiqueOfB?.defects ?? [])];
  const dispositions = new Map(panel.rationale.defects.map((item) => [item.defectId, item.disposition]));
  for (const defect of defects) {
    const disposition = dispositions.get(defect.id);
    if (!disposition) issues.push(`rationale-missing-defect:${defect.id}`);
    if (defect.severity === "P0" && disposition === "unresolved") issues.push(`unresolved-p0:${defect.id}`);
  }
  return issues;
}

/** A resolved UNTESTABLE defect is a lie when the synthesis keeps analyst A's file fence. */
export function untestableFenceIssues<T extends { fileFence: string[] }>(panel: ReviewPanel<T>): string[] {
  const issues: string[] = [];
  const defects = [...panel.critiqueOfA.defects, ...panel.critiqueOfB.defects];
  for (const item of panel.rationale.defects) {
    if (item.disposition !== "resolved") continue;
    const defect = defects.find((candidate) => candidate.id === item.defectId);
    if (defect?.code !== "UNTESTABLE") continue;
    if (hashValue(panel.proposalA.fileFence) === hashValue(panel.synthesis.fileFence)) {
      issues.push(`untestable-fence-unchanged:${defect.id}`);
    }
  }
  return issues;
}

export function buildSeatPrompt(role: PanelRole, body: string, seats: Partial<Record<keyof typeof SEAT, unknown>> = {}): string {
  const blocks = [body];
  for (const key of Object.keys(seats) as Array<keyof typeof SEAT>) {
    const value = seats[key];
    if (value !== undefined) blocks.push(`${SEAT[key]}\n${JSON.stringify(value)}`);
  }
  return `${role}\n${blocks.join("\n")}`;
}
