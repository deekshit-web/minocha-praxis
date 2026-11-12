import type { BuildRecording } from "./build.ts";
import type { Recording } from "./record.ts";

/**
 * Judging the findings the reviewers raised. A review is only worth its false alarms: a reviewer that raises many
 * findings that are not problems costs a person's time and teaches them to ignore it. This module pulls every finding
 * out of the live build records, lays them out for two people to rate without knowing which model raised them, and
 * turns their ratings into a false-alarm rate with a confidence interval.
 */

export interface LiveRecord {
  id: string;
  /** A readable name for the build, such as 03-grade-weights. The records are stored under it. */
  label: string;
  domain: string;
  brief: string;
  facts: string;
  panel: Recording;
  build: BuildRecording;
}

export type Stage = "panel-A" | "panel-B" | "panel-final" | "design" | "code";

export const STAGE_LABEL: Record<Stage, string> = {
  "panel-A": "Requirements: review of draft A",
  "panel-B": "Requirements: review of draft B",
  "panel-final": "Requirements: final check of the merged document",
  design: "Design review",
  code: "Code review",
};

export interface Finding {
  /** F01, F02 ... in build order. */
  fid: string;
  build: string;
  stage: Stage;
  /** The model that raised it. Kept out of the rating sheets, so raters do not know. */
  reviewer: string;
  /** The reviewer's own id for it, such as D-A1 or AR-2. */
  id: string;
  severity: "P0" | "P1" | "P2";
  title: string;
  detail: string;
  /** The passage it points at. Requirements findings carry one; design and code findings do not. */
  quote: string;
  /** What the builder did about it. */
  response: { outcome: string; note: string } | null;
}

const SEVERITIES = ["P0", "P1", "P2"] as const;

/** Reads the findings from a design or code review, which is stored as text: "AR-1 · P0 · Title" then an indented line. */
function findingsFromText(text: string, prefix: "AR" | "CR"): Array<{ id: string; severity: Finding["severity"]; title: string; detail: string }> {
  const found: Array<{ id: string; severity: Finding["severity"]; title: string; detail: string }> = [];
  const header = new RegExp(`^(${prefix}-\\d+) · (P[012]) · (.+)$`);
  let current: (typeof found)[number] | null = null;
  for (const line of text.split("\n")) {
    const match = line.match(header);
    if (match) {
      current = { id: match[1]!, severity: match[2] as Finding["severity"], title: match[3]!.trim(), detail: "" };
      found.push(current);
    } else if (current && /^\s+\S/.test(line)) current.detail = `${current.detail} ${line.trim()}`.trim();
    else if (/^Strengths:/.test(line)) current = null;
  }
  return found;
}

/** The builder's answer to design and code findings: lines such as "AR-1 · P0 · Title applied: what it did". */
function answersFromText(text: string, prefix: "AR" | "CR"): Map<string, { outcome: string; note: string }> {
  const answers = new Map<string, { outcome: string; note: string }>();
  for (const line of text.split("\n")) {
    const match = line.match(new RegExp(`^(${prefix}-\\d+)\\b.*?\\b(applied|declined):\\s*(.*)$`));
    if (match) answers.set(match[1]!, { outcome: match[2]!, note: match[3]!.trim() });
  }
  return answers;
}

const modelOf = (calls: Array<{ role: string; model: string }>, role: string) => calls.find((call) => call.role === role)?.model ?? "unknown";

