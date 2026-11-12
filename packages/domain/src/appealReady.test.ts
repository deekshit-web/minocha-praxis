import assert from "node:assert/strict";
import test from "node:test";
import { appealReady, appealReadyBuggy, co50MissingNoteSample } from "./appealReady.ts";

test("AC-CO50-NOTE: the packet is not ready when the clinical note reference is missing.", () => {
  const result = appealReady(co50MissingNoteSample());
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ["clinicalNoteRef"]);
});

test("The seeded bug makes AC-CO50-NOTE return ready when the clinical note is missing.", () => {
  assert.equal(appealReadyBuggy(co50MissingNoteSample()).ready, true);
});

test("AC-CO50-DEADLINE: the packet is not ready when the filing deadline is missing.", () => {
  const result = appealReady({ carc: "CO-50", clinicalNoteRef: "DOC-014", filingDeadline: null });
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ["filingDeadline"]);
});

test("With the seeded bug, AC-CO50-DEADLINE still blocks the packet when the note is present.", () => {
  const input = { carc: "CO-50", clinicalNoteRef: "DOC-014", filingDeadline: "  " };
  assert.equal(appealReadyBuggy(input).ready, false);
  assert.deepEqual(appealReadyBuggy(input).missing, ["filingDeadline"]);
});

test("AC-CO50-READY: the packet is ready when the note and the deadline are present.", () => {
  const result = appealReady({ carc: "CO-50", clinicalNoteRef: "DOC-003", filingDeadline: "2026-11-30" });
  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
});

test("AC-CO16-UNCHANGED: a CO-16 denial does not need a clinical note.", () => {
  const result = appealReady({ carc: "CO-16", clinicalNoteRef: null, filingDeadline: null });
  assert.equal(result.ready, true);
  assert.equal(result.reason, "not-in-gate");
});

test("AC-PR1-NOT-DENIAL: the system rejects an appeal for a deductible that the patient owes.", () => {
  const result = appealReady({ carc: "PR-1", clinicalNoteRef: "DOC-001", filingDeadline: "2026-12-01" });
  assert.equal(result.ready, false);
  assert.equal(result.reason, "not-a-denial");
});

test("An unknown CARC code stays unmapped.", () => {
  const result = appealReady({ carc: "CO-999", clinicalNoteRef: "DOC-001", filingDeadline: "2026-12-01" });
  assert.equal(result.reason, "unmapped");
  assert.equal(result.ready, false);
});
