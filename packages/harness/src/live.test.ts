import assert from "node:assert/strict";
import test from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL, ClaudeModel, FixturePlayer, recordedLines, type Prd } from "@northwind/orchestrator";
import { livePrdSeats, prdContext, runLivePrd } from "./live.ts";
import { FEATURE_B_BRIEF, prdPanel } from "./panels.ts";

interface FakeReply {
  stop_reason?: string;
  stop_details?: { category: string } | null;
  parsed_output?: unknown;
}

/** Stands in for the Anthropic client: records each request and answers from a script. */
function fakeClient(replies: FakeReply[]): { client: Anthropic; requests: Array<Record<string, unknown>> } {
  const requests: Array<Record<string, unknown>> = [];
  const parse = async (params: Record<string, unknown>) => {
    requests.push(params);
    const reply = replies[requests.length - 1];
    if (!reply) throw new Error("fake-client-extra-call");
    return {
      model: CLAUDE_MODEL,
      stop_reason: reply.stop_reason ?? "end_turn",
      stop_details: reply.stop_details ?? null,
      parsed_output: reply.parsed_output ?? null,
      usage: { input_tokens: 1200, output_tokens: 3400, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
    };
  };
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, requests };
}

function recordedReplies(): FakeReply[] {
  return recordedLines(prdPanel()).map((line) => ({ parsed_output: JSON.parse(line) }));
}

test("each PRD seat asks Claude with the shared cached context, its own schema, and its seat prompt", async () => {
  const { client, requests } = fakeClient(recordedReplies());
  const model = new ClaudeModel(prdContext(FEATURE_B_BRIEF), livePrdSeats(), { client });
  const result = await runLivePrd(model);
  assert.equal(requests.length, 5);
  const first = requests[0] as {
    model: string;
    fallbacks: string;
    betas: string[];
    system: Array<{ text: string; cache_control?: unknown }>;
    messages: Array<{ content: string }>;
    output_config: { format: unknown };
  };
  assert.equal(first.model, "claude-opus-5");
  assert.equal(first.fallbacks, "default");
  assert.deepEqual(first.betas, ["server-side-fallback-2026-07-01"]);
  assert.deepEqual(first.system[0]?.cache_control, { type: "ephemeral" });
  assert.match(first.system[0]?.text ?? "", /CO-50 medical-necessity denials/);
  assert.match(first.system[0]?.text ?? "", /### pack\/phi-policy\.md/);
  assert.match(first.system[1]?.text ?? "", /analyst A/);
  assert.ok(first.output_config.format);
  assert.equal(first.messages[0]?.content, result.calls[0]?.prompt);
  assert.equal(requests.every((request) => (request.system as Array<{ text: string }>)[0]?.text === first.system[0]?.text), true);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    model.calls.map((call) => call.role),
    ["analystA", "analystB", "critiqueOfA", "critiqueOfB", "synthesizer"],
  );
});

test("a refusal or a truncated answer stops the panel with the seat and the reason", async () => {
  const refused = new ClaudeModel(prdContext(FEATURE_B_BRIEF), livePrdSeats(), {
    client: fakeClient([{ stop_reason: "refusal", stop_details: { category: "cyber" } }]).client,
  });
  await assert.rejects(runLivePrd(refused), /model-refused:analystA:cyber/);
  const truncated = new ClaudeModel(prdContext(FEATURE_B_BRIEF), livePrdSeats(), {
    client: fakeClient([{ stop_reason: "max_tokens" }]).client,
  });
  await assert.rejects(runLivePrd(truncated), /model-truncated:analystA/);
});

test("the gates judge a live PRD: an ungrounded citation, an open question, and leaked PHI are refused", async () => {
  const lines = recordedLines(prdPanel());
  const wrapped = JSON.parse(lines[4] ?? "{}") as { synthesis: Prd; rationale: unknown };
  wrapped.synthesis.citations = [...wrapped.synthesis.citations, "pack/glossary.md"];
  wrapped.synthesis.openQuestions = [{ id: "OQ-1", text: "Who owns the override?" }];
  wrapped.synthesis.problem = `${wrapped.synthesis.problem} Call 415-555-0134 for help.`;
  const result = await runLivePrd(new FixturePlayer([...lines.slice(0, 4), JSON.stringify(wrapped)]));
  assert.deepEqual(result.issues, ["missing-citation:pack/glossary.md", "open-questions", "phi:phone:415-555-0134"]);
});