/** Every finding in one record, in the order the stages ran. */
export function extractFindings(record: LiveRecord): Omit<Finding, "fid">[] {
  const out: Omit<Finding, "fid">[] = [];
  const panel = record.panel;
  const idOf = (text: string) => text.match(/D-[ABF]\d+/)?.[0];
  const answer = (list: Array<{ finding: string; outcome: string; note: string }> | undefined, id: string) => {
    const match = (list ?? []).find((item) => idOf(item.finding) === id);
    return match ? { outcome: match.outcome, note: match.note } : null;
  };
  const stages: Array<[Stage, "reviewOfA" | "reviewOfB" | "finalReview", string, Array<{ finding: string; outcome: string; note: string }> | undefined]> = [
    ["panel-A", "reviewOfA", "critiqueOfA", panel.merge.resolutions],
    ["panel-B", "reviewOfB", "critiqueOfB", panel.merge.resolutions],
    ["panel-final", "finalReview", "finalReview", panel.finalFix?.resolutions],
  ];
  for (const [stage, key, role, resolutions] of stages) {
    const review = panel[key];
    if (!review) continue;
    for (const item of review.findings) out.push({ build: record.label, stage, reviewer: modelOf(panel.calls, role), id: item.id, severity: item.severity, title: item.title, detail: item.detail, quote: item.quote, response: answer(resolutions, item.id) });
  }
  const design = answersFromText(record.build.architecture.resolutions, "AR");
  for (const item of findingsFromText(record.build.architecture.review, "AR")) out.push({ build: record.label, stage: "design", reviewer: modelOf(record.build.calls, "archReview"), ...item, quote: "", response: design.get(item.id) ?? null });
  const code = answersFromText(record.build.code.resolutions, "CR");
  for (const item of findingsFromText(record.build.code.review, "CR")) out.push({ build: record.label, stage: "code", reviewer: modelOf(record.build.calls, "codeReview"), ...item, quote: "", response: code.get(item.id) ?? null });
  return out;
}

/** All findings of all records, numbered F01, F02 ... in build order. */
export function collectFindings(records: LiveRecord[]): Finding[] {
  const sorted = [...records].sort((a, b) => a.label.localeCompare(b.label));
  const all = sorted.flatMap((record) => extractFindings(record));
  const width = Math.max(2, String(all.length).length);
  return all.map((item, at) => ({ ...item, fid: `F${String(at + 1).padStart(width, "0")}` }));
}

// ---- CSV ----

/** Writes rows as CSV, quoting any field that holds a comma, a quote or a line break. */
export function toCsv(rows: string[][]): string {
  const cell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  return `${rows.map((row) => row.map(cell).join(",")).join("\n")}\n`;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]!;
    if (quoted) {
      if (char === '"' && text[at + 1] === '"') {
        field += '"';
        at += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[at + 1] === "\n") at += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((value) => value !== "")) rows.push(row);
  }
  return rows;
}

export const RATING_COLUMNS = ["real", "severity_check", "resolution_check", "comment"] as const;
const SHEET_COLUMNS = ["fid", "build", "stage", "severity", "title", "reviewer_explanation", "passage", "builder_response", "builder_note", ...RATING_COLUMNS];

/** The sheet a rater fills in. It never says which model raised a finding. */
export function ratingSheet(findings: Finding[]): string {
  return toCsv([
    SHEET_COLUMNS,
    ...findings.map((item) => [item.fid, item.build, STAGE_LABEL[item.stage], item.severity, item.title, item.detail, item.quote, item.response?.outcome ?? "no answer recorded", item.response?.note ?? "", "", "", "", ""]),
  ]);
}

/** Which model raised each finding, and where. Kept apart from the sheets so the ratings stay blind. */
export function ratingKey(findings: Finding[]): Record<string, { build: string; stage: Stage; findingId: string; severity: Finding["severity"]; reviewer: string }> {
  return Object.fromEntries(findings.map((item) => [item.fid, { build: item.build, stage: item.stage, findingId: item.id, severity: item.severity, reviewer: item.reviewer }]));
}

// ---- Packets ----

const fence = (text: string) => `\`\`\`\n${text.trim()}\n\`\`\``;

