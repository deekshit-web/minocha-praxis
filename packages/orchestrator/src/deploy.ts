import { Run } from "./run.ts";

export interface DeployInput {
  prdApproved: boolean;
  architectureApproved: boolean;
  testCasesApproved: boolean;
  unitGreen: boolean;
  p0Green: boolean;
  phiClean: boolean;
  secretsClean: boolean;
}

export function deployDecision(input: DeployInput): { ok: true } | { ok: false; reasons: string[] } {
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

/** Refusal leaves the run on the deploy gate. A passing check is what moves it to deployed. */
export function applyDeploy(run: Run, input: DeployInput): { ok: true } | { ok: false; reasons: string[] } {
  if (run.state !== "deploy_gate") throw new Error(`Deploy is only available from deploy_gate, not ${run.state}`);
  const decision = deployDecision(input);
  if (!decision.ok) return decision;
  run.transition("deployed", "orchestrator", "local production build");
  return { ok: true };
}
