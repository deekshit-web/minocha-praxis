import { callCost, findPhi, repoRoot } from "@northwind/orchestrator";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod/v4";
import { type Recording, recordingFor, renderMerge, renderReview } from "./record.ts";

/**
 * A simulated workflow. Nothing here calls a model: every output was written in advance, so a demo shows how
 * the workflow behaves without spending a token. Times and costs are estimates of what a live run would take.
 */

export const DOMAINS = [
  { id: "healthcare", name: "Healthcare", blurb: "Revenue cycle: denials, appeals and payer rules." },
  { id: "education", name: "Education", blurb: "Schools: students, teachers, curriculum standards." },
  { id: "fmcg", name: "FMCG", blurb: "Consumer goods: distributors, stock and promotions." },
  { id: "finance", name: "Financial services", blurb: "Lending and onboarding: credit policy and KYC." },
  { id: "logistics", name: "Logistics", blurb: "Shipments: carriers, delays and claims." },
] as const;

export type DomainId = (typeof DOMAINS)[number]["id"];

const Text = z.string().min(1);

/** What an author writes for one workflow. The template turns it into steps, layout and timings. */
const SpecSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  domain: z.enum(DOMAINS.map((domain) => domain.id) as [DomainId, ...DomainId[]]),
  kind: z.enum(["build", "document"]),
  title: Text,
  summary: Text,
  deliverable: Text,
  /** Where the work lands and who asked for it, shown in the run header and log. */
  project: Text,
  requester: Text,
  brief: Text,
  /** Build: the clarifying questions a model asks, and the answers a person gives. */
  questions: Text.optional(),
  answers: Text.optional(),
  /** Document: what the knowledge lookup found. */
  sources: Text.optional(),
  draftA: Text,
  draftB: Text,
  /** The second model's review of draft A. Carries the defect the panel catches. */
  reviewOfA: Text,
  reviewOfB: Text,
  synthesis: Text,
  checks: z.array(z.object({ name: Text, detail: Text })).min(3),
  approval: Text,
  /**
   * Build: test cases and the test script, written by a different model from the code and without seeing it,
   * then the code, the failing test run, the fix, the passing run, and the release gate.
   */
  testCases: Text.optional(),
  testScript: Text.optional(),
  /** Build: the architecture Model A proposes, Model B's review of it, the revision, its checks and its approval. */
  architecture: z
    .object({ draft: Text, review: Text, final: Text, checks: z.array(z.object({ name: Text, detail: Text })).min(2), approval: Text })
    .optional(),
  /** Build: Model B's review of Model A's code, and what Model A applied or declined. */
  codeReview: z.object({ review: Text, revise: Text }).optional(),
  /** Build: Model A's own unit tests, and their run on the code as first written (generated from public/tests.js). */
  unitScript: Text.optional(),
  unitRun: Text.optional(),
  /** Build: staging, smoke tests, the production approval and the rollout. */
  deploy: z.object({ staging: Text, smoke: Text, approval: Text, production: Text }).optional(),
  code: Text.optional(),
  testsRed: Text.optional(),
  fix: Text.optional(),
  testsGreen: Text.optional(),
  release: Text.optional(),
  /** Document: how the approved result goes out. */
  deliver: Text.optional(),
  /**
   * The finished deliverable a viewer can read: the approved requirements and what shipped, or the document itself.
   * Lines starting "## " are headings and "- " are bullets.
   */
  output: Text,
  /**
   * What one model alone would have handed over, next to what the panel delivers: a passage from the draft a
   * review flagged, the passage that replaced it in the output, and why it mattered, in plain words.
   */
  contrast: z.object({ draft: z.enum(["A", "B"]), before: Text, after: Text, why: Text }).nullable(),
});

let calibrationCache: Record<string, { cost: number; seconds: number; input: number; output: number }> | null = null;

/**
 * Per model, real recorded calls divided by what the estimates said for the same panel steps. Empty when
 * nothing is recorded, so estimates stand as they are.
 */
export function calibration(): Record<string, { cost: number; seconds: number; input: number; output: number }> {
  if (calibrationCache) return calibrationCache;
  const sums: Record<string, { real: [number, number, number, number]; guess: [number, number, number, number] }> = {};
  const stepOf: Record<string, string> = { analystA: "draftA", analystB: "draftB", critiqueOfA: "reviewOfA", critiqueOfB: "reviewOfB", synthesizer: "merge" };
  for (const authored of loadSpecs(undefined, { recordings: false })) {
    const recording = recordingFor(authored.id);
    if (!recording) continue;
    const estimate = expandEstimates(authored);
    for (const call of recording.calls) {
      const step = estimate.find((item) => item.id === stepOf[call.role]);
      if (!step?.tokens) continue;
      const entry = (sums[step.actor] ??= { real: [0, 0, 0, 0], guess: [0, 0, 0, 0] });
      entry.real = [entry.real[0] + call.costUsd, entry.real[1] + call.seconds, entry.real[2] + call.inputTokens, entry.real[3] + call.outputTokens];
      entry.guess = [entry.guess[0] + (step.estimatedCostUsd ?? 0), entry.guess[1] + step.seconds, entry.guess[2] + step.tokens.input, entry.guess[3] + step.tokens.output];
    }
  }
  calibrationCache = Object.fromEntries(
    Object.entries(sums).map(([model, { real, guess }]) => [model, { cost: real[0] / guess[0], seconds: real[1] / guess[1], input: real[2] / guess[2], output: real[3] / guess[3] }]),
  );
  return calibrationCache;
}

/** A workflow as authored, plus the real recording of its panel when one has been made. */
export type WorkflowSpec = z.infer<typeof SpecSchema> & { recording?: Recording };

