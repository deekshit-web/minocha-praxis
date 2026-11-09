import assert from "node:assert/strict";
import test from "node:test";
import { prdGateIssues, prdIssues, questionSetIssues, type Architecture, type Prd, type QuestionSet } from "./documents.ts";
import { hashValue } from "./hash.ts";
import { isolationIssues } from "./panel.ts";
import { FixturePlayer, playPanel, recordedLines, UnconfiguredModel } from "./provider.ts";
import { CARC_RULES } from "@northwind/domain";
import { FEATURE_B_BRIEF, architecturePanel, groundedCitations, prdPanel, questionPanel } from "@northwind/harness";

test("the fixture player serves five seats and then refuses another call", async () => {
  const player = new FixturePlayer(recordedLines(questionPanel()));
  const played = await playPanel<QuestionSet>(player, "questions", FEATURE_B_BRIEF);
  assert.equal(played.calls.length, 5);
  assert.deepEqual(
    played.calls.map((call) => call.role),
    ["analystA", "analystB", "critiqueOfA", "critiqueOfB", "synthesizer"],
  );
  assert.equal(isolationIssues(played.calls).length, 0);
  assert.equal(questionSetIssues(played.panel.synthesis).length, 0);
  await assert.rejects(player.complete({ role: "analystA", prompt: "again" }), /fixture-extra-call/);
});

test("analyst prompts carry the brief and neither proposal", async () => {
  const played = await playPanel<Prd>(new FixturePlayer(recordedLines(prdPanel())), "prd", FEATURE_B_BRIEF);
  const analystA = played.calls[0]?.prompt ?? "";
  const analystB = played.calls[1]?.prompt ?? "";
  assert.match(analystA, /CO-50/);
  assert.equal(analystA.includes("<<PROPOSAL_A>>"), false);
  assert.equal(analystA.includes("<<PROPOSAL_B>>"), false);
  assert.equal(analystB.includes("<<PROPOSAL_A>>"), false);
  assert.equal(analystB.includes("<<PROPOSAL_B>>"), false);
  assert.match(played.calls[2]?.prompt ?? "", /<<PROPOSAL_A>>/);
  assert.equal((played.calls[2]?.prompt ?? "").includes("<<PROPOSAL_B>>"), false);
  assert.match(played.calls[4]?.prompt ?? "", /<<CRITIQUE_OF_A>>/);
  assert.match(played.calls[4]?.prompt ?? "", /<<CRITIQUE_OF_B>>/);
  assert.equal(hashValue(played.panel.synthesis), hashValue(prdPanel().synthesis));
  assert.equal(prdGateIssues(played.panel.synthesis, prdIssues(played.panel.synthesis, groundedCitations(FEATURE_B_BRIEF), CARC_RULES)).length, 0);
});

test("a live model is not configured for this demo", async () => {
  const model = new UnconfiguredModel();
  assert.equal(model.mode, "live");
  await assert.rejects(model.complete({ role: "analystA", prompt: "brief" }), /model-not-configured/);
});

test("one live implementation panel stops before a draft is stored", async () => {
  await assert.rejects(playPanel(new UnconfiguredModel(), "implementation", FEATURE_B_BRIEF), /model-not-configured/);
});

test("a citation must name a pack file that retrieval found for the brief", () => {
  const known = groundedCitations(FEATURE_B_BRIEF);
  assert.ok(known.has("pack/phi-policy.md"));
  assert.equal(known.has("pack/gone.md"), false);
  assert.equal(known.has("pack/glossary.md"), false);
  const prd = prdPanel().synthesis;
  const issues = prdIssues({ ...prd, citations: [...prd.citations, "pack/gone.md", "pack/glossary.md"] }, known, CARC_RULES);
  assert.deepEqual(issues, ["missing-citation:pack/gone.md", "missing-citation:pack/glossary.md"]);
});

test("the architecture fixture keeps the file-fence disagreement", async () => {
  const played = await playPanel<Architecture>(new FixturePlayer(recordedLines(architecturePanel())), "architecture", FEATURE_B_BRIEF);
  assert.equal(isolationIssues(played.calls).length, 0);
  assert.deepEqual(played.panel.proposalA.fileFence, ["packages/rcm/**"]);
  assert.ok(played.panel.synthesis.fileFence.includes("packages/domain/**"));
  assert.equal(played.panel.synthesis.suggestions[0]?.decision, "pending");
  assert.equal(played.calls[0]?.prompt.includes("<<PROPOSAL_B>>"), false);
  assert.match(played.calls[2]?.prompt ?? "", /<<PROPOSAL_A>>/);
});

test("the player rejects a script that is not five calls", () => {
  assert.throws(() => new FixturePlayer(["only-one"]), /fixture-script-length/);
});
