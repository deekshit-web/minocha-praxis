import assert from "node:assert/strict";
import test from "node:test";
import { appealReady, appealReadyBuggy, co50MissingNoteSample } from "./appealReady.ts";

test("AC-CO50-NOTE blocks ready when the clinical note reference is missing", () => {
  const result = appealReady(co50MissingNoteSample());
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ["clinicalNoteRef"]);
});

test("seeded bug AC-CO50-NOTE returns ready without a clinical note", () => {
  assert.equal(appealReadyBuggy(co50MissingNoteSample()).ready, true);
});

test("AC-CO50-DEADLINE blocks ready when the filing deadline is missing", () => {
  const result = appealReady({ carc: "CO-50", clinicalNoteRef: "DOC-014", filingDeadline: null });
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ["filingDeadline"]);
});

test("seeded bug still blocks AC-CO50-DEADLINE when the note is present", () => {
  const input = { carc: "CO-50", clinicalNoteRef: "DOC-014", filingDeadline: "  " };
  assert.equal(appealReadyBuggy(input).ready, false);
  assert.deepEqual(appealReadyBuggy(input).missing, ["filingDeadline"]);
});

test("AC-CO50-READY allows the packet when the note and the deadline are present", () => {
  const result = appealReady({ carc: "CO-50", clinicalNoteRef: "DOC-003", filingDeadline: "2026-11-30" });
  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
});

test("AC-CO16-UNCHANGED does not ask CO-16 for a clinical note", () => {
  const result = appealReady({ carc: "CO-16", clinicalNoteRef: null, filingDeadline: null });
  assert.equal(result.ready, true);
  assert.equal(result.reason, "not-in-gate");
});

test("AC-PR1-NOT-DENIAL refuses an appeal on deductible patient responsibility", () => {
  const result = appealReady({ carc: "PR-1", clinicalNoteRef: "DOC-001", filingDeadline: "2026-12-01" });
  assert.equal(result.ready, false);
  assert.equal(result.reason, "not-a-denial");
});

test("an unknown CARC stays unmapped", () => {
  const result = appealReady({ carc: "CO-999", clinicalNoteRef: "DOC-001", filingDeadline: "2026-12-01" });
  assert.equal(result.reason, "unmapped");
  assert.equal(result.ready, false);
});