export type StepKind = "input" | "llm" | "tool" | "check" | "human";

export interface Step {
  id: string;
  kind: StepKind;
  phase: number;
  col: number;
  /** 0 top, 1 middle, 2 bottom. Middle steps span the full height. */
  row: 0 | 1 | 2;
  title: string;
  /** A model id for llm steps; otherwise who or what acts. */
  actor: string;
  caption: string;
  given: string;
  output: string;
  after: string[];
  /** Seconds a live run of this step would take. Zero for a person's step. */
  seconds: number;
  tokens?: { input: number; output: number };
  /** What this call would cost if it were live. Null for steps that are not model calls. */
  estimatedCostUsd: number | null;
  verdict?: "pass" | "flagged";
  /** The software-development stage a build step belongs to. */
  stage?: string;
  /** Replayed from a real recorded call, with its real time, tokens and cost. */
  recorded?: boolean;
  /** An estimate scaled by how real recorded calls on the same model compared with the estimates. */
  calibrated?: boolean;
}

/** The stages of software development a build workflow walks through, in order. */
export const BUILD_STAGES = ["PRD", "Architecture", "Code", "Code review", "Unit tests", "Test cases", "Testing", "Deployment"];
/** The stages a document or decision walks through. */
export const DOCUMENT_STAGES = ["Research", "Drafts", "Cross-review", "Merge", "Checks", "Approval", "Delivery"];

export interface Workflow {
  id: string;
  domain: DomainId;
  kind: "build" | "document";
  title: string;
  summary: string;
  deliverable: string;
  project: string;
  requester: string;
  brief: string;
  output: string;
  contrast: { draft: "A" | "B"; before: string; after: string; why: string } | null;
  /** When the panel is replayed from a real recording: when it was made, what it cost, how long it took. */
  recording: { recordedAt: string; costUsd: number; seconds: number; calls: number } | null;
  phases: string[];
  /** What each model's role is, keyed by model id. */
  models: typeof MODELS;
  /** A trivial request in this domain, for showing the router choose the cheap path. */
  lowRiskRequest: string;
  /** The stages this workflow walks through, in order: software development for a build. */
  stages: string[];
  /** Where two steps are walled off from each other: the two drafts, and in a build the tests and the code. */
  walls: Array<{ phase: number; col: number; span: number; label: string }>;
  steps: Step[];
  estimatedCostUsd: number;
  estimatedSeconds: number;
}

const CLAUDE = "claude-opus-5";
const GROK = "grok-4.7";
const JEV = "jev-1.14.0";

/**
 * The three roles a workflow uses. The page names them by role, so any model can fill one; the model ids below
 * are what this replay assumes, shown only in the technical view.
 */
export const MODELS: Record<string, { label: string; role: string; qualities: string }> = {
  [CLAUDE]: { label: "Model A", role: "Builder", qualities: "Deep reasoning. Writes the PRD, the design, the code and the fixes." },
  [GROK]: { label: "Model B", role: "Checker", qualities: "An independent model from a different vendor, fast and low-cost. Reviews the builder's work and writes the tests." },
  [JEV]: { label: "Model C", role: "Decider", qualities: "A decision model. Answers yes/no and multiple-choice questions with a confidence score, typically in 0.1 to 0.6 s, for a fraction of a cent. It cannot write text, so it cannot make things up." },
};

/** Typical sizes from the real Claude + Grok PRD run, so estimates sit near what a live run would cost. */
const SIZE = {
  clarify: { input: 6_000, output: 1_500, seconds: 40 },
  draftClaude: { input: 18_000, output: 10_000, seconds: 125 },
  draftGrok: { input: 15_000, output: 9_000, seconds: 300 },
  reviewClaude: { input: 25_000, output: 7_000, seconds: 94 },
  reviewGrok: { input: 25_000, output: 1_200, seconds: 259 },
  merge: { input: 45_000, output: 25_000, seconds: 320 },
  decide: { input: 3_000, output: 0, seconds: 0.1 },
  archDraft: { input: 22_000, output: 5_000, seconds: 150 },
  archReview: { input: 20_000, output: 1_500, seconds: 200 },
  archFinal: { input: 28_000, output: 6_000, seconds: 170 },
  codeReview: { input: 18_000, output: 1_800, seconds: 180 },
  codeRevise: { input: 16_000, output: 3_000, seconds: 90 },
  unitTests: { input: 14_000, output: 3_000, seconds: 85 },
  testCases: { input: 12_000, output: 2_500, seconds: 95 },
  testScript: { input: 14_000, output: 5_000, seconds: 160 },
  code: { input: 20_000, output: 6_000, seconds: 180 },
  fix: { input: 12_000, output: 1_500, seconds: 60 },
};

function llm(
  base: Omit<Step, "kind" | "seconds" | "tokens" | "estimatedCostUsd" | "actor">,
  model: string,
  size: { input: number; output: number; seconds: number },
): Step {
  const tokens = { input: size.input, output: size.output };
  return {
    ...base,
    kind: "llm",
    actor: model,
    seconds: size.seconds,
    tokens,
    estimatedCostUsd: callCost(model, { inputTokens: tokens.input, outputTokens: tokens.output, cacheReadTokens: 0, cacheWriteTokens: 0 }),
  };
}

function step(base: Omit<Step, "estimatedCostUsd">): Step {
  return { ...base, estimatedCostUsd: null };
}

/** A review is flagged when it found a serious (P0) defect in the draft it read. */
function reviewVerdict(review: string): "pass" | "flagged" {
  return /\bP0\b/.test(review) ? "flagged" : "pass";
}

