import { ClaudeModel, GrokModel, type ModelProvider, type SeatSpec, callCost } from "@northwind/orchestrator";
import * as z from "zod/v4";
import type { DecisionAnswer } from "./workflows.ts";
import { type JevQuestion, askJev } from "./jev.ts";
import { type Recording, type ReviewAnswer, panelContext, renderReview } from "./record.ts";
import type { WorkflowSpec } from "./workflows.ts";

/**
 * The Jev-gated pipeline: the same panel, with Model C making the routine calls. Steps both pipelines share
 * (the drafts, Model A's review of draft B, and Model B's review when it is kept) are reused from the
 * recording, so any difference in the outcome comes from the gates, not from a model rewording a rerun.
 *
 * Gates, each taken only when Model C is at least 70% sure; otherwise the full path runs:
 * - Skip Model B's review of draft A on medium-risk work if Model C judges draft A complete.
 * - Skip the merge if no finding must be fixed, shipping the better draft instead.
 * - Hand a simple merge (additions and clarifications only) to the cheaper model.
 */

const SURE = 0.7;
const JEV_PRICE_PER_TOKEN = 0.042 / 1_000_000;

const Merge = z.object({
  document: z.string(),
  keptFromA: z.string(),
  keptFromB: z.string(),
  resolutions: z.array(z.object({ finding: z.string(), outcome: z.enum(["fixed", "rejected"]), note: z.string() })),
});

const Verdict = z.object({
  findings: z.array(z.object({ id: z.string(), version1: z.enum(["addressed", "not addressed"]), version2: z.enum(["addressed", "not addressed"]) })),
  errorsInVersion1: z.array(z.string()),
  errorsInVersion2: z.array(z.string()),
  preferred: z.enum(["1", "2", "equal"]),
  reason: z.string(),
});
export type JudgeVerdict = z.infer<typeof Verdict>;

type Ask = (state: string, questions: Record<string, JevQuestion>) => ReturnType<typeof askJev>;

export interface GatedProviders {
  ask: Ask;
  /** The cheaper model, for simple merges. */
  cheapMerger: ModelProvider;
  judges: { claude: ModelProvider; grok: ModelProvider };
}

export interface GatedDecision {
  gate: string;
  question: string;
  answer: string;
  confidence: number;
  ms: number;
  costUsd: number;
}

export interface GatedResult {
  id: string;
  risk: "low" | "medium" | "high";
  skippedReviewOfA: boolean;
  mergePath: "pick-A" | "pick-B" | "cheap-merge" | "full-merge";
  decisions: GatedDecision[];
  full: { costUsd: number; seconds: number; findings: number; final: string };
  gated: { costUsd: number; seconds: number; findings: number; final: string; newCalls: Array<{ role: string; model: string; seconds: number; costUsd: number }> };
  /** Blind verdicts from both judges, or null when the gated pipeline produced the identical final version. */
  judges: { claude: JudgeVerdict & { costUsd: number }; grok: JudgeVerdict & { costUsd: number }; fullIsVersion: "1" | "2" } | null;
}

function sure(answer: DecisionAnswer | undefined): { yes: boolean; confidence: number } {
  if (answer?.type !== "noul") return { yes: false, confidence: 0 };
  return { yes: answer.noul >= 0.5, confidence: answer.noul >= 0.5 ? answer.noul : 1 - answer.noul };
}

function call(recording: Recording, role: string) {
  const found = recording.calls.find((item) => item.role === role);
  if (!found) throw new Error(`recording ${recording.id} has no ${role}`);
  return found;
}

