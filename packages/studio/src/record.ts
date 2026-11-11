import { CLAUDE_MODEL, ClaudeModel, GROK_MODEL, GrokModel, type ModelProvider, type SeatSpec, callCost, repoRoot } from "@northwind/orchestrator";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod/v4";
import type { WorkflowSpec } from "./workflows.ts";

/**
 * Real runs of each workflow's cross-review panel: two drafts written apart, each model reviewing the other's,
 * and a merge. Nothing is planted; the models get the brief and its facts, and what they catch is what they
 * caught. The page replays these recordings in place of the prepared panel.
 */

export const Draft = z.object({ text: z.string() });
const Finding = z.object({
  id: z.string(),
  severity: z.enum(["P0", "P1", "P2"]),
  title: z.string(),
  detail: z.string(),
  quote: z.string(),
});
export const Review = z.object({ findings: z.array(Finding), strengths: z.string() });
const Merge = z.object({
  document: z.string(),
  keptFromA: z.string(),
  keptFromB: z.string(),
  resolutions: z.array(z.object({ finding: z.string(), outcome: z.enum(["fixed", "rejected"]), note: z.string() })),
});

export type ReviewAnswer = z.infer<typeof Review>;
export type MergeAnswer = z.infer<typeof Merge>;

const Call = z.object({
  role: z.string(),
  model: z.string(),
  seconds: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
});

export const RecordingSchema = z.object({
  id: z.string(),
  recordedAt: z.string(),
  calls: z.array(Call),
  draftA: z.string(),
  draftB: z.string(),
  reviewOfA: Review,
  reviewOfB: Review,
  merge: Merge,
});
export type Recording = z.infer<typeof RecordingSchema>;
export type RecordedCall = z.infer<typeof Call>;

/** Everything both models know: the request and its facts, never the prepared drafts or reviews. */
export function panelContext(spec: WorkflowSpec, domain: string): string {
  return [
    "You are one of two independent AI models on a review panel. Work only from the facts below.",
    `Domain: ${domain}. Project: ${spec.project}. Requested by: ${spec.requester}.`,
    `Task: ${spec.title}. ${spec.summary}`,
    `Deliverable: ${spec.deliverable}.`,
    `Brief: ${spec.brief}`,
    spec.kind === "build" ? `Questions asked and the requester's answers:\n${spec.questions}\n${spec.answers}` : `Sources found by the knowledge lookup:\n${spec.sources}`,
    "Rules: use only these facts; check every number, date and rule yourself; be concise; plain text, no markdown.",
  ].join("\n\n");
}

export function draftInstructions(spec: WorkflowSpec): string {
  return spec.kind === "build"
    ? "Write the requirements for this feature as numbered lines: REQ-1, REQ-2, ... for requirements, then AC-1, AC-2, ... for acceptance criteria with concrete worked examples using real numbers or dates from the brief and answers. At most 8 lines in all."
    : `Write the ${spec.deliverable.toLowerCase()} itself, ready to use, from the sources only. At most 220 words.`;
}

export const REVIEW_INSTRUCTIONS =
  "Review the draft for defects against the brief, the facts and the rules. Recompute every number and date yourself. " +
  "Rate each finding P0 (would cause harm, break a rule, policy or law, or state a wrong figure), P1 (should be fixed before approval) or P2 (optional). " +
  "Title each finding in at most six words, explain it in at most 50 words, and quote the exact text at fault from the draft. " +
  "Report at most four findings. If there is no real defect, return no findings: never invent one. Name one strength in a sentence.";

const MERGE_INSTRUCTIONS =
  "Merge the two drafts into the final deliverable. Resolve every finding from both reviews: fix it, or reject it with a reason if the review is wrong. " +
  "Keep the same form as the drafts and the same length limit. Say in a sentence each what you kept from draft A and from draft B, and give one resolution per finding.";

function seat(instructions: string, schema: z.ZodType<unknown>): SeatSpec {
  return { instructions, schema };
}

export interface Panel {
  claude: ModelProvider;
  grok: ModelProvider;
}

/** The two live providers for one workflow, sharing its context. */
export function livePanel(spec: WorkflowSpec, domain: string): Panel {
  const context = panelContext(spec, domain);
  const draft = seat(draftInstructions(spec), Draft);
  const review = seat(REVIEW_INSTRUCTIONS, Review);
  const merge = seat(MERGE_INSTRUCTIONS, Merge);
  return {
    claude: new ClaudeModel(context, { analystA: draft, analystB: draft, critiqueOfA: review, critiqueOfB: review, synthesizer: merge }),
    grok: new GrokModel(context, { analystB: draft, critiqueOfA: review }),
  };
}

