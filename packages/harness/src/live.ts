import { CARC_RULES } from "@northwind/domain";
import { loadPack, relevant } from "@northwind/knowledge";
import {
  CritiqueSchema,
  PrdSchema,
  callCost,
  callRows,
  findPhi,
  intakeNouns,
  playPanel,
  prdGateIssues,
  prdIssues,
  repoRoot,
  reviewPanelIssues,
  seatQuality,
  synthesisSchema,
  type CallMetric,
  type CallRow,
  type DocumentChecks,
  type ModelProvider,
  type PanelCall,
  type PanelRole,
  type Prd,
  type ReviewPanel,
  type SeatAnswer,
  type SeatQuality,
  type SeatSpec,
} from "@northwind/orchestrator";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FEATURE_B_BRIEF, RULES, groundedCitations, questionPanel } from "./panels.ts";

/**
 * Everything every PRD seat is told: the brief, the question-round answers, the CARC table,
 * the pack files retrieval finds for the brief, and the document conventions. The gates are not
 * restated as rules to satisfy; they judge the result.
 */
export function prdContext(brief: string): string {
  const answers = questionPanel().synthesis.questions.map((question) => {
    const option = question.options.find((item) => item.id === question.defaultOptionId);
    return `- ${question.id} ${question.prompt} Answer: ${option?.label}. ${option?.consequence ?? ""}`;
  });
  const carc = CARC_RULES.map((rule) => `| ${rule.code} | ${rule.carcClass} | ${rule.meaning} | ${rule.nextAction} |`);
  const pack = relevant(loadPack(join(repoRoot(), "packages/knowledge/pack")), intakeNouns(brief)).map(
    (chunk) => `### pack/${chunk.path}\n\n${chunk.text}`,
  );
  return [
    "You are one seat on a review panel that writes a product requirements document (PRD) for Northwind Imaging's denial workbench, a demo revenue-cycle product. Every patient, claim, and document in it is synthetic.",
    `## Feature brief\n\n${brief}`,
    `## Answers from the question round\n\nThe requester chose these answers. Record each one as an assumption.\n\n${answers.join("\n")}`,
    `## CARC table\n\nThe only codes and next actions this product knows. Copy a next action exactly when you reference a code.\n\n| Code | Class | Meaning | Next action |\n| --- | --- | --- | --- |\n${carc.join("\n")}`,
    `## Knowledge pack\n\nThe files retrieval found for this brief. Cite them by the path in their heading; no other file can be cited.\n\n${pack.join("\n\n")}`,
    [
      "## PRD conventions",
      "",
      "- Ids: requirements REQ-1, REQ-2, ...; acceptance criteria AC-1, AC-2, ...; scenarios SCN-1, SCN-2, ...; screens SCR-1, SCR-2, SCR-3.",
      "- Every requirement has at least one acceptance criterion. Each criterion is a given / when / then an observer can check, with priority P0 (blocks release) or P1.",
      "- Every P0 criterion is exercised by at least one scenario. A scenario names the role acting, the starting state, the steps, and the expected result.",
      "- Propose three screens, each tied to the scenarios it serves.",
      "- Use only synthetic identifiers shaped PAT-###, CLM-###, and DOC-###. Never write a real name, SSN, MRN, phone number, email address, or date of birth.",
      "- List anything still undecided under openQuestions.",
    ].join("\n"),
  ].join("\n\n");
}

const CRITIQUE_RULES = [
  "For each quality attribute (security, accuracy, maintainability), write one finding: met or not, and a note saying why.",
  "Any attribute you mark unmet must be backed by a defect that names that attribute.",
  "Give each defect a severity: P0 when it would make the PRD wrong, untestable, or unsafe; P1 otherwise.",
].join(" ");

/** Seat instructions and answer shapes for the PRD panel. The user message is the seat prompt playPanel builds. */
export function livePrdSeats(): Record<PanelRole, SeatSpec> {
  return {
    analystA: {
      instructions:
        "You are analyst A. Write a complete PRD for the brief, working alone. Lean toward the denial specialist's day-to-day workflow.",
      schema: PrdSchema,
    },
    analystB: {
      instructions:
        "You are analyst B. Write a complete PRD for the brief, working alone. Lean toward payer rules, compliance, and what could go wrong.",
      schema: PrdSchema,
    },
    critiqueOfA: {
      instructions: `You are analyst B, reviewing analyst A's PRD, which follows <<PROPOSAL_A>> in the message. Set of to "A" and author to "B". Number your defects D-A1, D-A2, .... ${CRITIQUE_RULES}`,
      schema: CritiqueSchema,
    },
    critiqueOfB: {
      instructions: `You are analyst A, reviewing analyst B's PRD, which follows <<PROPOSAL_B>> in the message. Set of to "B" and author to "A". Number your defects D-B1, D-B2, .... ${CRITIQUE_RULES}`,
      schema: CritiqueSchema,
    },
    synthesizer: {
      instructions: [
        "You are the synthesizer. The message holds both PRDs and both critiques. Merge them into one PRD that a person will approve.",
        "In the rationale, say what you kept from A and from B, and what you rejected and why.",
        "List every defect id raised in either critique as resolved or unresolved. Resolve every P0.",
        "Write one finding per quality attribute saying how the merged PRD meets it.",
        "The merged PRD goes to approval, so it leaves no open questions.",
      ].join(" "),
      schema: synthesisSchema(PrdSchema),
      // A PRD nested in the synthesis wrapper is too large for the API to compile into a grammar.
      compiled: false,
    },
  };
}

