import { Run } from "./run.ts";

export interface RecordInput {
  prdApproved: boolean;
  architectureApproved: boolean;
  testCasesApproved: boolean;
  unitGreen: boolean;
  p0Green: boolean;
  phiClean: boolean;
  secretsClean: boolean;
}

export function recordDecision(input: RecordInput): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.prdApproved) reasons.push("prd-approval");
  if (!input.architectureApproved) reasons.push("architecture-approval");
  if (!input.testCasesApproved) reasons.push("test-case-approval");
  if (!input.unitGreen) reasons.push("unit-red");
  if (!input.p0Green) reasons.push("p0-red");
  if (!input.phiClean) reasons.push("phi");
  if (!input.secretsClean) reasons.push("secrets");
  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true };
}

/** Refusal leaves the run on the record gate. A passing check is what moves it to recorded. */
export function applyRecord(run: Run, input: RecordInput): { ok: true } | { ok: false; reasons: string[] } {
  if (run.state !== "record_gate") throw new Error(`Record is only available from record_gate, not ${run.state}`);
  const decision = recordDecision(input);
  if (!decision.ok) return decision;
  run.transition("recorded", "orchestrator", "local result recorded");
  return { ok: true };
}
