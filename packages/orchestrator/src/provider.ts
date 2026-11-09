import type { PanelCritique, PanelRole, PanelStage, ReviewPanel, SynthesisRationale } from "./panel.ts";
import { buildSeatPrompt, type PanelCall } from "./panel.ts";
import { callCost, type TokenUsage } from "./pricing.ts";

export interface CompletionRequest {
  role: PanelRole;
  prompt: string;
}

/** One seat's answer. A live provider also reports the model that answered and what it cost in tokens. */
export interface Completion {
  text: string;
  model?: string;
  usage?: TokenUsage;
  /** Replayed from an earlier live run that already paid for it. */
  resumed?: boolean;
  /** What the provider reports it billed, when it does. Preferred over a price-table estimate. */
  costUsd?: number;
}

/** Fixture player first. A live model is a second implementation of the same call. */
export interface ModelProvider {
  readonly mode: "fixture" | "live";
  complete(request: CompletionRequest): Promise<Completion>;
}

/** What one call took. A recorded replay has no model, no tokens, and no cost. */
export interface CallMetric {
  role: PanelRole;
  /** "resumed" is a live answer replayed from an earlier run; its cost was counted there. */
  source: "recorded" | "live" | "resumed";
  model: string | null;
  durationMs: number;
  usage: TokenUsage | null;
  /** Null when the call was live but the model has no known price. */
  costUsd: number | null;
}

/** A live answer that cannot be used: refused, cut off, or unparsed. It still billed, so it carries its usage. */
export class CompletionError extends Error {
  constructor(
    message: string,
    readonly model: string,
    readonly usage: TokenUsage,
    readonly costUsd?: number,
  ) {
    super(message);
  }
}

/** A finished seat: what it was asked, what it answered, and what that cost. Enough to resume a failed run. */
export interface SeatAnswer {
  role: PanelRole;
  prompt: string;
  text: string;
  model?: string;
  usage?: TokenUsage;
}

/** A seat failed. Carries the finished seats and their metrics, so their cost is reported and the run can resume. */
export class PanelCallError extends Error {
  constructor(
    readonly role: PanelRole,
    readonly metrics: CallMetric[],
    readonly answers: SeatAnswer[],
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

const ROLES: readonly PanelRole[] = ["analystA", "analystB", "critiqueOfA", "critiqueOfB", "synthesizer"];

/** Replays five recorded completions in seat order. A sixth call is an error. */
export class FixturePlayer implements ModelProvider {
  readonly mode = "fixture" as const;
  private index = 0;

  constructor(private readonly script: readonly string[]) {
    if (script.length !== ROLES.length) throw new Error(`fixture-script-length:${script.length}`);
  }

  async complete(request: CompletionRequest): Promise<Completion> {
    const expected = ROLES[this.index];
    if (!expected) throw new Error("fixture-extra-call");
    if (request.role !== expected) throw new Error(`fixture-role:${request.role}`);
    const body = this.script[this.index];
    if (body === undefined) throw new Error("fixture-extra-call");
    this.index += 1;
    return { text: body };
  }
}

/** A live seat with no model behind it. ClaudeModel is the configured one. */
export class UnconfiguredModel implements ModelProvider {
  readonly mode = "live" as const;

  async complete(_request: CompletionRequest): Promise<Completion> {
    throw new Error("model-not-configured");
  }
}

/**
 * Replays the seats a failed live run already paid for, then hands the rest to the live provider.
 * A saved answer is only replayed for the same prompt; a changed brief or upstream answer is refused.
 */
export class ResumingProvider implements ModelProvider {
  readonly mode = "live" as const;

  constructor(
    private readonly saved: readonly SeatAnswer[],
    private readonly live: ModelProvider,
  ) {}

  async complete(request: CompletionRequest): Promise<Completion> {
    const answer = this.saved.find((item) => item.role === request.role);
    if (!answer) return this.live.complete(request);
    if (answer.prompt !== request.prompt) throw new Error(`resume-prompt-changed:${request.role}`);
    return { text: answer.text, model: answer.model, usage: answer.usage, resumed: true };
  }
}

export function recordedLines<T>(panel: ReviewPanel<T>): string[] {
  return [
    JSON.stringify(panel.proposalA),
    JSON.stringify(panel.proposalB),
    JSON.stringify(panel.critiqueOfA),
    JSON.stringify(panel.critiqueOfB),
    JSON.stringify({ synthesis: panel.synthesis, rationale: panel.rationale }),
  ];
}

/**
 * Asks the provider for the five seats. Analysts receive the brief only.
 * Each critique receives the one proposal it judges. The synthesizer receives both.
 */
export async function playPanel<T>(
  provider: ModelProvider,
  stage: PanelStage,
  brief: string,
): Promise<{ panel: ReviewPanel<T>; calls: PanelCall[]; metrics: CallMetric[] }> {
  const calls: PanelCall[] = [];
  const metrics: CallMetric[] = [];
  const answers: SeatAnswer[] = [];
  const ask = async (role: PanelRole, prompt: string): Promise<string> => {
    calls.push({ role, prompt });
    const started = performance.now();
    const live = provider.mode === "live";
    const measure = (model: string | undefined, usage: TokenUsage | undefined, reported?: number, resumed = false): CallMetric => ({
      role,
      source: resumed ? "resumed" : live ? "live" : "recorded",
      model: model ?? null,
      durationMs: performance.now() - started,
      usage: usage ?? null,
      costUsd: !live || resumed ? 0 : (reported ?? (model && usage ? callCost(model, usage) : null)),
    });
    let answer: Completion;
    try {
      answer = await provider.complete({ role, prompt });
    } catch (error) {
      if (error instanceof CompletionError) metrics.push(measure(error.model, error.usage, error.costUsd));
      throw new PanelCallError(role, metrics, answers, error);
    }
    metrics.push(measure(answer.model, answer.usage, answer.costUsd, answer.resumed));
    answers.push({ role, prompt, text: answer.text, model: answer.model, usage: answer.usage });
    return answer.text;
  };
  const proposalA = JSON.parse(await ask("analystA", buildSeatPrompt("analystA", brief))) as T;
  const proposalB = JSON.parse(await ask("analystB", buildSeatPrompt("analystB", brief))) as T;
  const critiqueOfA = JSON.parse(await ask("critiqueOfA", buildSeatPrompt("critiqueOfA", brief, { proposalA }))) as PanelCritique;
  const critiqueOfB = JSON.parse(await ask("critiqueOfB", buildSeatPrompt("critiqueOfB", brief, { proposalB }))) as PanelCritique;
  const wrapped = JSON.parse(
    await ask(
      "synthesizer",
      buildSeatPrompt("synthesizer", brief, {
        proposalA,
        proposalB,
        critiqueOfA,
        critiqueOfB,
      }),
    ),
  ) as { synthesis: T; rationale: SynthesisRationale };
  return {
    calls,
    metrics,
    panel: {
      stage,
      proposalA,
      proposalB,
      critiqueOfA,
      critiqueOfB,
      synthesis: wrapped.synthesis,
      rationale: wrapped.rationale,
    },
  };
}