/** A probability fixed per workflow and question, so a replay shows the same decision every time. */
function confidence(key: string, low: number, high: number): string {
  return (low + (spread(key) - 0.75) / 0.55 * (high - low)).toFixed(2);
}

/** How risky each workflow is, and whether it touches personal, health or financial data. */
/** How risky a workflow is, as the router's replay assumes. */
export function riskOf(id: string): "low" | "medium" | "high" {
  return RISK[id]?.level ?? "high";
}

const RISK: Record<string, { level: "low" | "high" | "medium"; data: boolean }> = {
  "healthcare-build": { level: "high", data: true },
  "healthcare-document": { level: "high", data: true },
  "education-build": { level: "high", data: true },
  "education-document": { level: "medium", data: false },
  "fmcg-build": { level: "medium", data: false },
  "fmcg-document": { level: "medium", data: false },
  "finance-build": { level: "high", data: true },
  "finance-document": { level: "high", data: true },
  "logistics-build": { level: "medium", data: true },
  "logistics-document": { level: "medium", data: false },
};

/** One typed question for the decision model. `expect` and the confidence range drive the replay's answer. */
export interface DecisionQuestion {
  key: string;
  type: "noul" | "choice";
  /** What the decision model is asked. */
  instructions: string;
  /** Choice questions: each option and what it means. */
  criteria?: Record<string, string>;
  /** How the question reads on the page. */
  label: string;
  expect: string;
  confidence: [number, number];
}

export type DecisionAnswer = { type: "noul"; noul: number } | { type: "choice"; choice: string; probabilities: Record<string, number> };

/** A decision the decision model makes: what it reads, what it is asked, and how its answers are concluded. */
export interface Decision {
  state: string;
  questions: DecisionQuestion[];
  conclude(answers: Record<string, DecisionAnswer>): string;
}

const yesNo = (answer: DecisionAnswer | undefined) => answer?.type === "noul" && answer.noul >= 0.5;

/** A deliberately trivial request per domain, so a viewer can watch the router choose the cheap path. */
export const LOW_RISK_REQUEST: Record<DomainId, string> = {
  healthcare: "Fix a typo on the denial workbench help page: 'reciept' should read 'receipt'.",
  education: "Change the colour of the Print button on the timetable page from grey to blue.",
  fmcg: "Fix a typo in the distributor portal footer: 'Distribtor' should read 'Distributor'.",
  finance: "Update the copyright year in the loan app footer from 2025 to 2026.",
  logistics: "Rename the 'Shipments' tab in the tracker menu to 'My shipments'.",
};

/** The questions behind each of Model C's steps, built from the workflow's own content. */
export function decisionFor(spec: WorkflowSpec, stepId: string): Decision | null {
  const low = stepId === "routeLow";
  const risk = low ? { level: "low" as const, data: false } : (RISK[spec.id] ?? { level: "high", data: true });
  if (stepId === "route" || low)
    return {
      state: `Project: ${spec.project}\nRequested by: ${spec.requester}\nRequest: ${low ? LOW_RISK_REQUEST[spec.domain] : spec.brief}`,
      questions: [
        {
          key: "risk",
          type: "choice",
          instructions: "How risky is this change if it is wrong?",
          criteria: {
            low: "A small, contained change; a mistake is cheap and easy to undo.",
            medium: "A mistake costs money or time, or misleads customers or staff, but harms no one's rights, health or finances.",
            high: "A mistake could harm someone's health, privacy, finances or legal rights, or breach a regulation.",
          },
          label: "How risky is this change?",
          expect: risk.level,
          confidence: [0.78, 0.93],
        },
        { key: "data", type: "noul", instructions: "Does this change touch personal, health or financial data about people?", label: "Does it touch personal, health or financial data?", expect: risk.data ? "yes" : "no", confidence: [0.88, 0.98] },
        { key: "single", type: "noul", instructions: "Can a single AI model, working alone with no independent review, handle this change safely?", label: "Can one model handle it safely on its own?", expect: low ? "yes" : "no", confidence: [0.84, 0.96] },
      ],
      conclude(answers) {
        const level = answers.risk?.type === "choice" ? answers.risk.choice : "high";
        return level === "low" && yesNo(answers.single)
          ? "Decision: one model and a person. A low-risk change does not need the full panel."
          : "Decision: the full panel. Two independent models check each other, and a person signs off at every gate.\nA low-risk request, such as fixing a typo, would go to one model and a person, at a fraction of the cost.";
      },
    };
  if (stepId === "triage") {
    const findings = [...`${spec.reviewOfA}\n${spec.reviewOfB}`.matchAll(/^(D-[AB]\d+) · (P\d) · (.+)$/gm)];
    return {
      state: `${spec.reviewOfA}\n\n${spec.reviewOfB}`,
      questions: findings.map(([, id, severity, title]) => ({
        key: (id ?? "").replace("-", "_"),
        type: "noul" as const,
        instructions: `Reviewers rate findings P0 (blocking: must be fixed), P1 (should be fixed before approval) or P2 (optional). Finding ${id} is rated ${severity}: ${title}. Must it be fixed before this is approved?`,
        label: `Must the next step fix ${id} (${(title ?? "").toLowerCase()})?`,
        expect: severity === "P0" || severity === "P1" ? "yes" : "no",
        confidence: (severity === "P0" ? [0.95, 0.99] : severity === "P1" ? [0.68, 0.9] : [0.65, 0.88]) as [number, number],
      })),
      conclude(answers) {
        const must = findings.map(([, id]) => id ?? "").filter((id) => yesNo(answers[id.replace("-", "_")]));
        return `Decision: ${must.length ? `must fix ${must.join(", ")}` : "nothing blocks"}.`;
      },
    };
  }
  if (stepId === "reviewTriage") {
    const revise = spec.codeReview?.revise ?? "";
    const findings = [...(spec.codeReview?.review ?? "").matchAll(/^(CR-\d+) · (P\d) · (.+)$/gm)];
    return {
      state: `${spec.codeReview?.review ?? ""}\n\nThe change:\n${spec.code ?? ""}`,
      questions: findings.map(([, id, severity, title]) => {
        const apply = new RegExp(`^${id} applied`, "m").test(revise);
        return {
          key: (id ?? "").replace("-", "_"),
          type: "noul" as const,
          instructions: `Review point ${id} is rated ${severity}: ${title}. P1 points fix a real problem (a bug, a security or privacy risk, or two copies of logic that can drift) and should be applied. P2 points are suggestions about style, naming, comments or libraries; the author may decline them with a reason when the change would add duplication or a dependency for little gain. Should ${id} be applied rather than declined?`,
          label: `Worth applying ${id} (${(title ?? "").toLowerCase()})?`,
          expect: apply ? "yes" : "no",
          confidence: (apply ? (severity === "P1" ? [0.86, 0.97] : [0.6, 0.78]) : [0.7, 0.88]) as [number, number],
        };
      }),
      conclude: () => "Decision: apply the points marked yes; the builder records why it declines the rest.",
    };
  }
  if (stepId === "goNoGo") {
    const smoke = spec.deploy?.smoke ?? "";
    const passed = (smoke.match(/^✓/gm) ?? []).length;
    const rollback = (spec.deploy?.production ?? "").match(/^Rollback plan:.*$/m)?.[0] ?? "";
    return {
      state: `Smoke tests on staging: ${passed} passed, 0 failed.\n${smoke.replace(/^✓ /gm, "PASSED: ")}\n\n${rollback}`,
      questions: [
        { key: "smoke", type: "noul", instructions: "Did every smoke test pass?", label: `Did every smoke test pass (${passed} of ${passed})?`, expect: "yes", confidence: [0.97, 0.99] },
        { key: "rollback", type: "noul", instructions: "Is there a clear plan to roll this back if it goes wrong?", label: "Is there a tested rollback plan?", expect: "yes", confidence: [0.9, 0.98] },
        { key: "risk", type: "noul", instructions: "Is there any sign this release would harm real users?", label: "Any sign of risk to real users?", expect: "no", confidence: [0.86, 0.95] },
      ],
      conclude: (answers) =>
        yesNo(answers.smoke) && yesNo(answers.rollback) && !yesNo(answers.risk) ? "Recommendation: go. A person makes the final call." : "Recommendation: no-go. A person should look before anything ships.",
    };
  }
  return null;
}

