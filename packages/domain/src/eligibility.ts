export interface Coverage {
  patientId: string;
  status: "active" | "inactive";
  copayCents: number | null;
  planName: string;
}

export interface ScheduleDecision {
  allowSchedule: boolean;
  banner: string | null;
}

export function schedulingDecision(coverage: Coverage): ScheduleDecision {
  if (coverage.status === "inactive") {
    return { allowSchedule: false, banner: "Coverage is inactive. Do not schedule." };
  }
  return { allowSchedule: true, banner: null };
}

/**
 * Coverage for the patients the workbench already has. The last patient is inactive
 * so the denial queue on the earlier rows stays the same. No second patient key.
 */
export function coverageSnapshot(patients: { id: string }[]): Coverage[] {
  return patients.map((patient, index) => {
    const inactive = index === patients.length - 1 && patients.length > 0;
    return {
      patientId: patient.id,
      status: inactive ? "inactive" : "active",
      copayCents: inactive ? null : 2500,
      planName: "Northwind Health",
    };
  });
}
