import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type * as z from "zod/v4";
import type { PanelRole } from "./panel.ts";
import type { CompletionRequest, ModelProvider } from "./provider.ts";

export const CLAUDE_MODEL = "claude-opus-5";

/** What one seat is told on top of the shared context, and the JSON shape its answer must take. */
export interface SeatSpec {
  instructions: string;
  schema: z.ZodType<unknown>;
}

export interface CallRecord {
  role: PanelRole;
  /** The model that answered. Differs from the requested one when a refusal fell back. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * A live panel seat backed by Claude. Every seat shares one cached context block, gets its own
 * instructions, and must answer in its schema. The gates still judge what comes back.
 */
export class ClaudeModel implements ModelProvider {
  readonly mode = "live" as const;
  readonly calls: CallRecord[] = [];
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    private readonly context: string,
    private readonly seats: Record<PanelRole, SeatSpec>,
    options: { client?: Anthropic; model?: string } = {},
  ) {
    this.client = options.client ?? new Anthropic();
    this.model = options.model ?? CLAUDE_MODEL;
  }

  async complete(request: CompletionRequest): Promise<string> {
    const seat = this.seats[request.role];
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [
        { type: "text", text: this.context, cache_control: { type: "ephemeral" } },
        { type: "text", text: seat.instructions },
      ],
      messages: [{ role: "user", content: request.prompt }],
      output_config: { format: betaZodOutputFormat(seat.schema) },
    });
    this.calls.push({
      role: request.role,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    });
    if (response.stop_reason === "refusal") {
      throw new Error(`model-refused:${request.role}:${response.stop_details?.category ?? "unknown"}`);
    }
    if (response.stop_reason === "max_tokens") throw new Error(`model-truncated:${request.role}`);
    if (response.parsed_output === null) throw new Error(`model-unparsed:${request.role}`);
    return JSON.stringify(response.parsed_output);
  }
}
