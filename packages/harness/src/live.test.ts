import assert from "node:assert/strict";
import test from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  CLAUDE_MODEL,
  ClaudeModel,
  FixturePlayer,
  PanelCallError,
  ResumingProvider,
  recordedLines,
  type Prd,
} from "@northwind/orchestrator";
import { livePrdSeats, loadLiveShowcase, prdContext, runLivePrd, summarizeLiveRun, withChains } from "./live.ts";
import { FEATURE_B_BRIEF, prdPanel } from "./panels.ts";

interface FakeReply {
  stop_reason?: string;
  stop_details?: { category: string } | null;
  /** The answer to a compiled-schema seat. */
  parsed_output?: unknown;
  /** The plain-text answer to a seat without a compiled schema. */
  text?: string;
}

/** Stands in for the Anthropic client: records each request and answers from a script. */
function fakeClient(replies: FakeReply[]): { client: Anthropic; requests: Array<Record<string, unknown>> } {
  const requests: Array<Record<string, unknown>> = [];
  const answer = (params: Record<string, unknown>) => {
    requests.push(params);
    const reply = replies[requests.length - 1];
    if (!reply) throw new Error("fake-client-extra-call");
    return {
      model: CLAUDE_MODEL,
      stop_reason: reply.stop_reason ?? "end_turn",
      stop_details: reply.stop_details ?? null,
      content: reply.text === undefined ? [] : [{ type: "text", text: reply.text }],
      usage: { input_tokens: 1200, output_tokens: 3400, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
    };
  };
  // Mirrors client.beta.messages.stream(...).finalMessage(): parsed_output is set only when a format was sent.
  const stream = (params: Record<string, unknown>) => ({
    finalMessage: async () => {
      const response = answer(params);
      const reply = replies[requests.length - 1];
      return { ...response, parsed_output: params.output_config ? (reply?.parsed_output ?? null) : null };
    },
  });
  return { client: { beta: { messages: { stream } } } as unknown as Anthropic, requests };
}

/** The recorded PRD panel as Claude would return it: four parsed answers, then the synthesis as fenced JSON text. */
function recordedReplies(): FakeReply[] {
  const lines = recordedLines(prdPanel());
  return [
    ...lines.slice(0, 4).map((line) => ({ parsed_output: JSON.parse(line) })),
    { text: `Here is the merged PRD.\n\n\`\`\`json\n${lines[4]}\n\`\`\`` },
  ];
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
  assert.equal(first.model, CLAUDE_MODEL);
  assert.equal((first as { max_tokens?: number }).max_tokens, 64000);
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
    result.metrics.map((metric) => metric.role),
    ["analystA", "analystB", "critiqueOfA", "critiqueOfB", "synthesizer"],
  );
  for (const metric of result.metrics) {
    assert.equal(metric.source, "live");
    assert.equal(metric.model, CLAUDE_MODEL);
    assert.ok(metric.durationMs >= 0);
    // 1200 in at $5, 3400 out at $25, 900 cache reads at $0.50 per million tokens.
    assert.equal(metric.costUsd?.toFixed(5), "0.07298");
  }
  assert.ok(result.durationMs >= 0);
  assert.equal(result.quality.synthesizer.verdict, "pass");
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

test("the gates judge a live PRD: an ungrounded citation, an unflagged open question, and leaked PHI are refused", async () => {
  const lines = recordedLines(prdPanel());
  const wrapped = JSON.parse(lines[4] ?? "{}") as { synthesis: Prd; rationale: unknown };
  wrapped.synthesis.citations = [...wrapped.synthesis.citations, "pack/glossary.md"];
  wrapped.synthesis.openQuestions = [
    { id: "OQ-1", text: "Who owns the override?" },
    { id: "OQ-2", text: "Proposed: the PFS lead owns overrides. Needs sign-off." },
  ];
  wrapped.synthesis.problem = `${wrapped.synthesis.problem} Call 415-555-0134 for help.`;
  const result = await runLivePrd(new FixturePlayer([...lines.slice(0, 4), JSON.stringify(wrapped)]));
  assert.deepEqual(result.issues, ["missing-citation:pack/glossary.md", "open-question-unflagged:OQ-1", "phi:phone:415-555-0134"]);
});

test("the synthesizer answers in plain JSON checked against its schema, since its compiled grammar is too large", async () => {
  const { client, requests } = fakeClient(recordedReplies());
  const result = await runLivePrd(new ClaudeModel(prdContext(FEATURE_B_BRIEF), livePrdSeats(), { client }));
  assert.deepEqual(result.issues, []);
  const synthesis = requests[4] as { output_config?: unknown; system: Array<{ text: string }> };
  assert.equal(synthesis.output_config, undefined);
  assert.match(synthesis.system[1]?.text ?? "", /matches this JSON Schema/);
  assert.ok((requests[0] as { output_config?: unknown }).output_config);
});

test("a malformed synthesis fails, keeps the four finished answers and every billed call, and the run resumes from them", async () => {
  const replies = recordedReplies();
  const broken = fakeClient([...replies.slice(0, 4), { text: "I could not produce the document." }]);
  const failure = await runLivePrd(new ClaudeModel(prdContext(FEATURE_B_BRIEF), livePrdSeats(), { client: broken.client })).then(
    () => assert.fail("the malformed synthesis was accepted"),
    (error: unknown) => error,
  );
  assert.ok(failure instanceof PanelCallError);
  assert.match(failure.message, /model-unparsed:synthesizer/);
  assert.equal(failure.answers.length, 4);
  assert.equal(failure.metrics.length, 5);
  assert.equal(failure.metrics[4]?.role, "synthesizer");
  assert.equal(failure.metrics[4]?.costUsd?.toFixed(5), "0.07298");

  const retry = fakeClient([replies[4] ?? {}]);
  const resumed = await runLivePrd(new ResumingProvider(failure.answers, new ClaudeModel(prdContext(FEATURE_B_BRIEF), livePrdSeats(), { client: retry.client })));
  assert.equal(retry.requests.length, 1);
  assert.deepEqual(resumed.issues, []);
  assert.deepEqual(
    resumed.metrics.map((metric) => [metric.source, metric.costUsd === 0]),
    [["resumed", true], ["resumed", true], ["resumed", true], ["resumed", true], ["live", false]],
  );

  const summary = summarizeLiveRun("prd-failed.json", {
    format: 2,
    model: CLAUDE_MODEL,
    brief: FEATURE_B_BRIEF,
    startedAt: "2026-11-09T09:26:00.000Z",
    durationMs: 540_000,
    metrics: failure.metrics,
    failure: failure.message,
    answers: failure.answers,
  });
  assert.equal(summary.verdict, "failed");
  assert.equal(summary.costUsd?.toFixed(4), (0.07298 * 5).toFixed(4));
  assert.deepEqual(summary.issues, ["model-unparsed:synthesizer"]);
});

test("a resumed seat whose prompt changed is refused rather than replayed", async () => {
  const provider = new ResumingProvider([{ role: "analystA", prompt: "an older brief", text: "{}" }], new FixturePlayer(recordedLines(prdPanel())));
  await assert.rejects(provider.complete({ role: "analystA", prompt: "a new brief" }), /resume-prompt-changed:analystA/);
});

test("a resumed or re-checked run reports what the whole chain of attempts cost and took", () => {
  const run = (file: string, kind: "live" | "resumed" | "recheck", resumedFrom: string | null, costUsd: number, durationMs: number) => ({
    file,
    kind,
    resumedFrom,
    startedAt: null,
    durationMs,
    verdict: "pass" as const,
    issues: [],
    costUsd,
    chainCostUsd: costUsd,
    chainDurationMs: durationMs,
    rows: [],
  });
  const chained = withChains([
    run("d.json", "recheck", "c.json", 0, 0),
    run("c.json", "resumed", "b.json", 0.87, 319_500),
    run("b.json", "resumed", "a.json", 0.91, 1_027_000),
    run("a.json", "live", null, 0.3, 426_000),
  ]);
  assert.equal(chained[0]?.chainCostUsd?.toFixed(2), "2.08");
  assert.equal(chained[0]?.chainDurationMs, 1_772_500);
  assert.equal(chained[3]?.chainCostUsd, 0.3);
});

test("the showcase takes each seat's time and cost from the attempt where it succeeded", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "live-showcase-"));
  try {
    const lines = recordedLines(prdPanel());
    const panel = prdPanel();
    const metric = (role: string, model: string, durationMs: number, costUsd: number, source = "live") => ({
      role,
      source,
      model,
      durationMs,
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsd,
    });
    const seats = ["analystA", "analystB", "critiqueOfA", "critiqueOfB", "synthesizer"];
    // Attempt 1: analyst A finished; analyst B failed before a metric was recorded.
    writeFileSync(
      join(dir, "prd-1.json"),
      JSON.stringify({
        format: 2,
        model: "m",
        brief: FEATURE_B_BRIEF,
        startedAt: "2026-11-09T01:00:00.000Z",
        durationMs: 400_000,
        metrics: [metric("analystA", "claude-opus-5", 125_000, 0.3)],
        failure: "xai-network: UND_ERR_HEADERS_TIMEOUT",
        answers: [{ role: "analystA", prompt: "p", text: lines[0] }],
      }),
    );
    // Attempt 2: resumed, the other four seats ran live and the gates passed.
    writeFileSync(
      join(dir, "prd-2.json"),
      JSON.stringify({
        format: 2,
        model: "m",
        brief: FEATURE_B_BRIEF,
        startedAt: "2026-11-09T02:00:00.000Z",
        durationMs: 900_000,
        resumedFrom: "prd-1.json",
        metrics: [
          metric("analystA", "claude-opus-5", 0, 0, "resumed"),
          metric("analystB", "grok-4.7", 500_000, 0.06),
          metric("critiqueOfA", "grok-4.7", 259_000, 0.02),
          metric("critiqueOfB", "claude-opus-5", 94_000, 0.27),
          metric("synthesizer", "claude-opus-5", 319_000, 0.87),
        ],
        issues: [],
        calls: seats.map((role) => ({ role, prompt: "p" })),
        panel,
      }),
    );
    const show = loadLiveShowcase(dir);
    assert.ok(show);
    assert.equal(show.file, "prd-2.json");
    assert.equal(show.paidAttempts, 2);
    assert.equal(show.chainCostUsd?.toFixed(2), "1.52");
    assert.deepEqual(
      show.seats.map((seat) => [seat.role, seat.model, seat.durationMs, seat.costUsd]),
      [
        ["analystA", "claude-opus-5", 125_000, 0.3],
        ["analystB", "grok-4.7", 500_000, 0.06],
        ["critiqueOfA", "grok-4.7", 259_000, 0.02],
        ["critiqueOfB", "claude-opus-5", 94_000, 0.27],
        ["synthesizer", "claude-opus-5", 319_000, 0.87],
      ],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