/** The PRD stage's document checks: structure and citations on each draft, plus the approval gate on the synthesis. */
export function prdChecks(brief: string): DocumentChecks<Prd> {
  const grounded = groundedCitations(brief);
  return {
    proposal: (prd) => prdIssues(prd, grounded, RULES),
    synthesis: (prd) => prdGateIssues(prd, prdIssues(prd, grounded, RULES)),
  };
}

export interface LivePrdResult {
  panel: ReviewPanel<Prd>;
  calls: PanelCall[];
  metrics: CallMetric[];
  quality: Record<PanelRole, SeatQuality>;
  /** Wall-clock time for the whole panel. */
  durationMs: number;
  /** Every gate finding. Empty means the PRD could go to a person for approval. */
  issues: string[];
}

/**
 * Plays the PRD panel on any provider and runs the gates the factory runs at the PRD stage,
 * plus a PHI scan of everything the seats returned, since a live model can write anything.
 */
export async function runLivePrd(provider: ModelProvider, brief = FEATURE_B_BRIEF): Promise<LivePrdResult> {
  const started = performance.now();
  const { panel, calls, metrics } = await playPanel<Prd>(provider, "prd", brief);
  const issues = [
    ...reviewPanelIssues(panel, calls),
    ...prdGateIssues(panel.synthesis, prdIssues(panel.synthesis, groundedCitations(brief), RULES)),
    ...findPhi(JSON.stringify(panel)).map((finding) => `phi:${finding.kind}:${finding.match}`),
  ];
  const quality = seatQuality(panel, calls, prdChecks(brief));
  return { panel, calls, metrics, quality, durationMs: performance.now() - started, issues };
}

/** What `npm run live-prd` writes. A failed run is saved too, since its finished calls were billed. */
export interface SavedLiveRun {
  format: 2;
  model: string;
  brief: string;
  startedAt: string;
  durationMs: number;
  metrics: CallMetric[];
  /** Set when the run stopped before the panel finished. */
  failure?: string;
  /** The seats that finished before a failure, so `npm run live-prd -- --resume <file>` can continue without paying twice. */
  answers?: SeatAnswer[];
  /** The failed run this one continued, when it was resumed. */
  resumedFrom?: string;
  issues?: string[];
  quality?: Record<PanelRole, SeatQuality>;
  calls?: PanelCall[];
  panel?: ReviewPanel<Prd>;
}

/** The first saved shape: token counts per seat, no timing. */
interface SavedLiveRunV1 {
  model: string;
  brief: string;
  issues: string[];
  usage: Array<{ role: PanelRole; model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }>;
  calls: PanelCall[];
  panel: ReviewPanel<Prd>;
}

export interface LiveRunSummary {
  file: string;
  /** "recheck" replayed every seat, so it made no model call; "resumed" replayed some and paid for the rest. */
  kind: "live" | "resumed" | "recheck";
  resumedFrom: string | null;
  startedAt: string | null;
  durationMs: number | null;
  verdict: "pass" | "issues" | "failed";
  issues: string[];
  /** This run's own spend. Null when any call has no known price. */
  costUsd: number | null;
  /** This run plus every run it resumed from: what the result really took. */
  chainCostUsd: number | null;
  chainDurationMs: number | null;
  rows: CallRow[];
}

function totalCost(rows: CallRow[]): number | null {
  return rows.every((row) => row.costUsd !== null) ? rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0) : null;
}

export function summarizeLiveRun(file: string, saved: SavedLiveRun | SavedLiveRunV1): LiveRunSummary {
  if ("format" in saved) {
    const rows = callRows("PRD", saved.metrics, saved.quality ?? null);
    const replayed = saved.metrics.filter((metric) => metric.source === "resumed").length;
    return {
      file,
      kind: replayed === 0 ? "live" : replayed === saved.metrics.length && !saved.failure ? "recheck" : "resumed",
      resumedFrom: saved.resumedFrom ?? null,
      startedAt: saved.startedAt,
      durationMs: saved.durationMs,
      verdict: saved.failure ? "failed" : (saved.issues ?? []).length === 0 ? "pass" : "issues",
      issues: saved.failure ? [saved.failure] : (saved.issues ?? []),
      costUsd: totalCost(rows),
      chainCostUsd: totalCost(rows),
      chainDurationMs: saved.durationMs,
      rows,
    };
  }
  const metrics = saved.usage.map((usage) => ({
    role: usage.role,
    source: "live" as const,
    model: usage.model,
    durationMs: null,
    usage,
    costUsd: callCost(usage.model, usage),
  }));
  const rows = callRows("PRD", metrics, seatQuality(saved.panel, saved.calls, prdChecks(saved.brief)));
  const cost = totalCost(rows);
  return {
    file,
    kind: "live",
    resumedFrom: null,
    startedAt: null,
    durationMs: null,
    verdict: saved.issues.length === 0 ? "pass" : "issues",
    issues: saved.issues,
    costUsd: cost,
    chainCostUsd: cost,
    chainDurationMs: null,
    rows,
  };
}

