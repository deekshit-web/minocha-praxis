import { carcRule } from "./carc.ts";

export interface ReadinessInput {
  carc: string;
  clinicalNoteRef: string | null;
  filingDeadline: string | null;
}

export type MissingField = "clinicalNoteRef" | "filingDeadline";

export interface Readiness {
  ready: boolean;
  missing: MissingField[];
  reason: "not-a-denial" | "not-in-gate" | "incomplete" | "ready" | "unmapped";
}

/** CO-50 is the only code this feature gates. Other denials keep their previous path. */
const NOTE_GATE = new Set(["CO-50"]);

function blank(value: string | null): boolean {
  return value === null || value.trim() === "";
}

/**
 * Oracle the repair loop has to reach.
 * CO-50 is appeal-ready only with a clinical-note reference and a filing deadline.
 * Patient-responsibility and informational codes are not appealable.
 * Unmapped codes stay unmapped.
 */
export function appealReady(input: ReadinessInput): Readiness {
  const rule = carcRule(input.carc);
  if (!rule) return { ready: false, missing: [], reason: "unmapped" };
  if (rule.carcClass !== "denial") return { ready: false, missing: [], reason: "not-a-denial" };
  if (!NOTE_GATE.has(input.carc)) return { ready: true, missing: [], reason: "not-in-gate" };

  const missing: MissingField[] = [];
  if (blank(input.clinicalNoteRef)) missing.push("clinicalNoteRef");
  if (blank(input.filingDeadline)) missing.push("filingDeadline");
  if (missing.length > 0) return { ready: false, missing, reason: "incomplete" };
  return { ready: true, missing: [], reason: "ready" };
}

/**
 * Seeded defect for the booth's first unit run.
 * A CO-50 row with no clinical-note reference is reported ready.
 */
export function appealReadyBuggy(input: ReadinessInput): Readiness {
  const correct = appealReady(input);
  if (input.carc === "CO-50" && correct.missing.includes("clinicalNoteRef")) {
    const missing = correct.missing.filter((field) => field !== "clinicalNoteRef");
    if (missing.length === 0) return { ready: true, missing: [], reason: "ready" };
    return { ready: false, missing, reason: "incomplete" };
  }
  return correct;
}

export const CO50_NOTE_ASSERTION = "AC-CO50-NOTE";

export function co50MissingNoteSample(): ReadinessInput {
  return { carc: "CO-50", clinicalNoteRef: null, filingDeadline: "2026-12-01" };
}
