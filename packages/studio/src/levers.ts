import { ClaudeModel, GrokModel, type ModelProvider, type SeatSpec, callCost } from "@northwind/orchestrator";
import * as z from "zod/v4";
import { JUDGE_INSTRUCTIONS, type JudgeVerdict, MERGE_INSTRUCTIONS, Merge, Verdict, judgeVersions } from "./gated.ts";
import { Draft, REVIEW_INSTRUCTIONS, type Recording, Review, draftInstructions, panelContext, renderReview } from "./record.ts";
import type { WorkflowSpec } from "./workflows.ts";

/**
 * The next cost and time levers, measured on the recorded panels: other models for the merge, a merge that
 * edits draft A instead of rewriting, and a faster Model B. Each candidate reuses the recorded inputs and is
 * judged blind by both models against what the recorded panel produced.
 */

export const MERGE_VARIANTS = [
  { id: "opus-5-5", model: "claude-opus-5-5", mode: "rewrite" },
  { id: "sonnet-5-5", model: "claude-sonnet-5-5", mode: "rewrite" },
  { id: "haiku-5-5", model: "claude-haiku-5-5", mode: "rewrite" },
  { id: "opus-5-edit", model: "claude-opus-5", mode: "edit" },
] as const;

export const FAST_B = "grok-4.20-0309-non-reasoning";

const EDIT_INSTRUCTIONS =
  "Revise draft A into the final deliverable. Apply every finding from both reviews (fix it, or reject it with a reason), and take anything from draft B that is clearly better. " +
  "Change nothing else, and keep the same form and length. Say in a sentence each what you kept from draft A and from draft B, and give one resolution per finding.";

const ReviewCompare = z.object({
  realInReview1: z.number(),
  falseInReview1: z.number(),
  realInReview2: z.number(),
  falseInReview2: z.number(),
  preferred: z.enum(["1", "2", "equal"]),
  reason: z.string(),
});
const DraftCompare = z.object({ preferred: z.enum(["1", "2", "equal"]), reason: z.string() });

const REVIEW_JUDGE =
  "You are a blind judge comparing two reviews of the same draft. Recompute the figures yourself. Count, for each review, the findings that are real problems and the findings that are wrong or invented. " +
  "Then say which review is more useful to the author, or equal, in one sentence.";
const DRAFT_JUDGE = "You are a blind judge comparing two drafts written from the same brief and facts. Say which better meets the brief and the facts, or equal, in one sentence.";

type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
const NONE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

async function timed(provider: ModelProvider, role: Parameters<ModelProvider["complete"]>[0]["role"], prompt: string, model: string) {
  const started = Date.now();
  const answer = await provider.complete({ role, prompt });
  const usage = answer.usage ?? NONE;
  return {
    json: JSON.parse(answer.text) as unknown,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    costUsd: answer.costUsd ?? callCost(model, usage) ?? 0,
    outputTokens: usage.outputTokens,
    model: answer.model ?? model,
  };
}

const flip = (id: string) => ([...id].reduce((total, char) => total + char.charCodeAt(0), 0) % 2 === 0 ? "1" : "2") as "1" | "2";

export interface LeverResult {
  id: string;
  baseline: { mergeSeconds: number; mergeCostUsd: number; draftBSeconds: number; draftBCostUsd: number; reviewASeconds: number; reviewACostUsd: number };
  failures: Array<{ variant: string; error: string }>;
  merges: Array<{
    variant: string;
    model: string;
    mode: string;
    seconds: number;
    costUsd: number;
    outputTokens: number;
    document: string;
    judges: { claude: JudgeVerdict & { costUsd: number }; grok: JudgeVerdict & { costUsd: number }; fullIsVersion: "1" | "2" };
  }>;
  fastB: {
    model: string;
    draft: { seconds: number; costUsd: number; text: string; verdicts: Array<{ judge: string; preferred: string; reason: string; costUsd: number }>; baselineIs: "1" | "2" };
    review: { seconds: number; costUsd: number; text: string; verdicts: Array<{ judge: string; preferred: string; realBaseline: number; falseBaseline: number; realFast: number; falseFast: number; reason: string; costUsd: number }>; baselineIs: "1" | "2" };
  };
}

export interface LeverProviders {
  merger: (variant: (typeof MERGE_VARIANTS)[number]) => ModelProvider;
  fastB: ModelProvider;
  judges: { claude: ModelProvider; grok: ModelProvider };
  reviewJudges: { claude: ModelProvider; grok: ModelProvider };
  draftJudges: { claude: ModelProvider; grok: ModelProvider };
}

