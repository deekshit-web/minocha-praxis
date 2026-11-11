import { findPhi, prdGateIssues, prdIssues, repoRoot, type Prd } from "@northwind/orchestrator";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FEATURE_B_BRIEF, RULES, groundedCitations } from "./panels.ts";

/** One edit to a base PRD: replace text inside one field of one item, or append an item to a section. */
export type DraftEdit =
  | { section: keyof Prd; id: string; field: string; find: string; replace: string }
  | { section: keyof Prd; append: unknown };

export interface PlantedCase {
  id: string;
  base: "live-synthesis" | "recorded";
  /** "seeded" plants one defect; "clean" is a control with none. */
  kind: "seeded" | "clean";
  defect: string;
  /** What a reviewer should notice, in plain words. The jury matches critiques against this. */
  notice: string;
  edits: DraftEdit[];
}

export interface EvalBrief {
  id: string;
  topic: string;
  brief: string;
  answers: Array<{ id: string; question: string; answer: string }>;
  checks: string[];
}

const EVAL_DIR = () => join(repoRoot(), "evals/prd-panel");

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(EVAL_DIR(), file), "utf8")) as T;
}

export function plantedCases(): PlantedCase[] {
  return readJson<{ cases: PlantedCase[] }>("part-a.json").cases;
}

export function evalBriefs(): EvalBrief[] {
  return readJson<{ briefs: EvalBrief[] }>("part-b.json").briefs;
}

export function basePrd(base: PlantedCase["base"]): Prd {
  return readJson<Prd>(`bases/${base}.json`);
}

/**
 * Applies a case's edits to a copy of its base. Each find must match its field exactly once, so an edit that
 * drifts from the base fails loudly instead of silently planting nothing.
 */
export function plantDraft(planted: PlantedCase): Prd {
  const draft = structuredClone(basePrd(planted.base)) as unknown as Record<string, unknown[]>;
  for (const edit of planted.edits) {
    const items = draft[edit.section];
    if (!Array.isArray(items)) throw new Error(`${planted.id}: ${edit.section} is not a list`);
    if ("append" in edit) {
      items.push(structuredClone(edit.append));
      continue;
    }
    const item = (items as Array<Record<string, unknown>>).find((entry) => entry.id === edit.id || entry.answerId === edit.id);
    if (!item) throw new Error(`${planted.id}: no ${edit.section} item ${edit.id}`);
    const text = item[edit.field];
    if (typeof text !== "string") throw new Error(`${planted.id}: ${edit.id}.${edit.field} is not text`);
    const matches = text.split(edit.find).length - 1;
    if (matches !== 1) throw new Error(`${planted.id}: "${edit.find}" matches ${matches} times in ${edit.id}.${edit.field}`);
    item[edit.field] = text.replace(edit.find, edit.replace);
  }
  return draft as unknown as Prd;
}

/** Every code check a PRD meets before a person sees it. A planted defect has to slip past all of them. */
export function codeGateIssues(prd: Prd, brief = FEATURE_B_BRIEF): string[] {
  return [
    ...prdGateIssues(prd, prdIssues(prd, groundedCitations(brief), RULES)),
    ...findPhi(JSON.stringify(prd)).map((finding) => `phi:${finding.kind}`),
  ];
}
