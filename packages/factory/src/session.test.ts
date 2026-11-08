import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { Block } from "./session.ts";
import { FactorySession } from "./session.ts";

const SUGGESTED = { "Q-1": "co50", "Q-2": "nobody", "Q-3": "doc-id", "Q-4": "dos-90", "Q-5": "named" };

function fenceLines(blocks: Block[]): string {
  return blocks.find((block) => block.heading === "File fence")?.lines.join(" ") ?? "";
}

test("Feature B pauses at each human gate and deploys only after the P0 trace is green", async () => {
  const product = join(process.env.NORTHWIND_ROOT ?? "", "packages/domain/src/appealReady.ts");
  const before = readFileSync(product, "utf8");
  const session = new FactorySession("gate-path");
  let view = session.view();
  assert.equal(view.state, "intake");
  assert.equal(view.mode, "recorded");
  const brief = view.tabs.find((tab) => tab.id === "brief")?.blocks.map((block) => block.lines.join(" ")).join("\n") ?? "";
  assert.match(brief, /http:\/\/127\.0\.0\.1:4173\/summary/);
  assert.match(brief, /http:\/\/127\.0\.0\.1:4173\/eligibility/);
  assert.match(brief, /not a new factory run/);
  assert.match(brief, /already calls the fixed function/);
  assert.equal(view.knowledgeError, null);
  assert.ok(view.knowledge.some((item) => item.path === "carc-demo.md"));

  view = await session.act({ type: "begin" });
  assert.equal(view.state, "clarifying");
  assert.equal(view.questions?.length, 5);

  const unanswered = await session.act({ type: "answers", choices: {} });
  assert.equal(unanswered.state, "clarifying");
  assert.match(unanswered.banner ?? "", /Nothing is selected/);

  view = await session.act({ type: "answers", choices: { ...SUGGESTED, "Q-2": "lead" } });
  assert.equal(view.state, "clarifying");
  assert.match(view.banner ?? "", /Nobody in v1/);

  view = await session.act({ type: "answers", choices: SUGGESTED });
  assert.equal(view.state, "prd_gate");
  assert.deepEqual(
    view.tabs.map((tab) => tab.id),
    ["synthesis", "critiques"],
  );
  const requirements = view.tabs.find((tab) => tab.id === "synthesis")?.blocks.map((block) => [block.heading, ...block.lines].join(" ")).join("\n") ?? "";
  assert.match(requirements, /Both analysts returned the same document/);
  assert.match(requirements, /Q-2: Nobody in v1/);
  assert.equal(view.tabs.some((tab) => tab.id === "proposal-a"), false);
  assert.equal(view.approvals.find((item) => item.gate === "prd")?.matches, false);

  view = await session.act({ type: "approve" });
  assert.equal(view.state, "architecture_gate");
  assert.equal(view.approvals.find((item) => item.gate === "prd")?.matches, true);
  const proposalA = view.tabs.find((tab) => tab.id === "proposal-a");
  const proposalB = view.tabs.find((tab) => tab.id === "proposal-b");
  assert.match(fenceLines(proposalA?.blocks ?? []), /packages\/rcm/);
  assert.doesNotMatch(fenceLines(proposalA?.blocks ?? []), /packages\/domain/);
  assert.match(fenceLines(proposalB?.blocks ?? []), /packages\/domain/);
  assert.equal(view.actions.find((action) => action.id === "approve")?.enabled, false);

  view = await session.act({ type: "approve" });
  assert.equal(view.state, "architecture_gate");
  assert.match(view.banner ?? "", /S-1/);

  view = await session.act({ type: "accept-suggestion" });
  assert.equal(view.actions.find((action) => action.id === "approve")?.enabled, true);
  assert.match(view.log.join("\n"), /packages\/domain/);
  const synthesis = view.tabs.find((tab) => tab.id === "synthesis");
  assert.match(synthesis?.blocks.find((block) => block.heading === "Suggestion S-1")?.lines.join(" ") ?? "", /accept/);

  view = await session.act({ type: "approve" });
  assert.equal(view.state, "unit_loop");
  assert.match(view.log.join("\n"), /AC-CO50-NOTE/);
  assert.match(view.log.join("\n"), /true/);
  assert.match(view.log.join("\n"), /node:test/);
  const unit = view.tabs.find((tab) => tab.id === "unit");
  assert.match(unit?.blocks.find((block) => block.heading === "node:test")?.lines.join("\n") ?? "", /AC-CO50-NOTE/);
  assert.match(unit?.blocks.map((block) => block.lines.join(" ")).join("\n") ?? "", /runs\/implementer\/gate-path/);
  assert.match(unit?.blocks.map((block) => block.lines.join(" ")).join("\n") ?? "", /seeded copy/);
  assert.match(unit?.blocks.map((block) => block.lines.join(" ")).join("\n") ?? "", /fixed function/);

  view = await session.act({ type: "repair" });
  assert.equal(view.state, "test_gate");
  assert.match(view.log.join("\n"), /AC-CO50-NOTE/);
  assert.match(view.log.join("\n"), /clinicalNoteRef/);
  assert.equal(readFileSync(product, "utf8"), before);
  const patched = readFileSync(join(process.env.NORTHWIND_ROOT ?? "", "runs/implementer/gate-path/packages/domain/src/appealReady.ts"), "utf8");
  assert.equal(patched.includes('field !== "clinicalNoteRef"'), false);
  assert.equal(patched.includes("appealReadyBuggy"), false);
  assert.notEqual(patched, before);
  const patch = view.tabs.find((tab) => tab.id === "synthesis")?.blocks.find((block) => block.heading === "Patch");
  assert.ok(patch);
  assert.match(patch?.lines.join("\n") ?? "", /clinicalNoteRef/);
  assert.ok(patch?.lines.every((line) => line.startsWith("- ")));

  view = await session.act({ type: "approve" });
  assert.equal(view.state, "deploy_gate");
  assert.equal(view.p0Green, true);
  assert.equal(view.actions.find((action) => action.id === "deploy")?.enabled, true);
  const checks = view.tabs.find((tab) => tab.id === "deploy")?.blocks.find((block) => block.heading === "Priority checks")?.lines.join("\n") ?? "";
  assert.match(checks, /TC-1 passed/);
  assert.match(checks, /clinical note/);
  assert.match(checks, /filing deadline/);
  assert.match(checks, /DOC-003/);
  assert.match(checks, /no appeal/);
  const trace = view.tabs.find((tab) => tab.id === "matrix")?.blocks.map((block) => [block.heading, ...block.lines].join(" ")).join("\n") ?? "";
  assert.match(trace, /REQ-1 · AC-1 · SCN-1 · TC-1/);
  assert.match(trace, /passed\. DEN-01 names the missing clinical note/);
  assert.match(trace, /http:\/\/127\.0\.0\.1:4173\/denial\/DEN-01/);
  assert.match(trace, /SCN-6 · TC-6/);
  assert.match(trace, /not-gated/);
  assert.equal(trace.includes("TC-99"), false);
  assert.match(view.tabs.find((tab) => tab.id === "deploy")?.blocks.map((block) => block.lines.join(" ")).join(" ") ?? "", /not served/);

  session.p0Green = false;
  const refused = session.view();
  assert.equal(refused.actions.find((action) => action.id === "deploy")?.enabled, false);
  assert.match(refused.tabs.find((tab) => tab.id === "deploy")?.blocks[0]?.lines.join(" ") ?? "", /p0-red/);
  view = await session.act({ type: "deploy" });
  assert.equal(view.state, "deploy_gate");
  assert.match(view.log.join("\n"), /p0-red/);

  session.p0Green = true;
  view = await session.act({ type: "deploy" });
  assert.equal(view.state, "deployed");
  assert.match(view.log.join("\n"), /not served/);
  assert.equal(view.approvals.every((item) => item.matches), true);
});