/** Runs the gated pipeline for one workflow on top of its recording. */
export async function runGated(
  spec: WorkflowSpec,
  recording: Recording,
  risk: "low" | "medium" | "high",
  domain: string,
  providers: GatedProviders,
): Promise<GatedResult> {
  const decisions: GatedDecision[] = [];
  const decide = async (gate: string, state: string, questions: Record<string, JevQuestion>) => {
    const answer = await providers.ask(state, questions);
    const costUsd = answer.inputTokens * JEV_PRICE_PER_TOKEN;
    for (const [key, question] of Object.entries(questions)) {
      const value = answer.answers[key];
      const text = value?.type === "choice" ? value.choice : value && value.type === "noul" ? (value.noul >= 0.5 ? "yes" : "no") : "?";
      const confidence = value?.type === "choice" ? (value.probabilities[value.choice] ?? 0) : sure(value).confidence;
      decisions.push({ gate, question: question.instructions, answer: text, confidence, ms: answer.ms, costUsd: costUsd / Object.keys(questions).length });
    }
    return answer.answers;
  };

  // Gate 1: is Model B's review of draft A needed? Only medium-risk work may skip it.
  let skippedReviewOfA = false;
  if (risk === "medium") {
    const answers = await decide("skip-review", `Brief: ${spec.brief}\n\nDraft A:\n${recording.draftA}`, {
      complete: { type: "noul", instructions: "Does draft A fully and correctly meet the brief, with no wrong figure, no broken rule and nothing important missing?" },
    });
    const verdict = sure(answers.complete);
    skippedReviewOfA = verdict.yes && verdict.confidence >= SURE;
  }
  const reviewOfA: ReviewAnswer = skippedReviewOfA ? { findings: [], strengths: "" } : recording.reviewOfA;
  const findings = [...reviewOfA.findings, ...recording.reviewOfB.findings];
  const rendered = `Review of draft A:\n${skippedReviewOfA ? "(skipped)" : renderReview(reviewOfA, "D-A")}\n\nReview of draft B:\n${renderReview(recording.reviewOfB, "D-B")}`;

  // Gate 2: must anything be fixed? If not, ship the better draft and skip the merge.
  let mergePath: GatedResult["mergePath"] = "full-merge";
  let final = recording.merge.document;
  const newCalls: GatedResult["gated"]["newCalls"] = [];
  const mustFix = findings.length
    ? sure(
        (
          await decide("skip-merge", rendered, {
            mustFix: { type: "noul", instructions: "Reviewers rate findings P0 (blocking), P1 (should be fixed before approval) or P2 (optional). Does any finding here have to be fixed before this is approved?" },
          })
        ).mustFix,
      )
    : { yes: false, confidence: 1 };
  if (!mustFix.yes && mustFix.confidence >= SURE) {
    const answers = await decide("pick-draft", `Brief: ${spec.brief}\n\nDraft A:\n${recording.draftA}\n\nDraft B:\n${recording.draftB}`, {
      better: { type: "choice", instructions: "Which draft better meets the brief and the facts?", criteria: { A: "Draft A is better.", B: "Draft B is better." } },
    });
    const pick = answers.better?.type === "choice" ? answers.better.choice : "A";
    mergePath = pick === "B" ? "pick-B" : "pick-A";
    final = pick === "B" ? recording.draftB : recording.draftA;
  } else {
    // Gate 3: is the merge simple enough for the cheaper model?
    const simple = sure(
      (
        await decide("cheap-merge", rendered, {
          simple: { type: "noul", instructions: "Can every finding here be resolved by adding or clarifying text, without changing a figure, a rule, a date or the decision itself?" },
        })
      ).simple,
    );
    if (simple.yes && simple.confidence >= SURE) {
      mergePath = "cheap-merge";
      const started = Date.now();
      const answer = await providers.cheapMerger.complete({
        role: "synthesizer",
        prompt: `Draft A:\n${recording.draftA}\n\nDraft B:\n${recording.draftB}\n\n${rendered}`,
      });
      const usage = answer.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      final = Merge.parse(JSON.parse(answer.text)).document;
      newCalls.push({ role: "cheap-merge", model: answer.model ?? "", seconds: (Date.now() - started) / 1000, costUsd: answer.costUsd ?? callCost(answer.model ?? "grok-4.7", usage) ?? 0 });
    }
  }

  const dA = call(recording, "analystA");
  const dB = call(recording, "analystB");
  const rB = call(recording, "critiqueOfB");
  const rA = call(recording, "critiqueOfA");
  const merge = call(recording, "synthesizer");
  const jevCost = decisions.reduce((total, item) => total + item.costUsd, 0);
  const jevSeconds = [...new Set(decisions.map((item) => `${item.gate}:${item.ms}`))].reduce((total, key) => total + Number(key.split(":")[1]) / 1000, 0);
  const gatedCost =
    dA.costUsd + dB.costUsd + rB.costUsd + (skippedReviewOfA ? 0 : rA.costUsd) + (mergePath === "full-merge" ? merge.costUsd : 0) + newCalls.reduce((total, item) => total + item.costUsd, 0) + jevCost;
  const gatedSeconds =
    Math.max(dA.seconds, dB.seconds) +
    Math.max(rB.seconds, skippedReviewOfA ? 0 : rA.seconds) +
    jevSeconds +
    (mergePath === "full-merge" ? merge.seconds : 0) +
    newCalls.reduce((total, item) => total + item.seconds, 0);

  const full = {
    costUsd: recording.calls.reduce((total, item) => total + item.costUsd, 0),
    seconds: Math.max(dA.seconds, dB.seconds) + Math.max(rB.seconds, rA.seconds) + merge.seconds,
    findings: recording.reviewOfA.findings.length + recording.reviewOfB.findings.length,
    final: recording.merge.document,
  };

  // Judge both final versions blind, against every finding either review raised, unless they are identical.
  let judges: GatedResult["judges"] = null;
  if (final.trim() !== full.final.trim()) {
    const fullIsVersion: "1" | "2" = [...spec.id].reduce((total, char) => total + char.charCodeAt(0), 0) % 2 === 0 ? "1" : "2";
    const [v1, v2] = fullIsVersion === "1" ? [full.final, final] : [final, full.final];
    const allFindings = `${renderReview(recording.reviewOfA, "D-A")}\n${renderReview(recording.reviewOfB, "D-B")}`;
    const prompt = `Known review findings:\n${allFindings}\n\nVersion 1:\n${v1}\n\nVersion 2:\n${v2}`;
    const judge = async (provider: ModelProvider) => {
      const answer = await provider.complete({ role: "synthesizer", prompt });
      const usage = answer.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      return { ...Verdict.parse(JSON.parse(answer.text)), costUsd: answer.costUsd ?? callCost(answer.model ?? "", usage) ?? 0 };
    };
    const [claude, grok] = await Promise.all([judge(providers.judges.claude), judge(providers.judges.grok)]);
    judges = { claude, grok, fullIsVersion };
  }
  void domain;
  return {
    id: spec.id,
    risk,
    skippedReviewOfA,
    mergePath,
    decisions,
    full,
    gated: { costUsd: gatedCost, seconds: gatedSeconds, findings: findings.length, final, newCalls },
    judges,
  };
}