/** The answers a replay shows: the expected answer, with a confidence fixed per workflow and question. */
export function replayAnswers(spec: WorkflowSpec, stepId: string, decision: Decision): Record<string, DecisionAnswer> {
  const answers: Record<string, DecisionAnswer> = {};
  for (const question of decision.questions) {
    const p = Number(confidence(`${spec.id}:${stepId}:${question.key}`, question.confidence[0], question.confidence[1]));
    if (question.type === "noul") answers[question.key] = { type: "noul", noul: question.expect === "yes" ? p : Number((1 - p).toFixed(2)) };
    else {
      const options = Object.keys(question.criteria ?? {});
      const rest = 1 - p;
      const others = options.filter((option) => option !== question.expect);
      const probabilities: Record<string, number> = {};
      others.forEach((option, index) => (probabilities[option] = Number((rest * (index === 0 ? 0.25 : 0.75)).toFixed(2))));
      probabilities[question.expect] = p;
      answers[question.key] = { type: "choice", choice: question.expect, probabilities };
    }
  }
  return answers;
}

/** How a decision reads on the page, whether the answers are live or replayed. */
export function formatDecision(decision: Decision, answers: Record<string, DecisionAnswer>): string {
  const lines = decision.questions.map((question) => {
    const answer = answers[question.key];
    if (!answer) return `${question.label}  → no answer`;
    if (answer.type === "noul") {
      const yes = answer.noul >= 0.5;
      return `${question.label}  → ${yes ? "yes" : "no"} · ${(yes ? answer.noul : 1 - answer.noul).toFixed(2)}`;
    }
    const options = Object.keys(question.criteria ?? answer.probabilities);
    const spread = options.map((option) => `${option} ${(answer.probabilities[option] ?? 0).toFixed(2)}`).join(" · ");
    return `${question.label}  → ${answer.choice} · ${(answer.probabilities[answer.choice] ?? 0).toFixed(2)}  (${spread})`;
  });
  return [...lines, decision.conclude(answers)].join("\n");
}

function decisionText(spec: WorkflowSpec, stepId: string): string {
  const decision = decisionFor(spec, stepId);
  return decision ? formatDecision(decision, replayAnswers(spec, stepId, decision)) : "";
}