/** Every saved live PRD run, newest first. A file that cannot be read is skipped, not fatal. */
export function readLiveRuns(dir = join(repoRoot(), "runs/live")): LiveRunSummary[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => /^prd-.*\.json$/.test(name));
  } catch {
    return [];
  }
  const runs: LiveRunSummary[] = [];
  for (const name of names.sort().reverse()) {
    try {
      runs.push(summarizeLiveRun(name, JSON.parse(readFileSync(join(dir, name), "utf8")) as SavedLiveRun | SavedLiveRunV1));
    } catch {
      continue;
    }
  }
  return withChains(runs);
}

/** Adds each run's predecessors along its resumedFrom links, so a resumed result shows what it really cost and took. */
export function withChains(runs: LiveRunSummary[]): LiveRunSummary[] {
  const byFile = new Map(runs.map((run) => [run.file, run]));
  return runs.map((run) => {
    let cost: number | null = run.costUsd;
    let duration: number | null = run.durationMs;
    const seen = new Set([run.file]);
    for (let previous = run.resumedFrom ? byFile.get(run.resumedFrom) : undefined; previous && !seen.has(previous.file); ) {
      seen.add(previous.file);
      cost = cost === null || previous.costUsd === null ? null : cost + previous.costUsd;
      duration = duration === null || previous.durationMs === null ? null : duration + previous.durationMs;
      previous = previous.resumedFrom ? byFile.get(previous.resumedFrom) : undefined;
    }
    return { ...run, chainCostUsd: cost, chainDurationMs: duration };
  });
}

/** One seat of a live run as the factory shows it: who answered, the real time and cost of the call that succeeded. */
export interface LiveSeat {
  role: PanelRole;
  model: string | null;
  durationMs: number | null;
  costUsd: number | null;
  quality: SeatQuality | null;
}

/** The latest live PRD run whose gates passed, ready to show beside the recorded run. */
export interface LiveShowcase {
  file: string;
  /** Runs in its resume chain that made a model call. A free re-check does not count. */
  paidAttempts: number;
  chainCostUsd: number | null;
  chainDurationMs: number | null;
  panel: ReviewPanel<Prd>;
  seats: LiveSeat[];
}

const SEATS: PanelRole[] = ["analystA", "analystB", "critiqueOfA", "critiqueOfB", "synthesizer"];

/**
 * A re-check replays every seat in no time, so a seat's real time and cost come from the attempt where it ran
 * live and succeeded. In a failed attempt a seat succeeded only if its answer was saved; the seat it stopped on
 * is skipped there, though its cost still counts in the chain.
 */
export function loadLiveShowcase(dir = join(repoRoot(), "runs/live")): LiveShowcase | null {
  const summaries = readLiveRuns(dir);
  const best = summaries.find((run) => run.verdict === "pass");
  if (!best) return null;
  const load = (file: string): SavedLiveRun | null => {
    try {
      const saved = JSON.parse(readFileSync(join(dir, file), "utf8")) as SavedLiveRun;
      return "format" in saved ? saved : null;
    } catch {
      return null;
    }
  };
  const latest = load(best.file);
  if (!latest?.panel) return null;
  const chain: SavedLiveRun[] = [];
  const seen = new Set<string>();
  for (let file: string | undefined = best.file; file && !seen.has(file); ) {
    seen.add(file);
    const run = load(file);
    if (!run) break;
    chain.unshift(run);
    file = run.resumedFrom;
  }
  const seats = SEATS.map((role): LiveSeat => {
    let ran: CallMetric | undefined;
    for (const run of chain) {
      const succeeded = !run.failure || (run.answers ?? []).some((answer) => answer.role === role);
      const metric = run.metrics.find((item) => item.role === role && item.source === "live");
      if (metric && succeeded) ran = metric;
    }
    const final = latest.metrics.find((metric) => metric.role === role);
    return {
      role,
      model: ran?.model ?? final?.model ?? null,
      durationMs: ran?.durationMs ?? null,
      costUsd: ran?.costUsd ?? null,
      quality: latest.quality?.[role] ?? null,
    };
  });
  return {
    file: best.file,
    paidAttempts: chain.filter((run) => run.metrics.some((metric) => metric.source === "live")).length,
    chainCostUsd: best.chainCostUsd,
    chainDurationMs: best.chainDurationMs,
    panel: latest.panel,
    seats,
  };
}
