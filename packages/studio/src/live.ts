import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { callCost, findPhi } from "@northwind/orchestrator";
import { type BuildOptions, type BuildRecording, liveBuildSeats, recordBuild } from "./build.ts";
import { askJev } from "./jev.ts";
import { type PanelProgress, type Recording, livePanel, panelContext, recordPanel } from "./record.ts";
import { DOMAINS, type DomainId, type WorkflowSpec, decisionFor, formatDecision } from "./workflows.ts";

/**
 * "Bring your own brief": a visitor with the passcode runs the real panel on their own request. Model C routes
 * it first; a low-risk request goes to one model, anything else to the full two-model panel. Guarded by a
 * passcode, a patient-data scan, length limits, one run at a time, an hourly limit and a daily spend cap.
 */

export interface LiveInput {
  passcode: string;
  domain: string;
  kind: string;
  brief: string;
  facts?: string;
}

export interface LiveEvent {
  role: string;
  label: string;
  model: string;
  seconds: number;
  costUsd: number;
  text: string;
}

export interface LiveJob {
  id: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  domain: string;
  /** "fullbuild" runs the requirements panel and then every build stage on live models. */
  kind: "build" | "document" | "fullbuild";
  brief: string;
  route: { text: string; live: boolean; path: "panel" | "single" } | null;
  events: LiveEvent[];
  final: string | null;
  /** For a full build: every recorded stage, to be replayed in the stage view. */
  build: BuildRecording | null;
  findings: number;
  costUsd: number;
  seconds: number;
  error: string | null;
}

export interface LiveRunners {
  /** Runs the full two-model panel, reporting each call. */
  panel(spec: WorkflowSpec, onProgress: PanelProgress): Promise<Recording>;
  /** Runs the cheap path: one model drafts. */
  single(spec: WorkflowSpec): Promise<LiveEvent>;
  /** Runs every build stage on the approved requirements, reporting each call and each test run. */
  build(spec: WorkflowSpec, prd: string, options: BuildOptions): Promise<BuildRecording>;
  /** Asks Model C the routing questions; null when the decision model is unavailable. */
  route(spec: WorkflowSpec): Promise<{ text: string; low: boolean } | null>;
}

export interface LiveOptions {
  passcode?: string;
  dailyCapUsd?: number;
  /** What one run is assumed to cost before it starts, for the cap check. */
  runEstimateUsd?: number;
  runsPerHour?: number;
  /** Switches on the full build. Off by default: model-written code runs on this server, so only trusted staging enables it. */
  fullBuild?: boolean;
  /** The most one full build may cost, the requirements panel included. */
  fullBuildCapUsd?: number;
  /** The longest one full build may run. */
  fullBuildMaxSeconds?: number;
  runners: LiveRunners;
  now?: () => number;
}

const LABELS: Record<string, string> = {
  analystA: "Model A writes draft A",
  analystB: "Model B writes draft B",
  critiqueOfB: "Model A reviews draft B",
  critiqueOfA: "Model B reviews draft A",
  synthesizer: "Model A merges both drafts",
  finalReview: "Model B checks the final document",
  finalFix: "Model A fixes what the final check found",
  single: "Model A writes it (one model, routed as low risk)",
  contractDraft: "Model A drafts the module contract",
  contractReview: "Model B checks the contract can be tested",
  contractFinal: "Model A revises the contract",
  archDraft: "Model A designs the architecture",
  archReview: "Model B reviews the design",
  archFinal: "Model A revises the design",
  code: "Model A writes the code",
  codeReview: "Model B reviews the code",
  codeRevise: "Model A applies the review",
  unitTests: "Model A writes unit tests for its own code",
  testCases: "Model B writes test cases from the PRD",
  testScript: "Model B writes the test script, without seeing the code",
  run1: "Tests run on the code",
  run2: "Tests run again after a fix",
  run3: "Tests run a third time after a fix",
  fix1: "Model A fixes the failing tests",
  fix2: "Model A fixes the failing tests again",
};

const digest = (text: string) => createHash("sha256").update(text).digest();