/** Both shapes share the panel: two walled-off drafts, crossed reviews, one merge, code checks, a person. */
function panel(spec: WorkflowSpec, startCol: number, inputs: string[]): Step[] {
  const c = startCol;
  return [
    llm({ id: "draftA", phase: 0, col: c, row: 0, title: "Draft A", caption: "Model A writes a first draft from the brief. It cannot see the other draft.", given: "The brief and everything gathered so far. Not draft B.", output: spec.draftA, after: inputs }, CLAUDE, SIZE.draftClaude),
    llm({ id: "draftB", phase: 0, col: c, row: 2, title: "Draft B", caption: "Model B writes its own draft, separately. Two different models bring two different sets of blind spots.", given: "The same brief and material. Not draft A.", output: spec.draftB, after: inputs }, GROK, SIZE.draftGrok),
    llm({ id: "reviewOfB", phase: 0, col: c + 1, row: 0, title: "A reviews B", caption: "Model A reviews Model B's draft for defects. No model reviews its own work.", given: "Draft B only.", output: spec.reviewOfB, after: ["draftB"], verdict: reviewVerdict(spec.reviewOfB) }, CLAUDE, SIZE.reviewClaude),
    llm({ id: "reviewOfA", phase: 0, col: c + 1, row: 2, title: "B reviews A", caption: "Model B reviews Model A's draft the same way.", given: "Draft A only.", output: spec.reviewOfA, after: ["draftA"], verdict: reviewVerdict(spec.reviewOfA) }, GROK, SIZE.reviewGrok),
    llm({ id: "triage", phase: 0, col: c + 2, row: 1, title: "Triage", caption: "Model C decides which findings the merge must fix, with a confidence score. Honestly, a plain rule (fix every P0 and P1) would decide the same here; Model C earns its keep on calls with no labels, like routing.", given: "Both reviews' findings.", output: decisionText(spec, "triage"), after: ["reviewOfA", "reviewOfB"] }, JEV, SIZE.decide),
    llm({ id: "merge", phase: 0, col: c + 3, row: 1, title: "Merge", caption: "Model A merges both drafts and has to resolve every finding Model C marked.", given: "Both drafts, both reviews and the triage.", output: spec.synthesis, after: ["triage"], verdict: "pass" }, CLAUDE, SIZE.merge),
    step({ id: "checks", kind: "check", phase: 0, col: c + 4, row: 1, title: "Code checks", actor: "No model", caption: "Plain code checks verify the result. No model is involved here.", given: "The merged result.", output: spec.checks.map((item) => `✓ ${item.name}\n  ${item.detail}`).join("\n"), after: ["merge"], seconds: 1, verdict: "pass" }),
    step({ id: "approve", kind: "human", phase: 0, col: c + 5, row: 1, title: "You approve", actor: "Person", caption: "A person approves. Nothing moves forward without it.", given: "The checked result, both drafts, and both reviews.", output: spec.approval, after: ["checks"], seconds: 0 }),
  ];
}

function spread(key: string): number {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return 0.75 + (hash % 1000) / 1000 * 0.55;
}

function resize(item: Step, factor: number): Step {
  const tokens = { input: Math.round((item.tokens?.input ?? 0) * (0.9 + factor / 10)), output: Math.round((item.tokens?.output ?? 0) * factor) };
  return {
    ...item,
    tokens,
    seconds: item.seconds < 1 ? item.seconds : Math.round(item.seconds * factor),
    estimatedCostUsd: callCost(item.actor, { inputTokens: tokens.input, outputTokens: tokens.output, cacheReadTokens: 0, cacheWriteTokens: 0 }),
  };
}

/** A build hands over its tests too: the generated cases, the script, and the run that passed. */
function buildOutput(spec: WorkflowSpec): string {
  const bullets = (text: string) => text.split("\n").map((line) => `- ${line}`).join("\n");
  const fence = (text: string) => `\`\`\`\n${text}\n\`\`\``;
  return [
    spec.output,
    `## Architecture\n${spec.architecture?.final ?? ""}`,
    `## Code review\n${bullets(spec.codeReview?.revise ?? "")}`,
    `## Generated test cases\n${bullets(spec.testCases ?? "")}`,
    `## Generated test script\n${fence(spec.testScript ?? "")}`,
    `## Test run\n${fence(spec.testsGreen ?? "")}`,
    `## Deployment\n${bullets(spec.deploy?.production ?? "")}`,
  ].join("\n");
}

/** The uncalibrated estimate for each step, used to measure how far estimates are from recorded reality. */
function expandEstimates(spec: WorkflowSpec): Step[] {
  return expand(spec, { raw: true }).steps;
}

