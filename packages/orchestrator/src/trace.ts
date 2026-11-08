import type { Prd, TestCase } from "./documents.ts";

export interface TraceCheck {
  id: string;
  passed: boolean;
  detail: string;
}

export interface TraceRow {
  requirementId: string;
  criterionId: string;
  scenarioId: string;
  caseId: string | null;
  screenId: string | null;
  status: "passed" | "failed" | "not-gated";
  detail: string;
  actualUrl: string;
  proposedUrl: string;
}

function actualUrl(screenId: string | null, denial: string, workbench: string): string {
  const root = workbench.replace(/\/$/, "");
  if (screenId === "SCR-3") return `${root}/summary`;
  if (screenId === "SCR-1") return `${root}/?class=denial`;
  if (denial) return `${root}/denial/${denial}`;
  if (screenId === "SCR-2") return `${root}/denial/DEN-01`;
  return `${root}/`;
}

/** One row per scenario the approved requirements named. A dropped case does not get a row. */
export function traceMatrix(input: {
  prd: Prd;
  cases: TestCase[];
  dropped: string[];
  results: TraceCheck[];
  workbench: string;
}): TraceRow[] {
  const dropped = new Set(input.dropped);
  const live = input.cases.filter((item) => !dropped.has(item.id));
  const rows: TraceRow[] = [];
  for (const scenario of input.prd.scenarios) {
    const criteria = input.prd.acceptanceCriteria.filter((item) => scenario.criterionIds.includes(item.id));
    const screen = input.prd.screens.find((item) => item.scenarioIds.includes(scenario.id)) ?? null;
    const cited = live.filter((item) => item.scenarioIds.includes(scenario.id));
    const subjects = cited.length > 0 ? cited : [null];
    for (const testCase of subjects) {
      const result = testCase ? input.results.find((item) => item.id === testCase.id) : undefined;
      let status: TraceRow["status"];
      let detail: string;
      if (!testCase) {
        status = "failed";
        detail = "No case cites this scenario.";
      } else if (testCase.priority !== "P0") {
        status = "not-gated";
        detail = "This case does not gate the record.";
      } else if (!result) {
        status = "failed";
        detail = "This priority case did not run.";
      } else {
        status = result.passed ? "passed" : "failed";
        detail = result.detail;
      }
      const denial = detail.match(/DEN-\d{2}/)?.[0] ?? "";
      rows.push({
        requirementId: [...new Set(criteria.map((item) => item.requirementId))].join(", "),
        criterionId: scenario.criterionIds.join(", "),
        scenarioId: scenario.id,
        caseId: testCase?.id ?? null,
        screenId: screen?.id ?? null,
        status,
        detail,
        actualUrl: actualUrl(screen?.id ?? null, denial, input.workbench),
        proposedUrl: screen ? `/proposed/${screen.id}` : "",
      });
    }
  }
  return rows;
}