/** The visitor's request as a workflow the panel can run. */
export function specFor(input: { domain: DomainId; kind: "build" | "document"; brief: string; facts?: string }, id: string): WorkflowSpec {
  return {
    id,
    domain: input.domain,
    kind: input.kind,
    title: "A visitor's request",
    summary: input.brief.slice(0, 160),
    deliverable: input.kind === "build" ? "The requirements for this feature" : "The document or decision asked for",
    project: "A booth visitor's project",
    requester: "Booth visitor",
    brief: input.brief,
    sources: input.facts || undefined,
    draftA: "",
    draftB: "",
    reviewOfA: "",
    reviewOfB: "",
    synthesis: "",
    checks: [],
    approval: "",
    output: "",
    contrast: null,
  } as WorkflowSpec;
}

export function createLiveService(options: LiveOptions) {
  const passcode = options.passcode ?? "";
  const cap = options.dailyCapUsd ?? 2;
  const estimate = options.runEstimateUsd ?? 0.25;
  const perHour = options.runsPerHour ?? 6;
  const buildCap = options.fullBuildCapUsd ?? 0.75;
  const buildSeconds = options.fullBuildMaxSeconds ?? 60 * 60;
  const now = options.now ?? Date.now;
  const jobs = new Map<string, LiveJob>();
  let day = "";
  let spent = 0;
  let starts: number[] = [];
  let busy = false;

  const today = () => {
    const current = new Date(now()).toISOString().slice(0, 10);
    if (current !== day) {
      day = current;
      spent = 0;
    }
  };

  async function run(job: LiveJob, spec: WorkflowSpec) {
    const started = now();
    try {
      const route = await options.runners.route(spec);
      const full = job.kind === "fullbuild";
      // A full build always runs the whole panel: the router still reports its risk, but it cannot send a feature to one model.
      job.route = route ? { text: route.text, live: true, path: route.low && !full ? "single" : "panel" } : null;
      const record = (role: string, call: { model: string; seconds: number; costUsd: number } | null, text: string) => {
        job.events.push({ role, label: LABELS[role] ?? role, model: call?.model ?? "sandbox", seconds: call?.seconds ?? 0, costUsd: call?.costUsd ?? 0, text });
        job.costUsd = job.events.reduce((total, event) => total + event.costUsd, 0);
      };
      if (route?.low && !full) {
        const event = await options.runners.single(spec);
        job.events.push(event);
        job.final = event.text;
      } else {
        const recording = await options.runners.panel(spec, ({ role, call, text }) => record(role, call, text));
        job.final = recording.finalFix?.document ?? recording.merge.document;
        job.findings = recording.reviewOfA.findings.length + recording.reviewOfB.findings.length + (recording.finalReview?.findings.length ?? 0);
        if (full) {
          // The approved requirements go on to design, code, review, tests and runs, inside one cost and time limit.
          const build = await options.runners.build(spec, job.final, {
            maxCostUsd: Math.max(0, buildCap - job.costUsd),
            maxSeconds: buildSeconds,
            onProgress: ({ role, call, text }) => record(role, call, text),
          });
          job.build = build;
          const last = build.runs[build.runs.length - 1];
          job.findings += (build.architecture.review.match(/^AR-\d/gm) ?? []).length + (build.code.review.match(/^CR-\d/gm) ?? []).length;
          job.final = `Requirements and design, approved\n\nThe module contract:\n${build.contract}\n\nThe code, after review and ${build.fixes.length} fix round${build.fixes.length === 1 ? "" : "s"}:\n${build.finalCode}\n\nThe last test run (${last?.failing ? `${last.failing} failing` : "all passing"}):\n${last?.acceptance ?? ""}`;
        }
      }
      job.status = "done";
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message.slice(0, 200) : "the run failed";
    } finally {
      job.costUsd = job.events.reduce((total, event) => total + event.costUsd, 0);
      job.seconds = Math.round((now() - started) / 1000);
      today();
      spent += job.costUsd;
      busy = false;
    }
  }

  return {
    enabled: Boolean(passcode),
    status() {
      today();
      return { enabled: Boolean(passcode), busy, spentTodayUsd: spent, capUsd: cap, fullBuild: Boolean(options.fullBuild), fullBuildCapUsd: buildCap };
    },
    job(id: string): LiveJob | null {
      return jobs.get(id) ?? null;
    },
    /** Starts a run, or says why not. The run continues in the background; poll job(id). */
    submit(input: LiveInput): { jobId: string } | { error: string; status: number } {
      if (!passcode) return { error: "Live runs are not switched on here.", status: 404 };
      if (typeof input.passcode !== "string" || !timingSafeEqual(digest(input.passcode), digest(passcode))) return { error: "That passcode is not right.", status: 403 };
      const domain = DOMAINS.find((item) => item.id === input.domain);
      if (!domain) return { error: "Pick a domain.", status: 400 };
      if (input.kind !== "build" && input.kind !== "document" && input.kind !== "fullbuild") return { error: "Pick build a feature or produce a document.", status: 400 };
      if (input.kind === "fullbuild" && !options.fullBuild) return { error: "Full builds are not switched on here.", status: 404 };
      const brief = String(input.brief ?? "").trim();
      const facts = String(input.facts ?? "").trim();
      if (brief.length < 20) return { error: "Write a brief of at least a sentence.", status: 400 };
      if (brief.length > 1500 || facts.length > 2000) return { error: "Keep the brief under 1,500 characters and the facts under 2,000.", status: 400 };
      if (findPhi(`${brief}\n${facts}`).length) return { error: "That looks like personal data. Please describe the case with made-up names and ids.", status: 400 };
      today();
      if (busy) return { error: "Another live run is in progress. Try again in a few minutes.", status: 429 };
      starts = starts.filter((at) => now() - at < 60 * 60 * 1000);
      if (starts.length >= perHour) return { error: "The hourly limit on live runs is reached. Try again later.", status: 429 };
      if (spent + (input.kind === "fullbuild" ? buildCap : estimate) > cap) return { error: "Today's budget for live runs is used up.", status: 429 };
      busy = true;
      starts.push(now());
      const id = randomUUID().slice(0, 8);
      const job: LiveJob = {
        id,
        status: "running",
        startedAt: new Date(now()).toISOString(),
        domain: domain.name,
        kind: input.kind,
        brief,
        route: null,
        events: [],
        final: null,
        build: null,
        findings: 0,
        costUsd: 0,
        seconds: 0,
        error: null,
      };
      jobs.set(id, job);
      if (jobs.size > 20) jobs.delete(jobs.keys().next().value as string);
      void run(job, specFor({ domain: domain.id, kind: input.kind === "fullbuild" ? "build" : input.kind, brief, facts }, `live-${id}`));
      return { jobId: id };
    },
  };
}

