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
/** Model A's fix of what the final check raised: the corrected document, and what it did with each finding. */
const Fix = z.object({
  document: z.string(),
  resolutions: z.array(z.object({ finding: z.string(), outcome: z.enum(["fixed", "rejected"]), note: z.string() })),
});
const Merge = z.object({
  document: z.string(),
  keptFromA: z.string(),
  keptFromB: z.string(),
  resolutions: z.array(z.object({ finding: z.string(), outcome: z.enum(["fixed", "rejected"]), note: z.string() })),
});

export type ReviewAnswer = z.infer<typeof Review>;
export type MergeAnswer = z.infer<typeof Merge>;
export type FixAnswer = z.infer<typeof Fix>;

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
  /** The final check: Model B reviews the merged document once more, and Model A fixes what it raised. */
  finalReview: Review.optional(),
  finalFix: Fix.optional(),
  /** When the final check ran, which can be later than the rest of the panel. */
  finalCheckedAt: z.string().optional(),
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
    spec.kind === "build" && spec.questions
      ? `Questions asked and the requester's answers:\n${spec.questions}\n${spec.answers ?? ""}`
      : spec.sources
        ? `Facts to rely on:\n${spec.sources}`
        : "No further facts were given; state any assumption you make.",
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
  "Report at most four findings. If there is no real defect, return no findings: never invent one. Name one strength in a sentence. " +
  "Severity is strict: any wrong figure, date, threshold or rule is P0, however small it looks.";

const MERGE_INSTRUCTIONS =
  "Merge the two drafts into the final deliverable. Resolve every finding from both reviews: fix it, or reject it with a reason if the review is wrong. " +
  "Keep the same form as the drafts and the same length limit. Say in a sentence each what you kept from draft A and from draft B, and give one resolution per finding.";

const FIX_INSTRUCTIONS =
  "The message holds the final document and an independent review of it. Fix every finding that is real, and reject any that is wrong with a reason. " +
  "Change nothing else, and keep the same form and length limit. Give one resolution per finding.";

function seat(instructions: string, schema: z.ZodType<unknown>): SeatSpec {
  return { instructions, schema };
}

export interface Panel {
  claude: ModelProvider;
  grok: ModelProvider;
  /** Model A fixing what the final check raised. Without it, the panel stops at the merge. */
  fixer?: ModelProvider;
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
    fixer: new ClaudeModel(context, { synthesizer: seat(FIX_INSTRUCTIONS, Fix) }),
  };
}

type Prefix = "D-A" | "D-B" | "D-F";