const JUDGE_INSTRUCTIONS =
  "You are a blind judge comparing two final versions of the same deliverable, written from the same brief and facts. " +
  "For every known review finding, say whether each version addresses it. List any errors either version contains: wrong figures, broken rules or policies, or missing required content. " +
  "Then say which version is better overall for the requester, or equal, in one sentence.";

const MERGE_INSTRUCTIONS =
  "Merge the two drafts into the final deliverable. Resolve every finding from the reviews: fix it, or reject it with a reason. " +
  "Keep the same form and length as the drafts. Say in a sentence each what you kept from draft A and from draft B, and give one resolution per finding.";

/** The live providers: Grok as the cheap merger, and Claude and Grok as blind judges. */
export function liveGatedProviders(spec: WorkflowSpec, domain: string): GatedProviders {
  const context = panelContext(spec, domain);
  const merge: SeatSpec = { instructions: MERGE_INSTRUCTIONS, schema: Merge };
  const judge: SeatSpec = { instructions: JUDGE_INSTRUCTIONS, schema: Verdict };
  const all = (seat: SeatSpec) => ({ analystA: seat, analystB: seat, critiqueOfA: seat, critiqueOfB: seat, synthesizer: seat });
  return {
    ask: (state, questions) => askJev(state, questions),
    cheapMerger: new GrokModel(context, { synthesizer: merge }),
    judges: { claude: new ClaudeModel(context, all(judge)), grok: new GrokModel(context, { synthesizer: judge }) },
  };
}
