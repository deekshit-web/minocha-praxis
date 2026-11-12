import assert from "node:assert/strict";
import test from "node:test";
import { buildSeed } from "./seed.ts";
import { filingDeadline } from "./filing.ts";

test("The practice seed data is synthetic. Its size is correct for the workbench. It includes the demo CARC codes.", () => {
  const seed = buildSeed();
  assert.equal(seed.patients.length, 12);
  assert.ok(seed.lines.length >= 40);
  assert.equal(seed.denials.length, 12);
  assert.deepEqual(
    [...new Set(seed.denials.map((denial) => denial.carc))].sort(),
    ["CO-16", "CO-197", "CO-4", "CO-50", "OA-23", "PR-1"],
  );
  const missingNote = seed.denials.find((denial) => denial.carc === "CO-50" && denial.clinicalNoteRef === null && denial.filingDeadline);
  assert.ok(missingNote);
  assert.equal(missingNote.filingDeadline, filingDeadline(missingNote.dateOfService));
  for (const patient of seed.patients) assert.match(patient.id, /^PAT-\d{3}$/);
  for (const denial of seed.denials) {
    assert.match(denial.claimId, /^CLM-\d{3}$/);
    if (denial.clinicalNoteRef) assert.match(denial.clinicalNoteRef, /^DOC-\d{3}$/);
  }
});