export function expand(spec: WorkflowSpec, options: { raw?: boolean } = {}): Workflow {
  const brief = step({ id: "brief", kind: "input", phase: 0, col: 0, row: 1, title: "The brief", actor: "Requester", caption: "Everything starts from one short brief.", given: "What the requester asked for.", output: spec.brief, after: [], seconds: 0 });
  let steps: Step[];
  let phases: string[];
  let walls: Workflow["walls"];
  if (spec.kind === "build") {
    phases = ["PRD", "Architecture", "Code and review", "Test", "Deploy"];
    walls = [{ phase: 0, col: 4, span: 1, label: "cannot see each other" }];
    const arch = spec.architecture;
    const review = spec.codeReview;
    const deploy = spec.deploy;
    steps = [
      brief,
      llm({ id: "route", phase: 0, col: 1, row: 1, title: "Route", caption: "Model C, a fast decision model, judges how risky the request is and how much checking it needs, in about a tenth of a second.", given: "The brief.", output: decisionText(spec, "route"), after: ["brief"] }, JEV, SIZE.decide),
      llm({ id: "clarify", phase: 0, col: 2, row: 1, title: "Questions", caption: "Model A asks the few questions whose answers change what gets built.", given: "The brief.", output: spec.questions ?? "", after: ["route"] }, CLAUDE, SIZE.clarify),
      step({ id: "answers", kind: "human", phase: 0, col: 3, row: 1, title: "Your answers", actor: "Requester", caption: "The requester answers. Their answers become the agreed assumptions.", given: "The questions.", output: spec.answers ?? "", after: ["clarify"], seconds: 0 }),
      ...panel(spec, 4, ["answers"]),
      llm({ id: "archDraft", phase: 1, col: 0, row: 1, title: "Architecture", caption: "Model A designs how to build it: the components, the data, and the exact files it may change.", given: "The approved PRD.", output: arch?.draft ?? "", after: ["approve"] }, CLAUDE, SIZE.archDraft),
      llm({ id: "archReview", phase: 1, col: 1, row: 1, title: "B reviews it", caption: "Model B reviews the design before any code exists, when a mistake is cheapest to fix.", given: "The PRD and the architecture.", output: arch?.review ?? "", after: ["archDraft"], verdict: reviewVerdict(arch?.review ?? "") }, GROK, SIZE.archReview),
      llm({ id: "archFinal", phase: 1, col: 2, row: 1, title: "Revise", caption: "Model A revises the design to resolve every finding.", given: "The architecture and Grok's review.", output: arch?.final ?? "", after: ["archReview"], verdict: "pass" }, CLAUDE, SIZE.archFinal),
      step({ id: "archChecks", kind: "check", phase: 1, col: 3, row: 1, title: "Design checks", actor: "No model", caption: "Code checks confirm every requirement has a home and the file fence is tight.", given: "The PRD and the revised architecture.", output: (arch?.checks ?? []).map((item) => `✓ ${item.name}\n  ${item.detail}`).join("\n"), after: ["archFinal"], seconds: 1, verdict: "pass" }),
      step({ id: "archApprove", kind: "human", phase: 1, col: 4, row: 1, title: "You approve", actor: "Person", caption: "A person approves the design. Code starts only after this.", given: "The architecture, the review and the checks.", output: arch?.approval ?? "", after: ["archChecks"], seconds: 0 }),
      llm({ id: "code", phase: 2, col: 0, row: 1, title: "Write code", caption: "Model A writes the change, and may touch only the files the approved design allows.", given: "The approved PRD and architecture. Not the tests.", output: spec.code ?? "", after: ["archApprove"] }, CLAUDE, SIZE.code),
      llm({ id: "codeReview", phase: 2, col: 1, row: 1, title: "Code review", caption: "Model B reviews Model A's code, as a second engineer would.", given: "The code change and the architecture.", output: review?.review ?? "", after: ["code"], verdict: reviewVerdict(review?.review ?? "") }, GROK, SIZE.codeReview),
      llm({ id: "reviewTriage", phase: 2, col: 2, row: 1, title: "Decide", caption: "Model C decides which review points are worth applying, each with a confidence score.", given: "The review's points.", output: decisionText(spec, "reviewTriage"), after: ["codeReview"] }, JEV, SIZE.decide),
      llm({ id: "codeRevise", phase: 2, col: 3, row: 1, title: "Apply review", caption: "Model A applies the points Model C marked, and records its reason wherever it declines one.", given: "The code, the review and the decision.", output: review?.revise ?? "", after: ["reviewTriage"] }, CLAUDE, SIZE.codeRevise),
      llm({ id: "unitTests", phase: 2, col: 4, row: 1, title: "Unit tests", caption: "Model A writes unit tests for its own code.", given: "Its own code.", output: spec.unitScript ?? "", after: ["codeRevise"] }, CLAUDE, SIZE.unitTests),
      step({ id: "unitRun", kind: "tool", phase: 2, col: 5, row: 1, title: "Run unit tests", actor: "Test runner", caption: "Model A's unit tests pass. But an author tests what they thought of; the next stage tests what was asked for.", given: "Claude's unit tests and code.", output: spec.unitRun ?? "", after: ["unitTests"], seconds: 10, verdict: "pass" }),
      llm({ id: "testCases", phase: 3, col: 0, row: 1, title: "Test cases", caption: "Model B turns every acceptance criterion into test cases. It works from the PRD and has never seen the code.", given: "The approved PRD only. Not the code.", output: spec.testCases ?? "", after: ["approve"] }, GROK, SIZE.testCases),
      llm({ id: "testScript", phase: 3, col: 1, row: 1, title: "Test script", caption: "Model B writes the test cases as a runnable test script.", given: "The test cases and the code's public interface. Not its implementation.", output: spec.testScript ?? "", after: ["testCases"] }, GROK, SIZE.testScript),
      step({ id: "testsRed", kind: "tool", phase: 3, col: 2, row: 1, title: "Run tests", actor: "Test runner", caption: "Model B's tests run against Model A's code, and one fails: a bug that passed code review and Model A's own unit tests.", given: "Model B's test script and Model A's code.", output: spec.testsRed ?? "", after: ["testScript", "unitRun"], seconds: 20, verdict: "flagged" }),
      llm({ id: "fix", phase: 3, col: 3, row: 1, title: "Fix", caption: "Model A reads the failing test and makes one targeted fix.", given: "The failing test output and the code.", output: spec.fix ?? "", after: ["testsRed"] }, CLAUDE, SIZE.fix),
      step({ id: "testsGreen", kind: "tool", phase: 3, col: 4, row: 1, title: "Tests again", actor: "Test runner", caption: "The same tests run again, with the unit tests, and all pass.", given: "The fixed code.", output: spec.testsGreen ?? "", after: ["fix"], seconds: 20, verdict: "pass" }),
      step({ id: "release", kind: "check", phase: 4, col: 0, row: 1, title: "Release gate", actor: "No model", caption: "The release gate re-checks approvals, tests and data rules before anything ships.", given: "Approvals, test results and scans.", output: spec.release ?? "", after: ["testsGreen"], seconds: 2, verdict: "pass" }),
      step({ id: "staging", kind: "tool", phase: 4, col: 1, row: 1, title: "Deploy to staging", actor: "Pipeline", caption: "The build goes to staging, a copy of production with no real users.", given: "The released build.", output: deploy?.staging ?? "", after: ["release"], seconds: 240 }),
      step({ id: "smoke", kind: "check", phase: 4, col: 2, row: 1, title: "Smoke tests", actor: "No model", caption: "Scripted checks exercise the main paths on staging.", given: "The staging deployment.", output: deploy?.smoke ?? "", after: ["staging"], seconds: 60, verdict: "pass" }),
      llm({ id: "goNoGo", phase: 4, col: 3, row: 1, title: "Go / no-go", caption: "Model C weighs the staging results and recommends go or no-go. A script could answer the first two questions; the third, any sign of risk to real users, is the judgement call. A person still decides.", given: "Smoke tests and the rollback plan.", output: decisionText(spec, "goNoGo"), after: ["smoke"] }, JEV, SIZE.decide),
      step({ id: "deployApprove", kind: "human", phase: 4, col: 4, row: 1, title: "You approve", actor: "Person", caption: "A person approves the move to production.", given: "Model C's recommendation, test results, smoke tests and the rollback plan.", output: deploy?.approval ?? "", after: ["goNoGo"], seconds: 0 }),
      step({ id: "production", kind: "tool", phase: 4, col: 5, row: 1, title: "Production", actor: "Pipeline", caption: "A gradual rollout to real users, watched, with a rollback plan ready.", given: "The approved build.", output: deploy?.production ?? "", after: ["deployApprove"], seconds: 600 }),
    ];
    const stageOf: Record<string, string> = {
      archDraft: "Architecture", archReview: "Architecture", archFinal: "Architecture", archChecks: "Architecture", archApprove: "Architecture",
      code: "Code", codeReview: "Code review", reviewTriage: "Code review", codeRevise: "Code review", unitTests: "Unit tests", unitRun: "Unit tests",
      testCases: "Test cases", testScript: "Test cases", testsRed: "Testing", fix: "Testing", testsGreen: "Testing",
      release: "Deployment", staging: "Deployment", smoke: "Deployment", goNoGo: "Deployment", deployApprove: "Deployment", production: "Deployment",
    };
    steps = steps.map((item) => ({ ...item, stage: stageOf[item.id] ?? "PRD" }));
  } else {
    phases = ["Draft, review and approve"];
    walls = [{ phase: 0, col: 3, span: 1, label: "cannot see each other" }];
    steps = [
      brief,
      llm({ id: "route", phase: 0, col: 1, row: 1, title: "Route", caption: "Model C, a fast decision model, judges how risky the request is and how much checking it needs, in about a tenth of a second.", given: "The brief.", output: decisionText(spec, "route"), after: ["brief"] }, JEV, SIZE.decide),
      step({ id: "sources", kind: "tool", phase: 0, col: 2, row: 1, title: "Knowledge lookup", actor: "Retrieval", caption: "The relevant policies and records are looked up, so the drafts work from facts.", given: "The brief.", output: spec.sources ?? "", after: ["route"], seconds: 2 }),
      ...panel(spec, 3, ["sources"]),
      step({ id: "deliver", kind: "tool", phase: 0, col: 9, row: 1, title: "Deliver", actor: "Workflow", caption: "The approved result goes out, with a record of who approved what.", given: "The approved result.", output: spec.deliver ?? "", after: ["approve"], seconds: 2 }),
    ];
    const stageOf: Record<string, string> = {
      brief: "Research", route: "Research", sources: "Research", draftA: "Drafts", draftB: "Drafts", reviewOfA: "Cross-review", reviewOfB: "Cross-review", triage: "Cross-review",
      merge: "Merge", checks: "Checks", approve: "Approval", deliver: "Delivery",
    };
    steps = steps.map((item) => ({ ...item, stage: stageOf[item.id] }));
  }
  // Real calls vary in size from one task to the next. Scale each call by a factor fixed per workflow and step
  // (0.75 to 1.3), so estimates differ between workflows but never change between page loads.
  steps = steps.map((item) => (item.kind === "llm" ? resize(item, spread(`${spec.id}:${item.id}`)) : item));
  // Steps with no recording are estimates. Scale them by how far the estimates were off for the same model on
  // the calls that were recorded, so "would cost if live" reflects real usage.
  const scale = options.raw ? {} : calibration();
  steps = steps.map((item) => {
    const ratio = item.kind === "llm" ? scale[item.actor] : undefined;
    if (!ratio) return item;
    return {
      ...item,
      calibrated: true,
      seconds: Math.max(1, Math.round(item.seconds * ratio.seconds)),
      tokens: item.tokens ? { input: Math.round(item.tokens.input * ratio.input), output: Math.round(item.tokens.output * ratio.output) } : item.tokens,
      estimatedCostUsd: (item.estimatedCostUsd ?? 0) * ratio.cost,
    };
  });
  const recording = options.raw ? undefined : spec.recording;
  if (recording) {
    const stepOf: Record<string, string> = { analystA: "draftA", analystB: "draftB", critiqueOfA: "reviewOfA", critiqueOfB: "reviewOfB", synthesizer: "merge" };
    steps = steps.map((item) => {
      const call = recording.calls.find((entry) => stepOf[entry.role] === item.id);
      return call ? { ...item, recorded: true, seconds: call.seconds, tokens: { input: call.inputTokens, output: call.outputTokens }, estimatedCostUsd: call.costUsd } : item;
    });
  }
  const models = steps.filter((item) => item.kind === "llm");
  return {
    id: spec.id,
    domain: spec.domain,
    kind: spec.kind,
    title: spec.title,
    summary: spec.summary,
    deliverable: spec.deliverable,
    contrast: spec.contrast,
    recording: recording
      ? {
          recordedAt: recording.recordedAt,
          costUsd: recording.calls.reduce((total, call) => total + call.costUsd, 0),
          seconds: recording.calls.reduce((total, call) => total + call.seconds, 0),
          calls: recording.calls.length,
        }
      : null,
    project: spec.project,
    requester: spec.requester,
    brief: spec.brief,
    output: spec.kind === "build" ? buildOutput(spec) : spec.output,
    phases,
    models: MODELS,
    lowRiskRequest: LOW_RISK_REQUEST[spec.domain],
    stages: spec.kind === "build" ? BUILD_STAGES : DOCUMENT_STAGES,
    walls,
    steps,
    estimatedCostUsd: models.reduce((total, item) => total + (item.estimatedCostUsd ?? 0), 0),
    estimatedSeconds: steps.reduce((total, item) => total + item.seconds, 0),
  };
}