test("a change request returns to the same gate and leaves the document in place", async () => {
  const session = new FactorySession("changes");
  await session.act({ type: "begin" });
  await session.act({ type: "answers", choices: SUGGESTED });
  const before = session.run.artifacts.get("prd")?.hash;
  const view = await session.act({ type: "changes", comment: "Name PR-1" });
  assert.equal(view.state, "prd_gate");
  assert.match(view.log.join("\n"), /Name PR-1/);
  assert.equal(session.run.artifacts.get("prd")?.hash, before);
  assert.equal(view.approvals.find((item) => item.gate === "prd")?.matches, false);
});

test("rejecting the architecture suggestion keeps approve closed until the draft is restored", async () => {
  const session = new FactorySession("reject");
  await session.act({ type: "begin" });
  await session.act({ type: "answers", choices: SUGGESTED });
  await session.act({ type: "approve" });
  let view = await session.act({ type: "reject-suggestion" });
  assert.equal(view.state, "architecture_gate");
  assert.equal(view.actions.find((action) => action.id === "approve")?.enabled, false);
  assert.match(view.log.join("\n"), /rejected/);
  view = await session.act({ type: "changes", comment: "Keep the domain fence" });
  assert.equal(view.state, "architecture_gate");
  assert.equal(view.actions.find((action) => action.id === "accept-suggestion")?.enabled, true);
  assert.match(view.log.join("\n"), /Keep the domain fence/);
});

test("an SSN probe sets a banner and does not move the run", async () => {
  const session = new FactorySession("probe");
  const view = await session.act({ type: "probe", brief: "Patient SSN 123-45-6789" });
  assert.equal(view.state, "intake");
  assert.match(view.banner ?? "", /ssn/);
  assert.equal(session.run.artifacts.size, 0);
  assert.equal(session.run.state, "intake");
});

test("workbench links follow the configured workbench", () => {
  const view = new FactorySession("workbench", "http://127.0.0.1:9999/").view();
  assert.equal(view.workbench, "http://127.0.0.1:9999/");
  const lines = view.tabs.flatMap((tab) => tab.blocks.flatMap((block) => block.lines));
  assert.ok(lines.includes("link:http://127.0.0.1:9999/summary Lead summary"));
  assert.equal(lines.some((line) => line.includes("4173")), false);
});
