import { CARC_RULES, type CarcCode } from "./carc.ts";
import { filingDeadline } from "./filing.ts";

export interface Patient {
  id: string;
  displayName: string;
  dob: string;
}

export interface Procedure {
  code: string;
  label: string;
}

export interface ClaimLine {
  id: string;
  claimId: string;
  patientId: string;
  procedure: Procedure;
  dateOfService: string;
  chargeCents: number;
}

export interface Denial {
  id: string;
  patientId: string;
  claimId: string;
  lineId: string;
  carc: CarcCode;
  rarc: string;
  dateOfService: string;
  filingDeadline: string | null;
  clinicalNoteRef: string | null;
  chargeCents: number;
}

export interface PracticeSeed {
  practice: "Northwind Imaging";
  payer: "Northwind Health";
  patients: Patient[];
  lines: ClaimLine[];
  denials: Denial[];
}

const NAMES = [
  "Avery North",
  "Blake Glen",
  "Cedar Holm",
  "Drew Isle",
  "Ellis Quarry",
  "Finley Ridge",
  "Gray Shore",
  "Harper Vale",
  "Indigo Marsh",
  "Jules Peck",
  "Kai Brook",
  "Lane Croft",
];

const PROCEDURES: Procedure[] = [
  { code: "70553", label: "MRI brain with and without contrast" },
  { code: "74177", label: "CT abdomen and pelvis with contrast" },
  { code: "72148", label: "MRI lumbar spine without contrast" },
  { code: "71046", label: "Chest X-ray, 2 views" },
];

interface DenialSpec {
  carc: CarcCode;
  dateOfService: string;
  clinicalNoteRef: string | null;
  /** When false, the deadline is absent so the CO-50 gate can show that hole. */
  withDeadline: boolean;
}

const DENIALS: DenialSpec[] = [
  { carc: "CO-50", dateOfService: "2026-08-20", clinicalNoteRef: null, withDeadline: true },
  { carc: "CO-50", dateOfService: "2026-08-01", clinicalNoteRef: "DOC-002", withDeadline: true },
  { carc: "CO-50", dateOfService: "2026-09-01", clinicalNoteRef: "DOC-003", withDeadline: true },
  { carc: "CO-50", dateOfService: "2026-10-15", clinicalNoteRef: null, withDeadline: false },
  { carc: "CO-16", dateOfService: "2026-09-15", clinicalNoteRef: null, withDeadline: true },
  { carc: "CO-16", dateOfService: "2026-07-01", clinicalNoteRef: null, withDeadline: true },
  { carc: "CO-197", dateOfService: "2026-09-20", clinicalNoteRef: null, withDeadline: true },
  { carc: "CO-197", dateOfService: "2026-10-20", clinicalNoteRef: null, withDeadline: true },
  { carc: "PR-1", dateOfService: "2026-10-01", clinicalNoteRef: null, withDeadline: true },
  { carc: "PR-1", dateOfService: "2026-08-15", clinicalNoteRef: null, withDeadline: true },
  { carc: "CO-4", dateOfService: "2026-09-10", clinicalNoteRef: null, withDeadline: true },
  { carc: "OA-23", dateOfService: "2026-09-12", clinicalNoteRef: null, withDeadline: true },
];

function id(prefix: "PAT" | "CLM" | "DOC", n: number): string {
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

export function buildSeed(): PracticeSeed {
  const patients: Patient[] = NAMES.map((displayName, index) => ({
    id: id("PAT", index + 1),
    displayName,
    dob: `${1960 + index}-04-15`,
  }));

  const lines: ClaimLine[] = [];
  for (const patient of patients) {
    const claimId = id("CLM", Number(patient.id.slice(4)));
    for (let line = 0; line < 3; line += 1) {
      const procedure = PROCEDURES[(Number(patient.id.slice(4)) + line) % PROCEDURES.length]!;
      lines.push({
        id: `${claimId}-L${line + 1}`,
        claimId,
        patientId: patient.id,
        procedure,
        dateOfService: DENIALS[Number(patient.id.slice(4)) - 1]?.dateOfService ?? "2026-09-01",
        chargeCents: 48_000 + line * 12_500,
      });
    }
  }
  // Four extra paid lines so the workqueue is not the whole claim file.
  for (let extra = 0; extra < 4; extra += 1) {
    const patient = patients[extra]!;
    lines.push({
      id: `${id("CLM", extra + 1)}-L4`,
      claimId: id("CLM", extra + 1),
      patientId: patient.id,
      procedure: PROCEDURES[extra % PROCEDURES.length]!,
      dateOfService: "2026-06-15",
      chargeCents: 22_000,
    });
  }

  const denials: Denial[] = DENIALS.map((spec, index) => {
    const patient = patients[index]!;
    const claimId = id("CLM", index + 1);
    const rule = CARC_RULES.find((item) => item.code === spec.carc)!;
    return {
      id: `DEN-${String(index + 1).padStart(2, "0")}`,
      patientId: patient.id,
      claimId,
      lineId: `${claimId}-L1`,
      carc: spec.carc,
      rarc: rule.demoRarc,
      dateOfService: spec.dateOfService,
      filingDeadline: spec.withDeadline ? filingDeadline(spec.dateOfService) : null,
      clinicalNoteRef: spec.clinicalNoteRef,
      chargeCents: 48_000,
    };
  });

  return { practice: "Northwind Imaging", payer: "Northwind Health", patients, lines, denials };
}
