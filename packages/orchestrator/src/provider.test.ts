import assert from "node:assert/strict";
import test from "node:test";
import { prdGateIssues, prdIssues, questionSetIssues, type Architecture, type Prd, type QuestionSet } from "./documents.ts";
import { hashValue } from "./hash.ts";
import { isolationIssues } from "./panel.ts";
import { FixturePlayer, playPanel, recordedLines, UnconfiguredModel } from "./provider.ts";
import { CARC_RULES } from "../../domain/src/carc.ts";
import { FEATURE_B_BRIEF, KNOWN_CITATIONS, architecturePanel, prdPanel, questionPanel } from "../../harness/src/panels.ts";

test("the fixture player serves five seats and then refuses another call", () => {
  const player = new FixturePlayer(recordedLines(questionPanel()));
  const played = playPanel<QuestionSet>(player, "questions", FEATURE_B_BRIEF);
  assert.equal(played.calls.length, 5);
  assert.deepEqual(
    played.calls.map((call) => call.role),
    ["analystA", "analystB", "critiqueOfA", "critiqueOfB", "synthesizer"],
  );
  assert.equal(isolationIssues(played.calls).length, 0);
  assert.equal(questionSetIssues(played.panel.synthesis).length, 0);
  assert.throws(() => player.complete({ role: "analystA", prompt: "again" }), /fixture-extra-call/);
});

test("analyst prompts carry the brief and neither proposal", () => {
  const played = playPanel<Prd>(new FixturePlayer(recordedLines(prdPanel())), "prd", FEATURE_B_BRIEF);
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
  assert.equal(prdGateIssues(played.panel.synthesis, prdIssues(played.panel.synthesis, KNOWN_CITATIONS, CARC_RULES)).length, 0);
});

test("a live model is not configured for this demo", () => {
  const model = new UnconfiguredModel();
  assert.equal(model.mode, "live");
  assert.throws(() => model.complete({ role: "analystA", prompt: "brief" }), /model-not-configured/);
});

test("one live implementation panel stops before a draft is stored", () => {
  assert.throws(() => playPanel(new UnconfiguredModel(), "implementation", FEATURE_B_BRIEF), /model-not-configured/);
});

test("the architecture fixture keeps the file-fence disagreement", () => {
  const played = playPanel<Architecture>(new FixturePlayer(recordedLines(architecturePanel())), "architecture", FEATURE_B_BRIEF);
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