export function liveLeverProviders(spec: WorkflowSpec, domain: string): LeverProviders {
  const context = panelContext(spec, domain);
  const seat = (instructions: string, schema: z.ZodType<unknown>): SeatSpec => ({ instructions, schema });
  const all = (s: SeatSpec) => ({ analystA: s, analystB: s, critiqueOfA: s, critiqueOfB: s, synthesizer: s });
  const pair = (instructions: string, schema: z.ZodType<unknown>) => ({
    claude: new ClaudeModel(context, all(seat(instructions, schema))),
    grok: new GrokModel(context, { synthesizer: seat(instructions, schema) }),
  });
  return {
    merger: (variant) => new ClaudeModel(context, all(seat(variant.mode === "edit" ? EDIT_INSTRUCTIONS : MERGE_INSTRUCTIONS, Merge)), { model: variant.model }),
    fastB: new GrokModel(context, { analystB: seat(draftInstructions(spec), Draft), critiqueOfA: seat(REVIEW_INSTRUCTIONS, Review) }, { model: FAST_B }),
    judges: pair(JUDGE_INSTRUCTIONS, Verdict),
    reviewJudges: pair(REVIEW_JUDGE, ReviewCompare),
    draftJudges: pair(DRAFT_JUDGE, DraftCompare),
  };
}

/** Runs every lever for one recorded workflow. */
export async function runLevers(spec: WorkflowSpec, recording: Recording, providers: LeverProviders): Promise<LeverResult> {
  const call = (role: string) => recording.calls.find((item) => item.role === role)!;
  const mergePrompt = `Draft A:\n${recording.draftA}\n\nDraft B:\n${recording.draftB}\n\nReview of draft A:\n${renderReview(recording.reviewOfA, "D-A")}\n\nReview of draft B:\n${renderReview(recording.reviewOfB, "D-B")}`;

  // One candidate failing (a refusal, a truncated answer) is recorded as a failure, not lost with the others.
  const settled = await Promise.allSettled(
    MERGE_VARIANTS.map(async (variant) => {
      const result = await timed(providers.merger(variant), "synthesizer", mergePrompt, variant.model);
      const document = Merge.parse(result.json).document;
      const judges = await judgeVersions(spec.id, recording, recording.merge.document, document, providers.judges);
      return { variant: variant.id, model: result.model, mode: variant.mode, seconds: result.seconds, costUsd: result.costUsd, outputTokens: result.outputTokens, document, judges };
    }),
  );
  const merges = settled.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value] : []));
  const failures = settled.flatMap((outcome, index) => (outcome.status === "rejected" ? [{ variant: MERGE_VARIANTS[index]!.id, error: String(outcome.reason).slice(0, 200) }] : []));

  const [draft, review] = await Promise.all([
    timed(providers.fastB, "analystB", "Write your draft.", FAST_B),
    timed(providers.fastB, "critiqueOfA", `Review this draft. Number findings D-A1, D-A2, ...\n\n${recording.draftA}`, FAST_B),
  ]);
  const fastDraft = Draft.parse(draft.json).text;
  const fastReview = renderReview(Review.parse(review.json), "D-A");
  const baselineIs = flip(spec.id);
  const order = <T,>(baseline: T, fast: T): [T, T] => (baselineIs === "1" ? [baseline, fast] : [fast, baseline]);

  const [d1, d2] = order(recording.draftB, fastDraft);
  const [r1, r2] = order(renderReview(recording.reviewOfA, "D-A"), fastReview);
  const ask = async <T,>(provider: ModelProvider, prompt: string, schema: z.ZodType<T>) => {
    const answer = await provider.complete({ role: "synthesizer", prompt });
    return { ...schema.parse(JSON.parse(answer.text)), costUsd: answer.costUsd ?? callCost(answer.model ?? "", answer.usage ?? NONE) ?? 0 };
  };
  const draftVerdicts = await Promise.all(
    (["claude", "grok"] as const).map(async (judge) => ({ judge, ...(await ask(providers.draftJudges[judge], `Draft 1:\n${d1}\n\nDraft 2:\n${d2}`, DraftCompare)) })),
  );
  const reviewVerdicts = await Promise.all(
    (["claude", "grok"] as const).map(async (judge) => {
      const verdict = await ask(providers.reviewJudges[judge], `The draft:\n${recording.draftA}\n\nReview 1:\n${r1}\n\nReview 2:\n${r2}`, ReviewCompare);
      const base = baselineIs === "1" ? [verdict.realInReview1, verdict.falseInReview1] : [verdict.realInReview2, verdict.falseInReview2];
      const fast = baselineIs === "1" ? [verdict.realInReview2, verdict.falseInReview2] : [verdict.realInReview1, verdict.falseInReview1];
      return { judge, preferred: verdict.preferred, realBaseline: base[0]!, falseBaseline: base[1]!, realFast: fast[0]!, falseFast: fast[1]!, reason: verdict.reason, costUsd: verdict.costUsd };
    }),
  );

  return {
    id: spec.id,
    baseline: {
      mergeSeconds: call("synthesizer").seconds,
      mergeCostUsd: call("synthesizer").costUsd,
      draftBSeconds: call("analystB").seconds,
      draftBCostUsd: call("analystB").costUsd,
      reviewASeconds: call("critiqueOfA").seconds,
      reviewACostUsd: call("critiqueOfA").costUsd,
    },
    merges,
    failures,
    fastB: {
      model: FAST_B,
      draft: { seconds: draft.seconds, costUsd: draft.costUsd, text: fastDraft, verdicts: draftVerdicts, baselineIs },
      review: { seconds: review.seconds, costUsd: review.costUsd, text: fastReview, verdicts: reviewVerdicts, baselineIs },
    },
  };
}
