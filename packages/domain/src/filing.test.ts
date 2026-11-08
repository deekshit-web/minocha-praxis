import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_TODAY, daysRemaining, deadlineRisk, filingDeadline } from "./filing.ts";

test("Northwind timely filing is 90 days from the date of service", () => {
  assert.equal(filingDeadline("2026-08-20"), "2026-11-18");
});

test("deadline risk uses the frozen demo clock", () => {
  assert.equal(DEMO_TODAY, "2026-11-17");
  assert.equal(daysRemaining("2026-11-18"), 1);
  assert.equal(deadlineRisk(1), "urgent");
  assert.equal(deadlineRisk(-1), "overdue");
  assert.equal(deadlineRisk(30), "soon");
  assert.equal(deadlineRisk(60), "comfortable");
});
