import assert from "node:assert/strict";
import test from "node:test";
import { findPhi, intakeDecision } from "./phi.ts";
import { findSecrets } from "./secrets.ts";
import { fencePatternIssues, fenceViolations, matchGlob } from "./fence.ts";
import { nextUnitAttempt } from "./stall.ts";
import { Run, TransitionError } from "./run.ts";
import { hashValue } from "./hash.ts";

test("PHI scanner ignores synthetic ids and catches an SSN, an email, a phone, an MRN, and a labelled birth date", () => {
  assert.deepEqual(findPhi("See PAT-001 on CLM-014 with DOC-003."), []);
  assert.equal(findPhi("SSN 123-45-6789")[0]?.kind, "ssn");
  assert.equal(findPhi("write ada@example.com")[0]?.kind, "email");
  assert.equal(findPhi("call 415-555-0134")[0]?.kind, "phone");
  assert.equal(findPhi("MRN: 445566")[0]?.kind, "mrn");
  assert.equal(findPhi("DOB 1961-04-09")[0]?.kind, "dob");
  assert.equal(findPhi("date of birth: 04/09/1961")[0]?.kind, "dob");
  assert.deepEqual(findPhi("Filing deadline 2026-12-01, date of service 2026-09-02"), []);
  assert.equal(intakeDecision("PAT-001 eligibility").ok, true);
});

test("secret shapes are rejected and the domain fence does not admit the factory", () => {
  assert.equal(findSecrets("token = sk-live-abcdef1234").length > 0, true);
  assert.equal(matchGlob("packages/domain/src/appealReady.ts", "packages/domain/**"), true);
  assert.ok(fencePatternIssues(["**"]).length > 0);
  assert.deepEqual(fencePatternIssues(["packages/domain/**", "packages/rcm/**"]), []);
});

test("a broad fence cannot admit the factory, the gates, or the tooling", () => {
  assert.deepEqual(fencePatternIssues(["packages/**"]), ["fence-admits:packages/**"]);
  assert.deepEqual(fencePatternIssues(["packages/orchestrator/src/*.ts"]), ["fence-admits:packages/orchestrator/src/*.ts"]);
  for (const file of [
    "packages/factory/src/server.ts",
    "packages/orchestrator/src/record.ts",
    "packages/implementer/src/tree.ts",
    "packages/harness/src/walk.ts",
    "scripts/harness.mjs",
    "node_modules/esbuild/lib/main.js",
  ]) {
    assert.deepEqual(fenceViolations([file], ["**/*"]), [{ file, reason: "forbidden" }], file);
  }
});

test("three distinct failures hit the attempt cap and a new fingerprint may retry", () => {
  const first = nextUnitAttempt({ priorFingerprints: [], diff: "a", failureOutput: "one" });
  const second = nextUnitAttempt({ priorFingerprints: [first.fingerprint], diff: "b", failureOutput: "two" });
  const third = nextUnitAttempt({
    priorFingerprints: [first.fingerprint, second.fingerprint],
    diff: "c",
    failureOutput: "three",
  });
  assert.equal(first.action, "retry");
  assert.equal(second.action, "retry");
  assert.equal(third.action, "attempt-cap");
});

test("changes return only to the draft that was rejected, and a new hash voids approval", () => {
  const run = new Run("changes");
  run.transition("clarifying", "orchestrator");
  run.transition("prd_draft", "orchestrator");
  run.transition("prd_gate", "orchestrator");
  run.putArtifact("prd", { problem: "first" });
  run.requestChanges("prd_gate", "Add the PR-1 exclusion");
  assert.equal(run.state, "changes_requested");
  assert.throws(() => run.transition("architecture_draft", "agent"), TransitionError);
  run.transition("prd_draft", "agent");
  assert.equal(run.state, "prd_draft");
  run.putArtifact("prd", { problem: "second" });
  run.transition("prd_gate", "orchestrator");
  run.approve("prd", "prd", "approve");
  const approved = hashValue({ problem: "second" });
  assert.equal(run.artifacts.get("prd")?.hash, approved);
  run.putArtifact("prd", { problem: "third" });
  assert.equal(run.approvalMatches("prd", "prd"), false);
});
