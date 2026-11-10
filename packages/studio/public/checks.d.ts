export interface LiveClaim {
  id: string;
  label: string;
  type: "number" | "date" | "text";
  value: string;
  draft: string;
  draftFrom: "A" | "B";
}
export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}
export const LIVE_CHECKS: Record<string, { facts: Array<[string, string]>; claims: LiveClaim[]; run(claims: Record<string, string>): CheckResult[] }>;
export function runChecks(id: string, claims?: Record<string, string>): CheckResult[];
