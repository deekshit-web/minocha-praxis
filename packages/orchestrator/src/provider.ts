import type { PanelCritique, PanelRole, PanelStage, ReviewPanel, SynthesisRationale } from "./panel.ts";
import { buildSeatPrompt, type PanelCall } from "./panel.ts";

export interface CompletionRequest {
  role: PanelRole;
  prompt: string;
}

/** Fixture player first. A live model is a second implementation of the same call. */
export interface ModelProvider {
  readonly mode: "fixture" | "live";
  complete(request: CompletionRequest): string;
}

const ROLES: readonly PanelRole[] = ["analystA", "analystB", "critiqueOfA", "critiqueOfB", "synthesizer"];

/** Replays five recorded completions in seat order. A sixth call is an error. */
export class FixturePlayer implements ModelProvider {
  readonly mode = "fixture" as const;
  private index = 0;

  constructor(private readonly script: readonly string[]) {
    if (script.length !== ROLES.length) throw new Error(`fixture-script-length:${script.length}`);
  }

  complete(request: CompletionRequest): string {
    const expected = ROLES[this.index];
    if (!expected) throw new Error("fixture-extra-call");
    if (request.role !== expected) throw new Error(`fixture-role:${request.role}`);
    const body = this.script[this.index];
    if (body === undefined) throw new Error("fixture-extra-call");
    this.index += 1;
    return body;
  }
}

/** The live seat exists so a later model plugs in here. This demo does not call one. */
export class UnconfiguredModel implements ModelProvider {
  readonly mode = "live" as const;

  complete(): string {
    throw new Error("model-not-configured");
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
export function playPanel<T>(provider: ModelProvider, stage: PanelStage, brief: string): { panel: ReviewPanel<T>; calls: PanelCall[] } {
  const calls: PanelCall[] = [];
  const ask = (role: PanelRole, prompt: string): string => {
    calls.push({ role, prompt });
    return provider.complete({ role, prompt });
  };
  const proposalA = JSON.parse(ask("analystA", buildSeatPrompt("analystA", brief))) as T;
  const proposalB = JSON.parse(ask("analystB", buildSeatPrompt("analystB", brief))) as T;
  const critiqueOfA = JSON.parse(ask("critiqueOfA", buildSeatPrompt("critiqueOfA", brief, { proposalA }))) as PanelCritique;
  const critiqueOfB = JSON.parse(ask("critiqueOfB", buildSeatPrompt("critiqueOfB", brief, { proposalB }))) as PanelCritique;
  const wrapped = JSON.parse(
    ask(
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
