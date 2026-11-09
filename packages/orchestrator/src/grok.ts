import { Agent, fetch as undiciFetch } from "undici";
import * as z from "zod/v4";
import type { SeatSpec } from "./claude.ts";
import type { PanelRole } from "./panel.ts";
import { CompletionError, type Completion, type CompletionRequest, type ModelProvider } from "./provider.ts";
import type { TokenUsage } from "./pricing.ts";

export const GROK_MODEL = "grok-4.7";

const ENDPOINT = "https://api.x.ai/v1/chat/completions";

/**
 * xAI sends no headers until a non-streamed answer is complete, and Grok can reason past Node's
 * five-minute header and body timeouts while writing a whole PRD. This agent allows fifteen.
 */
const PATIENT = new Agent({ headersTimeout: 15 * 60 * 1000, bodyTimeout: 15 * 60 * 1000 });

const patientFetch = ((input: string, init: RequestInit) =>
  undiciFetch(input, { ...(init as object), dispatcher: PATIENT })) as unknown as typeof fetch;

/** The parts of an xAI chat-completions response this provider reads. */
interface GrokResponse {
  model?: string;
  choices?: Array<{ finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    /** What xAI billed for the call, in billionths of a dollar. */
    cost_in_nano_usd?: number | null;
  };
  error?: { message?: string } | string;
}

/**
 * A live panel seat backed by Grok through xAI's chat-completions API. Same contract as ClaudeModel:
 * shared context plus seat instructions, a JSON-schema response, and the gates judge what comes back.
 */
export class GrokModel implements ModelProvider {
  readonly mode = "live" as const;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly fetch: typeof fetch;
  private readonly endpoint: string;

  constructor(
    private readonly context: string,
    private readonly seats: Partial<Record<PanelRole, SeatSpec>>,
    options: { apiKey?: string; model?: string; fetch?: typeof fetch; endpoint?: string } = {},
  ) {
    this.endpoint = options.endpoint ?? ENDPOINT;
    this.apiKey = options.apiKey ?? process.env.XAI_API_KEY;
    this.model = options.model ?? GROK_MODEL;
    this.fetch = options.fetch ?? patientFetch;
  }

  async complete(request: CompletionRequest): Promise<Completion> {
    const seat = this.seats[request.role];
    if (!seat) throw new Error(`grok-seat-missing:${request.role}`);
    if (!this.apiKey) throw new Error("XAI_API_KEY is not set.");
    const compiled = seat.compiled !== false;
    const schema = z.toJSONSchema(seat.schema);
    const instructions = compiled
      ? seat.instructions
      : `${seat.instructions}\n\nAnswer with one JSON object that matches this JSON Schema, and nothing else:\n${JSON.stringify(schema)}`;
    const response = await this.fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(15 * 60 * 1000),
      body: JSON.stringify({
        model: this.model,
        max_tokens: 16000,
        messages: [
          { role: "system", content: `${this.context}\n\n${instructions}` },
          { role: "user", content: request.prompt },
        ],
        response_format: compiled
          ? { type: "json_schema", json_schema: { name: `${request.role}_answer`, schema, strict: true } }
          : { type: "json_object" },
      }),
    }).catch((error: unknown) => {
      // fetch reports every network failure as "fetch failed"; the cause names the real one.
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
      const code = cause && typeof cause === "object" && "code" in cause ? ` ${String(cause.code)}` : "";
      throw new Error(`xai-network:${code} ${cause instanceof Error ? cause.message : String(cause)}`.trim(), { cause: error });
    });
    const body = (await response.json().catch(() => ({}))) as GrokResponse;
    if (!response.ok) {
      const detail = typeof body.error === "string" ? body.error : body.error?.message ?? response.statusText;
      throw new Error(`xai-error ${response.status}: ${detail}`);
    }
    const model = body.model ?? this.model;
    const usage: TokenUsage = {
      inputTokens: (body.usage?.prompt_tokens ?? 0) - (body.usage?.prompt_tokens_details?.cached_tokens ?? 0),
      outputTokens: body.usage?.completion_tokens ?? 0,
      cacheReadTokens: body.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: 0,
    };
    const nano = body.usage?.cost_in_nano_usd;
    const costUsd = typeof nano === "number" ? nano / 1e9 : undefined;
    const choice = body.choices?.[0];
    if (choice?.message?.refusal) throw new CompletionError(`model-refused:${request.role}:grok`, model, usage, costUsd);
    if (choice?.finish_reason === "length") throw new CompletionError(`model-truncated:${request.role}`, model, usage, costUsd);
    let parsed: unknown;
    try {
      parsed = JSON.parse(choice?.message?.content ?? "");
    } catch {
      parsed = undefined;
    }
    const answer = seat.schema.safeParse(parsed);
    if (!answer.success) throw new CompletionError(`model-unparsed:${request.role}`, model, usage, costUsd);
    return { text: JSON.stringify(answer.data), model, usage, costUsd };
  }
}

/** Sends each seat to its own provider, so two different models can draft and critique each other. */
export class SeatRouter implements ModelProvider {
  readonly mode = "live" as const;

  constructor(private readonly route: Record<PanelRole, ModelProvider>) {}

  complete(request: CompletionRequest): Promise<Completion> {
    return this.route[request.role].complete(request);
  }
}
