import { STAGE_METHODS } from "./method.ts";
import { reviewPanelIssues, type PanelCall, type PanelCritique, type PanelRole, type ReviewPanel } from "./panel.ts";
import type { CallMetric } from "./provider.ts";

/** How one seat's output fared against the checks that already gate the stage. No model grades itself here. */
export interface SeatQuality {
  verdict: "pass" | "issues";
  summary: string;
  findings: string[];
}

/** The stage's own document check, run on each draft and on the synthesis. */
export interface DocumentChecks<T> {
  proposal: (document: T) => string[];
  synthesis: (document: T) => string[];
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Which seat a panel finding is about. Everything not tied to an analyst or a critique belongs to the synthesis. */
function seatOf(issue: string): PanelRole {
  if (issue.startsWith("missing-call:")) return issue.slice("missing-call:".length) as PanelRole;
  if (issue.startsWith("analyst-a-") || issue === "missing-proposal-a") return "analystA";
  if (issue.startsWith("analyst-b-") || issue === "missing-proposal-b") return "analystB";
  if (issue.includes("critique-of-a")) return "critiqueOfA";
  if (issue.includes("critique-of-b")) return "critiqueOfB";
  return "synthesizer";
}

export function seatQuality<T>(panel: ReviewPanel<T>, calls: PanelCall[], checks: DocumentChecks<T>): Record<PanelRole, SeatQuality> {
  const required = STAGE_METHODS[panel.stage].attributes;
  const bySeat = new Map<PanelRole, string[]>();
  for (const issue of reviewPanelIssues(panel, calls)) {
    const seat = seatOf(issue);
    bySeat.set(seat, [...(bySeat.get(seat) ?? []), issue]);
  }
  const panelIssues = (seat: PanelRole) => bySeat.get(seat) ?? [];

  const proposal = (seat: PanelRole, document: T, critique: PanelCritique): SeatQuality => {
    const gate = [...panelIssues(seat), ...checks.proposal(document)];
    const met = critique.attributes.filter((item) => required.includes(item.attribute) && item.met).length;
    const p0 = critique.defects.filter((item) => item.severity === "P0").length;
    const p1 = critique.defects.length - p0;
    const parts = [
      ...(gate.length > 0 ? [count(gate.length, "gate issue")] : []),
      ...(p0 + p1 > 0 ? [`${[...(p0 ? [`${p0} P0`] : []), ...(p1 ? [`${p1} P1`] : [])].join(" · ")} from critique`] : []),
      `${met}/${required.length} attributes met`,
    ];
    return {
      verdict: gate.length === 0 && p0 === 0 ? "pass" : "issues",
      summary: parts.join(" · "),
      findings: [...gate, ...critique.defects.map((item) => `${item.id} ${item.severity} ${item.code}: ${item.point}`)],
    };
  };

  const critique = (seat: PanelRole, review: PanelCritique): SeatQuality => {
    const issues = panelIssues(seat);
    const covered = required.filter((attribute) =>
      review.attributes.some((item) => item.attribute === attribute && item.note.trim().length > 0),
    ).length;
    return {
      verdict: issues.length === 0 ? "pass" : "issues",
      summary: `${covered}/${required.length} attributes covered · ${count(review.defects.length, "defect")} raised`,
      findings: issues,
    };
  };

  const gate = [...panelIssues("synthesizer"), ...checks.synthesis(panel.synthesis)];
  const met = panel.rationale.attributes.filter((item) => required.includes(item.attribute) && item.met).length;
  const resolved = panel.rationale.defects.filter((item) => item.disposition === "resolved").length;
  const unresolved = panel.rationale.defects.length - resolved;
  return {
    analystA: proposal("analystA", panel.proposalA, panel.critiqueOfA),
    analystB: proposal("analystB", panel.proposalB, panel.critiqueOfB),
    critiqueOfA: critique("critiqueOfA", panel.critiqueOfA),
    critiqueOfB: critique("critiqueOfB", panel.critiqueOfB),
    synthesizer: {
      verdict: gate.length === 0 ? "pass" : "issues",
      summary: [
        gate.length === 0 ? "All gates pass" : count(gate.length, "gate issue"),
        `${met}/${required.length} attributes met`,
        ...(resolved + unresolved > 0 ? [`${resolved}/${resolved + unresolved} defects resolved`] : []),
      ].join(" · "),
      findings: gate,
    },
  };
}

/** One model call as the factory shows it: what it cost, how long it took, and how its output fared. */
export interface CallRow {
  stage: string;
  role: PanelRole;
  source: CallMetric["source"];
  model: string | null;
  /** Null when the run was saved before call timing was recorded. */
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  costUsd: number | null;
  quality: SeatQuality | null;
}

export function callRows(
  stage: string,
  metrics: ReadonlyArray<CallMetric | (Omit<CallMetric, "durationMs"> & { durationMs: number | null })>,
  quality: Partial<Record<PanelRole, SeatQuality>> | null,
): CallRow[] {
  return metrics.map((metric) => ({
    stage,
    role: metric.role,
    source: metric.source,
    model: metric.model,
    durationMs: metric.durationMs,
    inputTokens: metric.usage?.inputTokens ?? null,
    outputTokens: metric.usage?.outputTokens ?? null,
    cacheReadTokens: metric.usage?.cacheReadTokens ?? null,
    costUsd: metric.costUsd,
    quality: quality?.[metric.role] ?? null,
  }));
}
