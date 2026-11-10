import { callCost, findPhi, repoRoot } from "@northwind/orchestrator";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod/v4";

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
  contrast: z.object({ draft: z.enum(["A", "B"]), before: Text, after: Text, why: Text }),
});

export type WorkflowSpec = z.infer<typeof SpecSchema>;

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
}

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
  contrast: { draft: "A" | "B"; before: string; after: string; why: string };
  phases: string[];
  /** Where two steps are walled off from each other: the two drafts, and in a build the tests and the code. */
  walls: Array<{ phase: number; col: number; span: number; label: string }>;
  steps: Step[];
  estimatedCostUsd: number;
  estimatedSeconds: number;
}

const CLAUDE = "claude-opus-5";
const GROK = "grok-4.7";

/** Typical sizes from the real Claude + Grok PRD run, so estimates sit near what a live run would cost. */
const SIZE = {
  clarify: { input: 6_000, output: 1_500, seconds: 40 },
  draftClaude: { input: 18_000, output: 10_000, seconds: 125 },
  draftGrok: { input: 15_000, output: 9_000, seconds: 300 },
  reviewClaude: { input: 25_000, output: 7_000, seconds: 94 },
  reviewGrok: { input: 25_000, output: 1_200, seconds: 259 },
  merge: { input: 45_000, output: 25_000, seconds: 320 },
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

/** Both shapes share the panel: two walled-off drafts, crossed reviews, one merge, code checks, a person. */
function panel(spec: WorkflowSpec, startCol: number, inputs: string[]): Step[] {
  const c = startCol;
  return [
    llm({ id: "draftA", phase: 0, col: c, row: 0, title: "Draft A", caption: "Claude writes a first draft from the brief. It cannot see the other draft.", given: "The brief and everything gathered so far. Not draft B.", output: spec.draftA, after: inputs }, CLAUDE, SIZE.draftClaude),
    llm({ id: "draftB", phase: 0, col: c, row: 2, title: "Draft B", caption: "Grok writes its own draft, separately. Two different models bring two different sets of blind spots.", given: "The same brief and material. Not draft A.", output: spec.draftB, after: inputs }, GROK, SIZE.draftGrok),
    llm({ id: "reviewOfB", phase: 0, col: c + 1, row: 0, title: "Claude reviews B", caption: "Claude reviews Grok's draft for defects. No model reviews its own work.", given: "Draft B only.", output: spec.reviewOfB, after: ["draftB"], verdict: reviewVerdict(spec.reviewOfB) }, CLAUDE, SIZE.reviewClaude),
    llm({ id: "reviewOfA", phase: 0, col: c + 1, row: 2, title: "Grok reviews A", caption: "Grok reviews Claude's draft the same way.", given: "Draft A only.", output: spec.reviewOfA, after: ["draftA"], verdict: reviewVerdict(spec.reviewOfA) }, GROK, SIZE.reviewGrok),
    llm({ id: "merge", phase: 0, col: c + 2, row: 1, title: "Merge", caption: "Claude merges both drafts and has to resolve every serious defect either review raised.", given: "Both drafts and both reviews.", output: spec.synthesis, after: ["reviewOfA", "reviewOfB"], verdict: "pass" }, CLAUDE, SIZE.merge),
    step({ id: "checks", kind: "check", phase: 0, col: c + 3, row: 1, title: "Code checks", actor: "No model", caption: "Plain code checks verify the result. No model is involved here.", given: "The merged result.", output: spec.checks.map((item) => `✓ ${item.name}\n  ${item.detail}`).join("\n"), after: ["merge"], seconds: 1, verdict: "pass" }),
    step({ id: "approve", kind: "human", phase: 0, col: c + 4, row: 1, title: "You approve", actor: "Person", caption: "A person approves. Nothing moves forward without it.", given: "The checked result, both drafts, and both reviews.", output: spec.approval, after: ["checks"], seconds: 0 }),
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
    seconds: Math.round(item.seconds * factor),
    estimatedCostUsd: callCost(item.actor, { inputTokens: tokens.input, outputTokens: tokens.output, cacheReadTokens: 0, cacheWriteTokens: 0 }),
  };
}

/** A build hands over its tests too: the generated cases, the script, and the run that passed. */
function buildOutput(spec: WorkflowSpec): string {
  const cases = (spec.testCases ?? "").split("\n").map((line) => `- ${line}`).join("\n");
  return `${spec.output}\n## Generated test cases\n${cases}\n## Generated test script\n\`\`\`\n${spec.testScript ?? ""}\n\`\`\`\n## Test run\n\`\`\`\n${spec.testsGreen ?? ""}\n\`\`\``;
}

export function expand(spec: WorkflowSpec): Workflow {
  const brief = step({ id: "brief", kind: "input", phase: 0, col: 0, row: 1, title: "The brief", actor: "Requester", caption: "Everything starts from one short brief.", given: "What the requester asked for.", output: spec.brief, after: [], seconds: 0 });
  let steps: Step[];
  let phases: string[];
  let walls: Workflow["walls"];
  if (spec.kind === "build") {
    phases = ["Requirements", "Build and verify"];
    walls = [
      { phase: 0, col: 3, span: 1, label: "cannot see each other" },
      { phase: 1, col: 0, span: 2, label: "tests and code written apart" },
    ];
    steps = [
      brief,
      llm({ id: "clarify", phase: 0, col: 1, row: 1, title: "Questions", caption: "Claude asks the few questions whose answers change what gets built.", given: "The brief.", output: spec.questions ?? "", after: ["brief"] }, CLAUDE, SIZE.clarify),
      step({ id: "answers", kind: "human", phase: 0, col: 2, row: 1, title: "Your answers", actor: "Requester", caption: "The requester answers. Their answers become the agreed assumptions.", given: "The questions.", output: spec.answers ?? "", after: ["clarify"], seconds: 0 }),
      ...panel(spec, 3, ["answers"]),
      llm({ id: "testCases", phase: 1, col: 0, row: 0, title: "Test cases", caption: "Grok turns every acceptance criterion into test cases, with exact inputs and expected results.", given: "The approved requirements only. Not the code, which does not exist yet.", output: spec.testCases ?? "", after: ["approve"] }, GROK, SIZE.testCases),
      llm({ id: "testScript", phase: 1, col: 1, row: 0, title: "Test script", caption: "Grok writes the test cases as a runnable test script.", given: "The test cases and the code's public interface. Not its implementation.", output: spec.testScript ?? "", after: ["testCases"] }, GROK, SIZE.testScript),
      llm({ id: "code", phase: 1, col: 0, row: 2, title: "Write code", caption: "Claude writes the change inside the approved file fence. It never sees the tests, so it cannot write code that only satisfies them.", given: "The approved requirements. Not the tests.", output: spec.code ?? "", after: ["approve"] }, CLAUDE, SIZE.code),
      step({ id: "testsRed", kind: "tool", phase: 1, col: 2, row: 1, title: "Run tests", actor: "Test runner", caption: "The generated test script runs against the new code, and one test fails. That is the point: a test that cannot fail proves nothing.", given: "Grok's test script and Claude's code.", output: spec.testsRed ?? "", after: ["testScript", "code"], seconds: 20, verdict: "flagged" }),
      llm({ id: "fix", phase: 1, col: 3, row: 1, title: "Fix", caption: "Claude reads the failing test and makes one targeted fix.", given: "The failing test output and the code.", output: spec.fix ?? "", after: ["testsRed"] }, CLAUDE, SIZE.fix),
      step({ id: "testsGreen", kind: "tool", phase: 1, col: 4, row: 1, title: "Tests again", actor: "Test runner", caption: "The same tests run again and pass.", given: "The fixed code.", output: spec.testsGreen ?? "", after: ["fix"], seconds: 20, verdict: "pass" }),
      step({ id: "release", kind: "check", phase: 1, col: 5, row: 1, title: "Release gate", actor: "No model", caption: "The release gate re-checks approvals, tests and data rules before anything ships.", given: "Approvals, test results and scans.", output: spec.release ?? "", after: ["testsGreen"], seconds: 2, verdict: "pass" }),
    ];
  } else {
    phases = ["Draft, review and approve"];
    walls = [{ phase: 0, col: 2, span: 1, label: "cannot see each other" }];
    steps = [
      brief,
      step({ id: "sources", kind: "tool", phase: 0, col: 1, row: 1, title: "Knowledge lookup", actor: "Retrieval", caption: "The relevant policies and records are looked up, so the drafts work from facts.", given: "The brief.", output: spec.sources ?? "", after: ["brief"], seconds: 2 }),
      ...panel(spec, 2, ["sources"]),
      step({ id: "deliver", kind: "tool", phase: 0, col: 7, row: 1, title: "Deliver", actor: "Workflow", caption: "The approved result goes out, with a record of who approved what.", given: "The approved result.", output: spec.deliver ?? "", after: ["approve"], seconds: 2 }),
    ];
  }
  // Real calls vary in size from one task to the next. Scale each call by a factor fixed per workflow and step
  // (0.75 to 1.3), so estimates differ between workflows but never change between page loads.
  steps = steps.map((item) => (item.kind === "llm" ? resize(item, spread(`${spec.id}:${item.id}`)) : item));
  const models = steps.filter((item) => item.kind === "llm");
  return {
    id: spec.id,
    domain: spec.domain,
    kind: spec.kind,
    title: spec.title,
    summary: spec.summary,
    deliverable: spec.deliverable,
    contrast: spec.contrast,
    project: spec.project,
    requester: spec.requester,
    brief: spec.brief,
    output: spec.kind === "build" ? buildOutput(spec) : spec.output,
    phases,
    walls,
    steps,
    estimatedCostUsd: models.reduce((total, item) => total + (item.estimatedCostUsd ?? 0), 0),
    estimatedSeconds: steps.reduce((total, item) => total + item.seconds, 0),
  };
}

/** Problems that would make a workflow wrong or unsafe to show. Empty means it can be demoed. */
export function workflowIssues(spec: WorkflowSpec): string[] {
  const issues: string[] = [];
  const need = spec.kind === "build" ? (["questions", "answers", "testCases", "testScript", "code", "testsRed", "fix", "testsGreen", "release"] as const) : (["sources", "deliver"] as const);
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

export function loadSpecs(dir = WORKFLOW_DIR()): WorkflowSpec[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const parsed = SpecSchema.safeParse(JSON.parse(readFileSync(join(dir, name), "utf8")));
      if (!parsed.success) throw new Error(`${name}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
      return parsed.data;
    });
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