/** Problems that would make a workflow wrong or unsafe to show. Empty means it can be demoed. */
export function workflowIssues(spec: WorkflowSpec): string[] {
  const issues: string[] = [];
  const need = spec.kind === "build" ? (["questions", "answers", "architecture", "codeReview", "unitScript", "unitRun", "deploy", "testCases", "testScript", "code", "testsRed", "fix", "testsGreen", "release"] as const) : (["sources", "deliver"] as const);
  for (const field of need) if (!spec[field]) issues.push(`missing:${field}`);
  const flow = expand(spec);
  const ids = new Set(flow.steps.map((item) => item.id));
  for (const item of flow.steps) for (const dependency of item.after) if (!ids.has(dependency)) issues.push(`unknown-dependency:${item.id}->${dependency}`);
  const places = flow.steps.map((item) => `${item.phase}:${item.col}:${item.row}`);
  if (new Set(places).size !== places.length) issues.push("overlapping-steps");
  for (const item of flow.steps) if (item.kind === "llm" && item.estimatedCostUsd === null) issues.push(`unpriced-model:${item.actor}`);
  for (const finding of findPhi(JSON.stringify(spec))) issues.push(`phi:${finding.kind}:${finding.match}`);
  return issues;
}

const WORKFLOW_DIR = () => join(repoRoot(), "packages/studio/workflows");

