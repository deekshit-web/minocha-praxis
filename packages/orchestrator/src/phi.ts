export interface PhiFinding {
  kind: "ssn" | "email" | "phone" | "mrn" | "dob";
  match: string;
}

const ALLOWED_ID = /\b(?:PAT|CLM|DOC)-\d{3}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\b(?:\+?1[-.\s])?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;
const MRN = /\bMRN[:\s#-]*[A-Za-z0-9]{4,}\b/gi;
/** A date only counts when it is labelled as a birth date. Service dates and deadlines are not PHI on their own here. */
const DOB = /\b(?:DOB|D\.O\.B\.?|date of birth|birth ?date)[:\s]*\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/gi;

function collect(text: string, pattern: RegExp, kind: PhiFinding["kind"], into: PhiFinding[]): void {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    into.push({ kind, match: match[0] });
  }
}

/** Scans free text. Allowlisted synthetic ids are removed before the patterns run. */
export function findPhi(text: string): PhiFinding[] {
  const masked = text.replace(ALLOWED_ID, " ");
  const findings: PhiFinding[] = [];
  collect(masked, SSN, "ssn", findings);
  collect(masked, EMAIL, "email", findings);
  collect(masked, PHONE, "phone", findings);
  collect(masked, MRN, "mrn", findings);
  collect(masked, DOB, "dob", findings);
  return findings;
}

export function intakeNouns(brief: string): string[] {
  const tokens = brief
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((token) => token.length > 2);
  return [...new Set(tokens)];
}

export function intakeDecision(brief: string): { ok: true; nouns: string[] } | { ok: false; findings: PhiFinding[] } {
  const findings = findPhi(brief);
  if (findings.length > 0) return { ok: false, findings };
  return { ok: true, nouns: intakeNouns(brief) };
}
