import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import type { PanelRole } from "./panel.ts";
import { CompletionError, type Completion, type CompletionRequest, type ModelProvider } from "./provider.ts";

export const CLAUDE_MODEL = "claude-opus-5-5";

/** What one seat is told on top of the shared context, and the JSON shape its answer must take. */
export interface SeatSpec {
  instructions: string;
  schema: z.ZodType<unknown>;
  /**
   * False when the schema is too large for the API to compile into a grammar (a whole PRD inside a wrapper is).
   * The seat is then shown the JSON Schema, answers in plain text, and is validated against the same schema here.
   */
  compiled?: boolean;
}

/** The JSON object in a plain-text answer: the text between the first "{" and the last "}". */
function jsonIn(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/**
 * A live panel seat backed by Claude. Every seat shares one cached context block, gets its own
 * instructions, and must answer in its schema. The gates still judge what comes back.
 */
export class ClaudeModel implements ModelProvider {
  readonly mode = "live" as const;
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly fallbacks: boolean;

  /**
   * `fallbacks: false` turns off server-side refusal fallbacks. An eval needs that: a refused call must fail
   * as a refusal, not come back quietly served by another model.
   */
  constructor(
    private readonly context: string,
    private readonly seats: Partial<Record<PanelRole, SeatSpec>>,
    options: { client?: Anthropic; model?: string; fallbacks?: boolean } = {},
  ) {
    this.client = options.client ?? new Anthropic();
    this.model = options.model ?? CLAUDE_MODEL;
    this.fallbacks = options.fallbacks ?? true;
  }

  get requestedModel(): string {
    return this.model;
  }

  /** The answering model may differ from the requested one when a refusal fell back. */
  async complete(request: CompletionRequest): Promise<Completion> {
    const seat = this.seats[request.role];
    if (!seat) throw new Error(`claude-seat-missing:${request.role}`);
    const compiled = seat.compiled !== false;
    const instructions = compiled
      ? seat.instructions
      : `${seat.instructions}\n\nAnswer with one JSON object that matches this JSON Schema, and nothing else:\n${JSON.stringify(z.toJSONSchema(seat.schema))}`;
    // Streamed, so a long answer gets room without hitting HTTP timeouts. A synthesis of two full PRDs
    // used all of a 16,000-token limit on thinking and output.
    const params = {
      model: this.model,
      max_tokens: 64000,
      ...(this.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      system: [
        { type: "text" as const, text: this.context, cache_control: { type: "ephemeral" as const } },
        { type: "text" as const, text: instructions },
      ],
      messages: [{ role: "user" as const, content: request.prompt }],
    };
    const response = await this.client.beta.messages
      .stream(compiled ? { ...params, output_config: { format: betaZodOutputFormat(seat.schema) } } : params)
      .finalMessage();
    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    };
    if (response.stop_reason === "refusal") {
      throw new CompletionError(`model-refused:${request.role}:${response.stop_details?.category ?? "unknown"}`, response.model, usage);
    }
    if (response.stop_reason === "max_tokens") throw new CompletionError(`model-truncated:${request.role}`, response.model, usage);
    const answer = compiled
      ? response.parsed_output
      : seat.schema.safeParse(jsonIn(response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""))).data;
    if (answer === null || answer === undefined) throw new CompletionError(`model-unparsed:${request.role}`, response.model, usage);
    return { text: JSON.stringify(answer), model: response.model, usage };
  }
}
