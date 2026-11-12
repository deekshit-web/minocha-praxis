import assert from "node:assert/strict";
import test from "node:test";
import { GrokModel, SeatRouter } from "./grok.ts";
import { callCost } from "./pricing.ts";
import { CompletionError, type ModelProvider } from "./provider.ts";
import { CritiqueSchema } from "./schemas.ts";

const critique = {
  of: "A",
  author: "B",
  strengths: ["Names the missing items."],
  defects: [],
  adopt: [],
  reject: [],
  attributes: [
    { attribute: "security", met: true, note: "Synthetic ids only." },
    { attribute: "accuracy", met: true, note: "Matches the CARC table." },
    { attribute: "maintainability", met: true, note: "One rule in the domain package." },
  ],
};

function fakeFetch(status: number, body: unknown): { fetch: typeof fetch; requests: Array<{ url: string; init: RequestInit }> } {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fake = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch: fake as typeof fetch, requests };
}

function reply(content: string, finish = "stop") {
  return {
    model: "grok-4.7",
    choices: [{ finish_reason: finish, message: { content } }],
    usage: { prompt_tokens: 1000, completion_tokens: 2000, prompt_tokens_details: { cached_tokens: 400 }, cost_in_nano_usd: 13_400_000 },
  };
}

const seats = { critiqueOfA: { instructions: "You are analyst B, reviewing analyst A.", schema: CritiqueSchema } };

test("A Grok seat sends the context, its instructions and a strict JSON schema. It reports the cost that xAI billed.", async () => {
  const { fetch, requests } = fakeFetch(200, reply(JSON.stringify(critique)));
  const grok = new GrokModel("SHARED CONTEXT", seats, { apiKey: "xai-test", fetch });
  const answer = await grok.complete({ role: "critiqueOfA", prompt: "critiqueOfA\nthe brief" });
  assert.deepEqual(JSON.parse(answer.text), critique);
  assert.equal(answer.model, "grok-4.7");
  assert.deepEqual(answer.usage, { inputTokens: 600, outputTokens: 2000, cacheReadTokens: 400, cacheWriteTokens: 0 });
  assert.equal(answer.costUsd, 0.0134);
  const sent = requests[0];
  assert.equal(sent?.url, "https://api.x.ai/v1/chat/completions");
  assert.equal((sent?.init.headers as Record<string, string>).authorization, "Bearer xai-test");
  const body = JSON.parse(String(sent?.init.body)) as {
    model: string;
    messages: Array<{ role: string; content: string }>;
    response_format: { type: string; json_schema: { strict: boolean; schema: { type: string } } };
  };
  assert.equal(body.model, "grok-4.7");
  assert.equal(body.messages[0]?.role, "system");
  assert.match(body.messages[0]?.content ?? "", /SHARED CONTEXT[\s\S]*analyst B, reviewing analyst A/);
  assert.equal(body.messages[1]?.content, "critiqueOfA\nthe brief");
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.schema.type, "object");
});

test("A malformed Grok answer is rejected. The run keeps its billed cost. An HTTP error names the status.", async () => {
  const bad = new GrokModel("ctx", seats, { apiKey: "xai-test", fetch: fakeFetch(200, reply('{"of":"A"}')).fetch });
  const failure = await bad.complete({ role: "critiqueOfA", prompt: "p" }).catch((error: unknown) => error);
  assert.ok(failure instanceof CompletionError);
  assert.match(failure.message, /model-unparsed:critiqueOfA/);
  assert.equal(failure.costUsd, 0.0134);
  const cut = new GrokModel("ctx", seats, { apiKey: "xai-test", fetch: fakeFetch(200, reply("{", "length")).fetch });
  await assert.rejects(cut.complete({ role: "critiqueOfA", prompt: "p" }), /model-truncated:critiqueOfA/);
  const denied = new GrokModel("ctx", seats, { apiKey: "xai-test", fetch: fakeFetch(401, { error: "Incorrect API key" }).fetch });
  await assert.rejects(denied.complete({ role: "critiqueOfA", prompt: "p" }), /xai-error 401: Incorrect API key/);
});

test("The seat router sends each seat to its own provider.", async () => {
  const asked: string[] = [];
  const named = (name: string): ModelProvider => ({
    mode: "live",
    complete: async (request) => {
      asked.push(`${request.role}->${name}`);
      return { text: "{}" };
    },
  });
  const claude = named("claude");
  const grok = named("grok");
  const router = new SeatRouter({ analystA: claude, analystB: grok, critiqueOfA: grok, critiqueOfB: claude, synthesizer: claude });
  for (const role of ["analystA", "analystB", "critiqueOfA", "critiqueOfB", "synthesizer"] as const) await router.complete({ role, prompt: "" });
  assert.deepEqual(asked, ["analystA->claude", "analystB->grok", "critiqueOfA->grok", "critiqueOfB->claude", "synthesizer->claude"]);
});

test("When no cost is reported, the price table gives the Grok price. The code does not guess the price of a long-context prompt.", () => {
  const usage = { inputTokens: 600, outputTokens: 2000, cacheReadTokens: 400, cacheWriteTokens: 0 };
  // 600 x $2 + 2000 x $6 + 400 x $0.50 per million tokens.
  assert.equal(callCost("grok-4.7", usage)?.toFixed(6), "0.013400");
  assert.equal(callCost("grok-4.7", { ...usage, inputTokens: 250_000 }), null);
  assert.equal(callCost("some-other-model", usage), null);
});

test("The default xAI client waits for a slow server. A network failure names its cause.", async () => {
  const { createServer } = await import("node:http");
  const server = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(reply(JSON.stringify(critique))));
    }, 1500);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const slow = new GrokModel("ctx", seats, { apiKey: "xai-test", endpoint: `http://127.0.0.1:${port}/v1/chat/completions` });
    const answer = await slow.complete({ role: "critiqueOfA", prompt: "p" });
    assert.deepEqual(JSON.parse(answer.text), critique);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  const unreachable = new GrokModel("ctx", seats, { apiKey: "xai-test", endpoint: `http://127.0.0.1:${port}/v1/chat/completions` });
  await assert.rejects(unreachable.complete({ role: "critiqueOfA", prompt: "p" }), /xai-network: ECONNREFUSED/);
});
