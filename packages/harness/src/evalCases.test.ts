import assert from "node:assert/strict";
import test from "node:test";
import { intakeDecision } from "@northwind/orchestrator";
import { basePrd, codeGateIssues, evalBriefs, plantDraft, plantedCases } from "./evalCases.ts";

test("both base PRDs pass every code gate", () => {
  assert.deepEqual(codeGateIssues(basePrd("live-synthesis")), []);
  assert.deepEqual(codeGateIssues(basePrd("recorded")), []);
});

test("every planted defect slips past every code gate, so only a reviewer can catch it", () => {
  const cases = plantedCases();
  assert.equal(cases.filter((item) => item.kind === "seeded").length, 18);
  assert.equal(cases.filter((item) => item.kind === "clean").length, 4);
  for (const planted of cases) {
    const draft = plantDraft(planted);
    assert.deepEqual(codeGateIssues(draft), [], `${planted.id} is caught by a code gate`);
    const changed = JSON.stringify(draft) !== JSON.stringify(basePrd(planted.base));
    if (planted.kind === "clean") assert.equal(planted.base, "recorded", `${planted.id}: clean controls use the hand-checked base`);
    assert.equal(changed, planted.edits.length > 0, `${planted.id} edits did not change the draft`);
  }
});

test("an edit that no longer matches its base fails loudly", () => {
  const [first] = plantedCases();
  assert.ok(first);
  const broken = { ...first, edits: [{ section: "requirements" as const, id: "REQ-1", field: "statement", find: "text that is not there", replace: "x" }] };
  assert.throws(() => plantDraft(broken), /matches 0 times/);
});

test("every new brief clears intake and carries answers and checks", () => {
  const briefs = evalBriefs();
  assert.equal(briefs.length, 8);
  for (const brief of briefs) {
    assert.equal(intakeDecision(brief.brief).ok, true, `${brief.id} is refused at intake`);
    assert.ok(brief.answers.length >= 3, `${brief.id} has too few answers`);
    assert.ok(brief.checks.length >= 4, `${brief.id} has too few checks`);
  }
});