export function loadSpecs(dir = WORKFLOW_DIR(), options: { recordings?: boolean } = {}): WorkflowSpec[] {
  const authored = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const parsed = SpecSchema.safeParse(JSON.parse(readFileSync(join(dir, name), "utf8")));
      if (!parsed.success) throw new Error(`${name}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
      return parsed.data as WorkflowSpec;
    });
  if (options.recordings === false) return authored;
  return authored.map((spec) => {
    const recording = recordingFor(spec.id);
    return recording ? applyRecording(spec, recording) : spec;
  });
}

/**
 * Puts a real recording in place of the prepared panel: the drafts, reviews and merge the models actually
 * wrote. The before-and-after comes from the most serious finding whose quote is in its draft, or is left
 * out when the reviews found nothing to contrast.
 */
export function applyRecording(spec: WorkflowSpec, recording: Recording): WorkflowSpec {
  const ids = (text: string) => text.match(/D-[AB]\d+/)?.[0];
  const resolutions = recording.merge.resolutions.flatMap((item) => {
    const id = ids(item.finding);
    return id ? [{ ...item, finding: id }] : [];
  });
  const total = recording.reviewOfA.findings.length + recording.reviewOfB.findings.length;
  const rank = { P0: 0, P1: 1, P2: 2 };
  const candidates = [
    ...recording.reviewOfA.findings.map((finding) => ({ finding, draft: "A" as const, text: recording.draftA })),
    ...recording.reviewOfB.findings.map((finding) => ({ finding, draft: "B" as const, text: recording.draftB })),
  ]
    .filter((item) => item.finding.severity !== "P2" && item.finding.quote && item.text.includes(item.finding.quote))
    .sort((a, b) => rank[a.finding.severity] - rank[b.finding.severity]);
  const pick = candidates.find((item) => resolutions.some((resolution) => resolution.finding === item.finding.id && resolution.outcome === "fixed"));
  const fix = pick ? resolutions.find((resolution) => resolution.finding === pick.finding.id) : undefined;
  const merged = recording.merge.document.trim();
  const output =
    spec.kind === "document"
      ? `## ${spec.deliverable}\n${merged}`
      : spec.output.replace(/## Approved requirements\n[\s\S]*?(?=\n## )/, `## Approved requirements\n${merged.split("\n").filter(Boolean).map((line) => `- ${line}`).join("\n")}`);
  return {
    ...spec,
    draftA: recording.draftA,
    draftB: recording.draftB,
    reviewOfA: renderReview(recording.reviewOfA, "D-A"),
    reviewOfB: renderReview(recording.reviewOfB, "D-B"),
    synthesis: renderMerge({ ...recording.merge, resolutions }, total),
    output,
    contrast: pick && fix ? { draft: pick.draft, before: pick.finding.quote, after: fix.note, why: pick.finding.detail } : null,
    recording,
  };
}

/** The catalog the page shows: domains with their workflows, without the long texts. */
export function catalog(specs = loadSpecs()) {
  return DOMAINS.map((domain) => ({
    ...domain,
    workflows: specs
      .filter((spec) => spec.domain === domain.id)
      .map((spec) => {
        const flow = expand(spec);
        return {
          id: flow.id,
          kind: flow.kind,
          title: flow.title,
          summary: flow.summary,
          deliverable: flow.deliverable,
          calls: flow.steps.filter((item) => item.kind === "llm").length,
          estimatedCostUsd: flow.estimatedCostUsd,
          estimatedSeconds: flow.estimatedSeconds,
        };
      }),
  }));
}
