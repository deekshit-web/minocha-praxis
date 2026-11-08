import assert from "node:assert/strict";
import test from "node:test";
import { findPhi } from "@northwind/orchestrator";
import { buildSeed, daysRemaining } from "@northwind/domain";
import { PROPOSED_SCREENS, renderProposedScreen } from "./proposed.ts";

test("three proposed screens are watermarked and free of PHI", () => {
  for (const id of PROPOSED_SCREENS) {
    const html = renderProposedScreen(id);
    assert.match(html, /Proposed/);
    assert.equal(findPhi(html).length, 0);
    assert.match(html, new RegExp(id === "SCR-1" ? "Workqueue" : id === "SCR-2" ? "Denial detail" : "Lead summary"));
  }
});

test("the workqueue leads with the soonest deadline", () => {
  const seed = buildSeed();
  const html = renderProposedScreen("SCR-1", seed);
  const soonest = [...seed.denials].sort((a, b) => {
    const left = a.filingDeadline ? daysRemaining(a.filingDeadline) : -9999;
    const right = b.filingDeadline ? daysRemaining(b.filingDeadline) : -9999;
    return left - right || a.id.localeCompare(b.id);
  })[0];
  assert.ok(soonest);
  const first = html.slice(html.indexOf("<tbody>")).match(/DEN-\d{2}/);
  assert.equal(first?.[0], soonest.id);
  for (const denial of seed.denials) assert.match(html, new RegExp(denial.id));
});

test("the detail screen names the missing clinical note and keeps ready off", () => {
  const html = renderProposedScreen("SCR-2");
  assert.match(html, /Clinical note reference: Missing/);
  assert.match(html, /Filing deadline: Present/);
  assert.match(html, /<button type="button" disabled>Mark appeal ready<\/button>/);
  assert.match(html, /Do not change the diagnosis code/);
});