/** One build as a readable page: the brief, the findings to rate, and the text each finding is about. */
export function packetFor(record: LiveRecord, findings: Finding[]): string {
  const mine = findings.filter((item) => item.build === record.label);
  const artifact: Record<Stage, [string, string]> = {
    "panel-A": ["Draft A of the requirements", record.panel.draftA],
    "panel-B": ["Draft B of the requirements", record.panel.draftB],
    "panel-final": ["The merged requirements, before the final fix", record.panel.merge.document],
    design: ["The design Model A first wrote", record.build.architecture.draft],
    code: ["The code Model A first wrote", record.build.code.first],
  };
  const lines = [
    `# Build ${record.label} (${record.domain})`,
    "",
    "Rate each finding below on the sheet `rater-N.csv`, using its number (F01 and so on). Read the text it points at under",
    '"What was reviewed" at the end of this page. All data is made up.',
    "",
    "## The brief",
    "",
    fence(record.brief),
    "",
    "## The facts it was given",
    "",
    fence(record.facts || "(none)"),
    "",
    mine.length ? `## Findings to rate (${mine.map((item) => item.fid).join(", ")})` : "## Findings to rate\n\nThe reviewers raised no findings in this build. There is nothing to rate.",
  ];
  for (const item of mine) {
    lines.push("", `### ${item.fid} · ${STAGE_LABEL[item.stage]} · rated ${item.severity}`, "", `**${item.title}**`, "", item.detail);
    if (item.quote) lines.push("", "The passage it points at:", "", `> ${item.quote.replaceAll("\n", "\n> ")}`);
    lines.push("", item.response ? `What the builder did: **${item.response.outcome}**. ${item.response.note}` : "What the builder did: no answer was recorded.");
  }
  const shown = [...new Set(mine.map((item) => item.stage))];
  if (shown.length) lines.push("", "## What was reviewed");
  for (const stage of shown) lines.push("", `### ${artifact[stage][0]}`, "", fence(artifact[stage][1]));
  return `${lines.join("\n")}\n`;
}

export const RATER_README = `# Rating the findings

Ten live builds raised 29 findings in all. This folder lets two people rate them, each on their own, so that we can
measure how often a reviewer raises a finding that is not a real problem (a false alarm), and how well two people agree.

## How to rate

1. Copy nothing. Open your own sheet, \`rater-1.csv\` or \`rater-2.csv\`, in a spreadsheet or a text editor.
2. For each finding, read its page in \`packets/\` (one per build). The brief and facts are at the top. The text the
   finding is about is at the end.
3. Fill in the last four columns. Do **not** look at the other rater's sheet, \`key.json\` or any report first.

| Column | Answer with | Meaning |
| --- | --- | --- |
| \`real\` | \`yes\`, \`partly\`, \`no\` or \`unsure\` | **yes**: the problem exists as the reviewer describes. **partly**: something is wrong, but the description is wrong or overstated. **no**: a false alarm; the text is right, or the reviewer misread it. |
| \`severity_check\` | \`right\`, \`too_high\` or \`too_low\` | P0 would give a wrong result, break a rule or be a security problem. P1 should be fixed. P2 is optional. |
| \`resolution_check\` | \`good\`, \`bad\` or \`unsure\` | Was the builder's response right: a proper fix, or a sound reason for declining? |
| \`comment\` | free text | Anything the others should know. Required when you answer \`partly\` or \`no\`. |

Check claims yourself where you can. For code, run it. In the earlier write-up a claim about JavaScript was taken on trust
and was wrong.

## When both have finished

\`npm run judging-analyze\` reads the two sheets and writes \`report.md\`: the false-alarm rate with a 95% interval, by
severity, stage and reviewing model, how well the two raters agree, and the findings they disagree on.

The findings are not a random sample of everything a reviewer might say. They come from ten small builds. Read the
report with that in mind.
`;

// ---- Analysis ----

export interface Rating {
  real: "yes" | "partly" | "no" | "unsure" | "";
  severity: "right" | "too_high" | "too_low" | "";
  resolution: "good" | "bad" | "unsure" | "";
  comment: string;
}

