import assert from "node:assert/strict";
import test from "node:test";
import { alignTestCases } from "./documents.ts";
import { traceMatrix } from "./trace.ts";
import { prdPanel, testCasePanel } from "@northwind/harness";

const prd = prdPanel().synthesis;
const aligned = alignTestCases(testCasePanel().synthesis, prd.scenarios.map((item) => item.id));

function results(failed: string[] = []) {
  return ["TC-1", "TC-2", "TC-3", "TC-4", "TC-5"].map((id, index) => ({
    id,
    passed: !failed.includes(id),
    detail: `${id} DEN-0${index + 1} ${failed.includes(id) ? "failed" : "passed"}.`,
  }));
}

test("the trace ties every scenario to a requirement, a case, and a workbench page", () => {
  const rows = traceMatrix({ prd, cases: testCasePanel().synthesis.cases, dropped: aligned.dropped, results: results(), workbench: "http://127.0.0.1:4173" });
  assert.deepEqual(
    rows.map((row) => row.scenarioId),
    ["SCN-1", "SCN-2", "SCN-3", "SCN-4", "SCN-5", "SCN-6"],
  );
  assert.equal(rows.some((row) => row.caseId === "TC-99"), false);
  const first = rows[0];
  assert.equal(first?.requirementId, "REQ-1");
  assert.equal(first?.criterionId, "AC-1");
  assert.equal(first?.caseId, "TC-1");
  assert.equal(first?.status, "passed");
  assert.equal(first?.screenId, "SCR-2");
  assert.equal(first?.actualUrl, "http://127.0.0.1:4173/denial/DEN-01");
  assert.equal(first?.proposedUrl, "/proposed/SCR-2");
  assert.equal(rows.find((row) => row.scenarioId === "SCN-4")?.actualUrl, "http://127.0.0.1:4173/?class=denial");
  assert.equal(rows.find((row) => row.scenarioId === "SCN-6")?.status, "not-gated");
  assert.equal(rows.find((row) => row.scenarioId === "SCN-6")?.actualUrl, "http://127.0.0.1:4173/summary");
});

test("a failed priority case fails only its own row", () => {
  const rows = traceMatrix({ prd, cases: aligned.cases, dropped: [], results: results(["TC-2"]), workbench: "http://127.0.0.1:4173" });
  assert.equal(rows.find((row) => row.caseId === "TC-2")?.status, "failed");
  assert.equal(rows.find((row) => row.caseId === "TC-1")?.status, "passed");
  assert.equal(rows.find((row) => row.caseId === "TC-5")?.status, "passed");
});
