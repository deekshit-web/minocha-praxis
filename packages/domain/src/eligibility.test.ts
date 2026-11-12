import assert from "node:assert/strict";
import test from "node:test";
import { coverageSnapshot, schedulingDecision } from "./eligibility.ts";
import { buildSeed } from "./seed.ts";

test("When coverage is not active, the front desk does not schedule the visit.", () => {
  const decision = schedulingDecision({
    patientId: "PAT-004",
    status: "inactive",
    copayCents: null,
    planName: "Northwind Health",
  });
  assert.equal(decision.allowSchedule, false);
  assert.match(decision.banner ?? "", /Do not schedule/);
});

test("When coverage is active, the page shows no banner.", () => {
  const decision = schedulingDecision({
    patientId: "PAT-001",
    status: "active",
    copayCents: 4_000,
    planName: "Northwind Health",
  });
  assert.equal(decision.allowSchedule, true);
  assert.equal(decision.banner, null);
});

test("The coverage snapshot uses the seed patient IDs. The last patient has no active coverage.", () => {
  const patients = buildSeed().patients;
  const coverage = coverageSnapshot(patients);
  assert.equal(coverage.length, patients.length);
  for (const row of coverage) {
    assert.equal(patients.some((patient) => patient.id === row.patientId), true);
  }
  const last = coverage.at(-1);
  assert.ok(last);
  assert.equal(last.patientId, patients.at(-1)?.id);
  assert.equal(last.status, "inactive");
  assert.equal(last.copayCents, null);
  assert.match(schedulingDecision(last).banner ?? "", /Do not schedule/);
  const first = coverage[0];
  assert.ok(first);
  assert.equal(first.status, "active");
  assert.equal(first.copayCents, 2500);
  assert.equal(schedulingDecision(first).banner, null);
});