/** One review as the page shows it: "D-A1 · P0 · Title" then the detail, and the strength. */
export function renderReview(review: ReviewAnswer, prefix: "D-A" | "D-B"): string {
  const lines = review.findings.map((finding, index) => `${prefix}${index + 1} · ${finding.severity} · ${finding.title}\n  ${finding.detail}`);
  if (!review.findings.length) lines.push("No defects found.");
  if (review.strengths) lines.push(`Strengths: ${review.strengths}`);
  return lines.join("\n");
}

/** The merge as the page shows it, ending in the resolved count the stages read. */
export function renderMerge(merge: MergeAnswer, total: number): string {
  const fixed = merge.resolutions.filter((item) => item.outcome === "fixed").length;
  return [
    `Kept from A: ${merge.keptFromA}`,
    `Kept from B: ${merge.keptFromB}`,
    ...merge.resolutions.map((item) => `${item.outcome === "fixed" ? "Fixed" : "Rejected"} ${item.finding}: ${item.note}`),
    `Defects resolved: ${fixed} of ${total}.`,
  ].join("\n");
}

/** Renumbers a review's findings so ids match what the page shows, whatever the model called them. */
function renumber(review: ReviewAnswer, prefix: "D-A" | "D-B"): ReviewAnswer {
  return { ...review, findings: review.findings.map((finding, index) => ({ ...finding, id: `${prefix}${index + 1}` })) };
}

async function timed(provider: ModelProvider, role: Parameters<ModelProvider["complete"]>[0]["role"], prompt: string) {
  const started = Date.now();
  const answer = await provider.complete({ role, prompt });
  const usage = answer.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const model = answer.model ?? "";
  const call: RecordedCall = {
    role,
    model,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    inputTokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
    outputTokens: usage.outputTokens,
    costUsd: answer.costUsd ?? callCost(model.startsWith("grok") ? GROK_MODEL : CLAUDE_MODEL, usage) ?? 0,
  };
  return { json: JSON.parse(answer.text) as unknown, call };
}

/** Runs one workflow's panel for real: drafts in parallel, crossed reviews in parallel, then the merge. */
export async function recordPanel(spec: WorkflowSpec, panel: Panel, now = () => new Date()): Promise<Recording> {
  const [a, b] = await Promise.all([
    timed(panel.claude, "analystA", "Write your draft."),
    timed(panel.grok, "analystB", "Write your draft."),
  ]);
  const draftA = Draft.parse(a.json).text;
  const draftB = Draft.parse(b.json).text;
  const [ofB, ofA] = await Promise.all([
    timed(panel.claude, "critiqueOfB", `Review this draft. Number findings D-B1, D-B2, ...\n\n${draftB}`),
    timed(panel.grok, "critiqueOfA", `Review this draft. Number findings D-A1, D-A2, ...\n\n${draftA}`),
  ]);
  const reviewOfA = renumber(Review.parse(ofA.json), "D-A");
  const reviewOfB = renumber(Review.parse(ofB.json), "D-B");
  const merged = await timed(
    panel.claude,
    "synthesizer",
    `Draft A:\n${draftA}\n\nDraft B:\n${draftB}\n\nReview of draft A:\n${renderReview(reviewOfA, "D-A")}\n\nReview of draft B:\n${renderReview(reviewOfB, "D-B")}`,
  );
  return RecordingSchema.parse({
    id: spec.id,
    recordedAt: now().toISOString(),
    calls: [a.call, b.call, ofB.call, ofA.call, merged.call],
    draftA,
    draftB,
    reviewOfA,
    reviewOfB,
    merge: Merge.parse(merged.json),
  });
}

const RECORDING_DIR = () => join(repoRoot(), "packages/studio/recordings");

/** The Jev-gated comparison for a workflow, if it has been run (see gated.ts). */
export function gatedFor(id: string, dir = RECORDING_DIR()): unknown | null {
  const path = join(dir, "gated", `${id}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown) : null;
}

/** A workflow's recording, if one has been made. */
export function recordingFor(id: string, dir = RECORDING_DIR()): Recording | null {
  const path = join(dir, `${id}.json`);
  if (!existsSync(path)) return null;
  return RecordingSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
