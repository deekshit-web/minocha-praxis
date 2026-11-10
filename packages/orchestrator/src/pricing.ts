export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Prompts at or above this many tokens bill at a higher tier this table does not carry. */
  longContextFrom?: number;
}

/**
 * List prices in USD per million tokens, from each provider's published pricing.
 * Claude cache writes are five-minute writes; xAI caches automatically and bills no write.
 */
const PRICES: Record<string, Price> = {
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "grok-4.7": { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0, longContextFrom: 200_000 },
};

/** The cost of one call, or null when the table has no price for it. A missing price is shown, never guessed. */
export function callCost(model: string, usage: TokenUsage): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  if (price.longContextFrom !== undefined && prompt >= price.longContextFrom) return null;
  const perToken =
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    usage.cacheReadTokens * price.cacheRead +
    usage.cacheWriteTokens * price.cacheWrite;
  return perToken / 1_000_000;
}
