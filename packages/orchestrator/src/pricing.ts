export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Of cacheWriteTokens, those written to the one-hour cache, which costs twice the input price (five minutes: 1.25 times). */
  cacheWriteLongTokens?: number;
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
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  // Haiku 5.5 prices prompts over 100,000 tokens higher; this table carries the short-prompt tier only.
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, longContextFrom: 100_000 },
  "grok-4.7": { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0, longContextFrom: 200_000 },
  // TypeSafe's Jev decision model: input billed, typed answers free.
  "jev-1.14.0": { input: 0.042, output: 0, cacheRead: 0, cacheWrite: 0 },
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
    (usage.cacheWriteTokens - (usage.cacheWriteLongTokens ?? 0)) * price.cacheWrite +
    (usage.cacheWriteLongTokens ?? 0) * price.input * 2;
  return perToken / 1_000_000;
}
