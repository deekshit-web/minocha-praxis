export const TIMELY_FILING_DAYS = 90;

/** Frozen clock for the summit demo so deadline risk does not drift. */
export const DEMO_TODAY = "2026-11-17";

export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`Bad date ${isoDate}`);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function filingDeadline(dateOfService: string, days = TIMELY_FILING_DAYS): string {
  return addDays(dateOfService, days);
}

export function daysRemaining(deadline: string, today = DEMO_TODAY): number {
  const ms = Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export type DeadlineRisk = "overdue" | "urgent" | "soon" | "comfortable";

export function deadlineRisk(days: number): DeadlineRisk {
  if (days < 0) return "overdue";
  if (days <= 14) return "urgent";
  if (days <= 45) return "soon";
  return "comfortable";
}
