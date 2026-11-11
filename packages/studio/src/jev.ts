import { callCost } from "@northwind/orchestrator";
import { type Decision, type DecisionAnswer, type WorkflowSpec, decisionFor, formatDecision, replayAnswers } from "./workflows.ts";

/** TypeSafe's decision endpoint. The key is read on the server and never sent to the page. */
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
/** Priced like the pinned release the table carries: input billed, typed answers free. */
const PRICED_AS = "jev-1.14.0";

export interface DecisionResult {
  live: boolean;
  text: string;
  /** Live: which model answered, how long it took and what it cost. Replay: why it is not live. */
  model?: string;
  ms?: number;
  inputTokens?: number;
  costUsd?: number;
  reason?: string;
  cached?: boolean;
}

export interface DeciderOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** Live calls allowed per UTC day. Past it, decisions replay. */
  dailyCap?: number;
  /** How long a live answer is reused, so a busy booth does not repeat the same call. */
  cacheMs?: number;
  now?: () => number;
}

/** Reads one typed answer, tolerating the field names the docs and SDKs use for a choice. */
function readAnswer(raw: unknown): DecisionAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const answer = raw as Record<string, unknown>;
  if (typeof answer.noul === "number") return { type: "noul", noul: answer.noul };
  const probabilities = (answer.probabilities ?? answer.distribution ?? answer.probs) as Record<string, number> | undefined;
  const choice = (answer.choice ?? answer.answer ?? answer.selected) as string | undefined;
  if (probabilities && typeof probabilities === "object") {
    const top = choice ?? Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top) return { type: "choice", choice: top, probabilities };
  }
  return null;
}

/**
 * Model C's decisions, live when a key is set. Each workflow's questions are fixed, so visitors cannot send
 * their own text; answers are cached, and a daily cap bounds the spend. Anything else falls back to the replay.
 */
export function createDecider(options: DeciderOptions = {}) {
  const apiKey = options.apiKey ?? process.env.JEV_API_KEY;
  const fetchImpl = options.fetchImpl ?? fetch;
  const dailyCap = options.dailyCap ?? 500;
  const cacheMs = options.cacheMs ?? 6 * 60 * 60 * 1000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; result: DecisionResult }>();
  const inFlight = new Map<string, Promise<DecisionResult>>();
  let day = "";
  let calls = 0;

  const replay = (spec: WorkflowSpec, stepId: string, decision: Decision, reason: string): DecisionResult => ({
    live: false,
    text: formatDecision(decision, replayAnswers(spec, stepId, decision)),
    reason,
  });

  async function ask(spec: WorkflowSpec, stepId: string, decision: Decision): Promise<DecisionResult> {
    const questions = Object.fromEntries(
      decision.questions.map((question) => [question.key, { type: question.type, instructions: question.instructions, ...(question.criteria ? { criteria: question.criteria } : {}) }]),
    );
    const started = now();
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: JEV_MODEL, state: decision.state, questions }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return replay(spec, stepId, decision, `the decision model answered ${response.status}`);
    const body = (await response.json()) as { model?: string; answers?: Record<string, unknown>; usage?: { input_tokens?: number } };
    const answers: Record<string, DecisionAnswer> = {};
    for (const question of decision.questions) {
      const answer = readAnswer(body.answers?.[question.key]);
      if (!answer) return replay(spec, stepId, decision, "the decision model's answer could not be read");
      answers[question.key] = answer;
    }
    const inputTokens = body.usage?.input_tokens ?? 0;
    return {
      live: true,
      text: formatDecision(decision, answers),
      model: body.model ?? JEV_MODEL,
      ms: now() - started,
      inputTokens,
      costUsd: callCost(PRICED_AS, { inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }) ?? 0,
    };
  }

  return {
    live: Boolean(apiKey),
    async decide(spec: WorkflowSpec, stepId: string): Promise<DecisionResult | null> {
      const decision = decisionFor(spec, stepId);
      if (!decision) return null;
      if (!apiKey) return replay(spec, stepId, decision, "no decision-model key is set on this server");
      const key = `${spec.id}:${stepId}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < cacheMs) return { ...hit.result, cached: true };
      const pending = inFlight.get(key);
      if (pending) return pending;
      const today = new Date(now()).toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        calls = 0;
      }
      if (calls >= dailyCap) return replay(spec, stepId, decision, "today's cap on live decisions is reached");
      calls += 1;
      const call = ask(spec, stepId, decision)
        .catch(() => replay(spec, stepId, decision, "the decision model could not be reached"))
        .then((result) => {
          if (result.live) cache.set(key, { at: now(), result });
          inFlight.delete(key);
          return result;
        });
      inFlight.set(key, call);
      return call;
    },
  };
}