export function parseRatings(csv: string): Map<string, Rating> {
  const rows = parseCsv(csv);
  const header = rows[0] ?? [];
  const at = (name: string) => header.indexOf(name);
  const out = new Map<string, Rating>();
  for (const row of rows.slice(1)) {
    const fid = row[at("fid")]?.trim();
    if (!fid) continue;
    const pick = (name: string) => (row[at(name)] ?? "").trim().toLowerCase();
    out.set(fid, { real: pick("real") as Rating["real"], severity: pick("severity_check") as Rating["severity"], resolution: pick("resolution_check") as Rating["resolution"], comment: row[at("comment")]?.trim() ?? "" });
  }
  return out;
}

/** The share k of n with a 95% Wilson interval. Good for small n, and it never leaves 0 to 1. */
export function wilson(k: number, n: number, z = 1.96): { rate: number; low: number; high: number } {
  if (n === 0) return { rate: Number.NaN, low: Number.NaN, high: Number.NaN };
  const p = k / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return { rate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** Cohen's kappa for two raters who each said yes or no to the same items. 1 is perfect, 0 is no better than chance. */
export function cohenKappa(a: boolean[], b: boolean[]): number {
  const n = a.length;
  if (n === 0) return Number.NaN;
  const agree = a.filter((value, at) => value === b[at]).length / n;
  const yesA = a.filter(Boolean).length / n;
  const yesB = b.filter(Boolean).length / n;
  const chance = yesA * yesB + (1 - yesA) * (1 - yesB);
  return chance === 1 ? 1 : (agree - chance) / (1 - chance);
}

export type Verdict = "real" | "false alarm" | "disputed" | "unrated";
const isReal = (rating: Rating) => rating.real === "yes" || rating.real === "partly";

export interface Share {
  k: number;
  n: number;
  rate: number;
  low: number;
  high: number;
}
const share = (k: number, n: number): Share => ({ k, n, ...wilson(k, n) });

export interface Report {
  findings: number;
  raters: Array<{ name: string; rated: number }>;
  verdicts: Record<string, Verdict>;
  counts: Record<Verdict, number>;
  /** A finding is a false alarm when every rater who decided said no. */
  falseAlarm: Share;
  /** A finding is a false alarm when any rater who decided said no. */
  falseAlarmLenient: Share;
  agreement: { compared: number; agreed: number; kappa: number } | null;
  bySeverity: Record<string, Share>;
  byStage: Record<string, Share>;
  byReviewer: Record<string, Share>;
  tooHigh: Share;
  badResolution: Share;
  disputed: string[];
}

/** Turns the raters' sheets into the numbers. */
export function analyze(key: ReturnType<typeof ratingKey>, raters: Array<{ name: string; ratings: Map<string, Rating> }>): Report {
  const fids = Object.keys(key);
  const decided = (rating: Rating | undefined) => !!rating && (rating.real === "yes" || rating.real === "partly" || rating.real === "no");
  const verdicts: Record<string, Verdict> = {};
  for (const fid of fids) {
    const votes = raters.map((rater) => rater.ratings.get(fid)).filter(decided) as Rating[];
    verdicts[fid] = !votes.length ? "unrated" : votes.every(isReal) ? "real" : votes.every((rating) => !isReal(rating)) ? "false alarm" : "disputed";
  }
  const counts: Record<Verdict, number> = { real: 0, "false alarm": 0, disputed: 0, unrated: 0 };
  for (const verdict of Object.values(verdicts)) counts[verdict] += 1;
  const settled = (list: string[]) => list.filter((fid) => verdicts[fid] === "real" || verdicts[fid] === "false alarm");
  const falseIn = (list: string[]) => share(list.filter((fid) => verdicts[fid] === "false alarm").length, settled(list).length);
  const group = (by: (fid: string) => string) => {
    const keys = [...new Set(fids.map(by))].sort();
    return Object.fromEntries(keys.map((name) => [name, falseIn(fids.filter((fid) => by(fid) === name))]));
  };
  const lenient = fids.filter((fid) => verdicts[fid] !== "unrated");
  const anyNo = lenient.filter((fid) => raters.some((rater) => rater.ratings.get(fid)?.real === "no")).length;
  let agreement: Report["agreement"] = null;
  const both = raters.length >= 2 ? fids.filter((fid) => decided(raters[0]!.ratings.get(fid)) && decided(raters[1]!.ratings.get(fid))) : [];
  if (both.length) {
    const first = both.map((fid) => isReal(raters[0]!.ratings.get(fid)!));
    const second = both.map((fid) => isReal(raters[1]!.ratings.get(fid)!));
    agreement = { compared: both.length, agreed: first.filter((value, at) => value === second[at]).length, kappa: cohenKappa(first, second) };
  }
  const rated = fids.filter((fid) => verdicts[fid] !== "unrated");
  const anyRating = (fid: string, pick: (rating: Rating) => boolean) => raters.some((rater) => {
    const rating = rater.ratings.get(fid);
    return !!rating && pick(rating);
  });
  return {
    findings: fids.length,
    raters: raters.map((rater) => ({ name: rater.name, rated: fids.filter((fid) => decided(rater.ratings.get(fid))).length })),
    verdicts,
    counts,
    falseAlarm: falseIn(fids),
    falseAlarmLenient: share(anyNo, lenient.length),
    agreement,
    bySeverity: group((fid) => key[fid]!.severity),
    byStage: group((fid) => STAGE_LABEL[key[fid]!.stage]),
    byReviewer: group((fid) => key[fid]!.reviewer),
    tooHigh: share(rated.filter((fid) => anyRating(fid, (rating) => rating.severity === "too_high")).length, rated.length),
    badResolution: share(rated.filter((fid) => anyRating(fid, (rating) => rating.resolution === "bad")).length, rated.length),
    disputed: fids.filter((fid) => verdicts[fid] === "disputed"),
  };
}

const pct = (value: number) => (Number.isNaN(value) ? "n/a" : `${Math.round(value * 100)}%`);
const shareText = (value: Share) => (value.n ? `${value.k} of ${value.n} (${pct(value.rate)}, 95% interval ${pct(value.low)} to ${pct(value.high)})` : "nothing rated");

export function renderReport(report: Report): string {
  const table = (title: string, groups: Record<string, Share>) => [`### ${title}`, "", "| | False alarms |", "| --- | --- |", ...Object.entries(groups).map(([name, value]) => `| ${name} | ${shareText(value)} |`), ""];
  return [
    "# Finding ratings: the report",
    "",
    `${report.findings} findings. Raters: ${report.raters.map((rater) => `${rater.name} (${rater.rated} rated)`).join(", ") || "none"}.`,
    "",
    "## The result",
    "",
    `- **False alarms (every rater who decided said no):** ${shareText(report.falseAlarm)}.`,
    `- **False alarms (any rater said no):** ${shareText(report.falseAlarmLenient)}.`,
    `- **Severity too high (any rater said so):** ${shareText(report.tooHigh)}.`,
    `- **Builder's response judged bad (any rater said so):** ${shareText(report.badResolution)}.`,
    `- Real ${report.counts.real}, false alarm ${report.counts["false alarm"]}, disputed ${report.counts.disputed}, not rated ${report.counts.unrated}.`,
    report.agreement ? `- **Agreement:** the two raters agreed on ${report.agreement.agreed} of ${report.agreement.compared} findings (kappa ${report.agreement.kappa.toFixed(2)}). Below about 0.4 the ratings are too noisy to trust.` : "- Agreement: needs two raters.",
    "",
    "A false alarm rate from 29 findings has a wide interval. Treat it as a range.",
    "",
    ...table("By severity as raised", report.bySeverity),
    ...table("By where the finding was raised", report.byStage),
    ...table("By the model that raised it", report.byReviewer),
    "### Disputed findings",
    "",
    report.disputed.length ? report.disputed.join(", ") : "None.",
    "",
  ].join("\n");
}