/** The real runners: Jev routes, Claude and Grok run the panel, Claude alone on the cheap path. */
export function liveRunners(): LiveRunners {
  const domainName = (spec: WorkflowSpec) => DOMAINS.find((item) => item.id === spec.domain)?.name ?? spec.domain;
  return {
    panel: (spec, onProgress) => recordPanel(spec, livePanel(spec, domainName(spec)), undefined, onProgress),
    async single(spec) {
      // The cheap path is Model A's draft alone: the panel's first call, and nothing after it.
      const panel = livePanel(spec, domainName(spec));
      const started = Date.now();
      const answer = await panel.claude.complete({ role: "analystA", prompt: "Write your draft." });
      const usage = answer.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      return {
        role: "single",
        label: LABELS.single ?? "single",
        model: answer.model ?? "",
        seconds: Math.round((Date.now() - started) / 100) / 10,
        costUsd: callCost(answer.model ?? "claude-opus-5-5", usage) ?? 0,
        text: (JSON.parse(answer.text) as { text: string }).text,
      };
    },
    build: (spec, prd, options) => recordBuild(spec, prd, liveBuildSeats(panelContext(spec, domainName(spec))), undefined, options),
    async route(spec) {
      const decision = decisionFor(spec, "route");
      if (!decision || !process.env.JEV_API_KEY) return null;
      try {
        const questions = Object.fromEntries(decision.questions.map((question) => [question.key, { type: question.type, instructions: question.instructions, ...(question.criteria ? { criteria: question.criteria } : {}) }]));
        const answer = await askJev(decision.state, questions);
        const risk = answer.answers.risk;
        const single = answer.answers.single;
        const low = risk?.type === "choice" && risk.choice === "low" && single?.type === "noul" && single.noul >= 0.7;
        return { text: formatDecision(decision, answer.answers), low };
      } catch {
        return null;
      }
    },
  };
}