/** One review as the page shows it: "D-A1 · P0 · Title" then the detail, and the strength. */
export function renderReview(review: ReviewAnswer, prefix: Prefix): string {
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

/** The final check's fix as the page shows it, ending in the resolved count. */
export function renderFix(fix: FixAnswer, total: number): string {
  const fixed = fix.resolutions.filter((item) => item.outcome === "fixed").length;
  return [
    ...fix.resolutions.map((item) => `${item.outcome === "fixed" ? "Fixed" : "Rejected"} ${item.finding}: ${item.note}`),
    `Final-check findings resolved: ${fixed} of ${total}.`,
  ].join("\n");
}

/** Renumbers a review's findings so ids match what the page shows, whatever the model called them. */
function renumber(review: ReviewAnswer, prefix: Prefix): ReviewAnswer {
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

/** Called as each of the panel's calls finishes, so a live page can show progress. */
export type PanelProgress = (event: { role: string; call: RecordedCall; text: string }) => void;

/** One timed call that reports its progress. `as` names the call in the record when a seat is reused, like the final check. */
function stepper(onProgress: PanelProgress) {
  return async (provider: ModelProvider, role: Parameters<ModelProvider["complete"]>[0]["role"], prompt: string, show: (json: unknown) => string, as: string = role) => {
    const result = await timed(provider, role, prompt);
    const call = { ...result.call, role: as };
    onProgress({ role: as, call, text: show(result.json) });
    return { ...result, call };
  };
}

/**
 * Runs one workflow's panel for real: drafts in parallel, crossed reviews in parallel, the merge, then the final
 * check (Model B reviews the merged document; Model A fixes what it raised, if anything).
 */
export async function recordPanel(spec: WorkflowSpec, panel: Panel, now = () => new Date(), onProgress: PanelProgress = () => {}): Promise<Recording> {
  const step = stepper(onProgress);
  const draftText = (json: unknown) => Draft.parse(json).text;
  const reviewText = (prefix: Prefix) => (json: unknown) => renderReview(renumber(Review.parse(json), prefix), prefix);
  const [a, b] = await Promise.all([step(panel.claude, "analystA", "Write your draft.", draftText), step(panel.grok, "analystB", "Write your draft.", draftText)]);
  const draftA = Draft.parse(a.json).text;
  const draftB = Draft.parse(b.json).text;
  const [ofB, ofA] = await Promise.all([
    step(panel.claude, "critiqueOfB", `Review this draft. Number findings D-B1, D-B2, ...\n\n${draftB}`, reviewText("D-B")),
    step(panel.grok, "critiqueOfA", `Review this draft. Number findings D-A1, D-A2, ...\n\n${draftA}`, reviewText("D-A")),
  ]);
  const reviewOfA = renumber(Review.parse(ofA.json), "D-A");
  const reviewOfB = renumber(Review.parse(ofB.json), "D-B");
  const merged = await step(
    panel.claude,
    "synthesizer",
    `Draft A:\n${draftA}\n\nDraft B:\n${draftB}\n\nReview of draft A:\n${renderReview(reviewOfA, "D-A")}\n\nReview of draft B:\n${renderReview(reviewOfB, "D-B")}`,
    (json) => Merge.parse(json).document,
  );
  const merge = Merge.parse(merged.json);
  const recording = RecordingSchema.parse({
    id: spec.id,
    recordedAt: now().toISOString(),
    calls: [a.call, b.call, ofB.call, ofA.call, merged.call],
    draftA,
    draftB,
    reviewOfA,
    reviewOfB,
    merge,
  });
  return panel.fixer ? finalCheck(recording, { grok: panel.grok, fixer: panel.fixer }, onProgress) : recording;
}

/**
 * The final check on a recorded panel: Model B reviews the merged document once more, under the same strict
 * severity rule, and Model A fixes what it raised, if anything. Adds to the recording; changes nothing in it.
 */
export async function finalCheck(
  recording: Recording,
  panel: { grok: ModelProvider; fixer: ModelProvider },
  onProgress: PanelProgress = () => {},
  now = () => new Date(),
): Promise<Recording> {
  const step = stepper(onProgress);
  const document = recording.merge.document;
  const checked = await step(panel.grok, "critiqueOfA", `Review this final document. Number findings D-F1, D-F2, ...\n\n${document}`, (json) => renderReview(renumber(Review.parse(json), "D-F"), "D-F"), "finalReview");
  const finalReview = renumber(Review.parse(checked.json), "D-F");
  const calls = [...recording.calls.filter((call) => call.role !== "finalReview" && call.role !== "finalFix"), checked.call];
  const { finalFix: _stale, ...previous } = recording;
  const rest = { ...previous, finalCheckedAt: now().toISOString() };
  if (!finalReview.findings.length) return RecordingSchema.parse({ ...rest, calls, finalReview });
  const fixed = await step(
    panel.fixer,
    "synthesizer",
    `Final document:\n${document}\n\nIndependent review of it:\n${renderReview(finalReview, "D-F")}`,
    (json) => Fix.parse(json).document,
    "finalFix",
  );
  return RecordingSchema.parse({ ...rest, calls: [...calls, fixed.call], finalReview, finalFix: Fix.parse(fixed.json) });
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
