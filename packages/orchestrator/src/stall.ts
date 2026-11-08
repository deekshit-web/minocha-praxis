import { hashValue } from "./hash.ts";

export type AttemptAction = "advance" | "retry" | "stalled" | "attempt-cap";

export function attemptFingerprint(diff: string, failureOutput: string): string {
  return hashValue({ diff, failureOutput });
}

/**
 * A passing attempt advances. A repeated failure fingerprint stalls.
 * Three failing attempts stop even when each fingerprint is new.
 */
export function nextUnitAttempt(input: {
  priorFingerprints: string[];
  diff: string;
  failureOutput: string | null;
}): { fingerprint: string; action: AttemptAction } {
  if (input.failureOutput === null) {
    return { fingerprint: attemptFingerprint(input.diff, ""), action: "advance" };
  }
  const fingerprint = attemptFingerprint(input.diff, input.failureOutput);
  if (input.priorFingerprints.includes(fingerprint)) return { fingerprint, action: "stalled" };
  if (input.priorFingerprints.length + 1 >= 3) return { fingerprint, action: "attempt-cap" };
  return { fingerprint, action: "retry" };
}
