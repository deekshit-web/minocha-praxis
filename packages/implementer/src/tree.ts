import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { fenceViolations } from "../../orchestrator/src/fence.ts";
import { missingAssertions } from "../../orchestrator/src/documents.ts";

const PRODUCT = "packages/domain/src/appealReady.ts";
const TEST = "packages/domain/src/appealReady.test.ts";
const CARC = "packages/domain/src/carc.ts";

/** The branch AC-CO50-NOTE names. The repair deletes this and nothing else. */
const NOTE_BYPASS = `  if (input.carc === "CO-50") {
    const kept = missing.filter((field) => field !== "clinicalNoteRef");
    if (kept.length === 0) return { ready: true, missing: [], reason: "ready" };
    return { ready: false, missing: kept, reason: "incomplete" };
  }
`;

/** The starting tree. appealReady ignores a missing clinical note on CO-50. */
export const SEEDED_APPEAL_READY = `import { carcRule } from "./carc.ts";

export interface ReadinessInput {
  carc: string;
  clinicalNoteRef: string | null;
  filingDeadline: string | null;
}

export type MissingField = "clinicalNoteRef" | "filingDeadline";

export interface Readiness {
  ready: boolean;
  missing: MissingField[];
  reason: "not-a-denial" | "not-in-gate" | "incomplete" | "ready" | "unmapped";
}

const NOTE_GATE = new Set(["CO-50"]);

function blank(value: string | null): boolean {
  return value === null || value.trim() === "";
}

/** Seeded defect: CO-50 is ready when the deadline is present, even with no clinical note. */
export function appealReady(input: ReadinessInput): Readiness {
  const rule = carcRule(input.carc);
  if (!rule) return { ready: false, missing: [], reason: "unmapped" };
  if (rule.carcClass !== "denial") return { ready: false, missing: [], reason: "not-a-denial" };
  if (!NOTE_GATE.has(input.carc)) return { ready: true, missing: [], reason: "not-in-gate" };

  const missing: MissingField[] = [];
  if (blank(input.clinicalNoteRef)) missing.push("clinicalNoteRef");
  if (blank(input.filingDeadline)) missing.push("filingDeadline");
${NOTE_BYPASS}  if (missing.length > 0) return { ready: false, missing, reason: "incomplete" };
  return { ready: true, missing: [], reason: "ready" };
}
`;

const SEEDED_TEST = `import assert from "node:assert/strict";
import test from "node:test";
import { appealReady } from "./appealReady.ts";

test("AC-CO50-NOTE blocks ready when the clinical note reference is missing", () => {
  const result = appealReady({ carc: "CO-50", clinicalNoteRef: null, filingDeadline: "2026-12-01" });
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ["clinicalNoteRef"]);
});

test("AC-CO50-DEADLINE blocks ready when the filing deadline is missing", () => {
  const result = appealReady({ carc: "CO-50", clinicalNoteRef: "DOC-014", filingDeadline: null });
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ["filingDeadline"]);
});

test("AC-CO50-READY allows the packet when the note and the deadline are present", () => {
  const result = appealReady({ carc: "CO-50", clinicalNoteRef: "DOC-003", filingDeadline: "2026-11-30" });
  assert.equal(result.ready, true);
});

test("AC-PR1-NOT-DENIAL refuses an appeal on deductible patient responsibility", () => {
  const result = appealReady({ carc: "PR-1", clinicalNoteRef: "DOC-001", filingDeadline: "2026-12-01" });
  assert.equal(result.ready, false);
  assert.equal(result.reason, "not-a-denial");
});
`;

export interface TreeWrite {
  ok: true;
  diff: string;
}

export interface TreeRefusal {
  ok: false;
  reason: string;
}

export interface UnitRun {
  passed: boolean;
  output: string;
}

function textDiff(before: string, after: string): string {
  if (before === after) return "";
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let start = 0;
  const shared = Math.min(beforeLines.length, afterLines.length);
  while (start < shared && beforeLines[start] === afterLines[start]) start += 1;
  let endBefore = beforeLines.length;
  let endAfter = afterLines.length;
  while (endBefore > start && endAfter > start && beforeLines[endBefore - 1] === afterLines[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const lines: string[] = [];
  for (let index = start; index < endBefore; index += 1) lines.push(`- ${beforeLines[index]}`);
  for (let index = start; index < endAfter; index += 1) lines.push(`+ ${afterLines[index]}`);
  return lines.join("\n");
}

function insideRoot(root: string, file: string): string | null {
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) return null;
  const full = join(root, normalized);
  const fromRoot = relative(root, full);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) return null;
  return full;
}

/** A scratch product tree. Writes stay inside the approved file fence, and P0 assertion ids cannot be deleted. */
export class FeatureBTree {
  private constructor(
    readonly root: string,
    private readonly fence: string[],
    private readonly assertionIds: string[],
    private readonly esbuild: string,
  ) {}

  static seed(root: string, fence: string[], assertionIds: string[], repoRoot: string): FeatureBTree {
    const tree = new FeatureBTree(root, fence, assertionIds, join(repoRoot, "tools/esbuild/esbuild"));
    const carc = readFileSync(join(repoRoot, CARC), "utf8");
    for (const [file, contents] of [
      [CARC, carc],
      [PRODUCT, SEEDED_APPEAL_READY],
      [TEST, SEEDED_TEST],
    ] as const) {
      const wrote = tree.write(file, contents);
      if (!wrote.ok) throw new Error(wrote.reason);
    }
    return tree;
  }

  /**
   * Delete the seeded CO-50 branch that drops clinicalNoteRef.
   * The edit is applied to the sandbox file. The repo oracle is not read.
   */
  repairClinicalNote(): TreeWrite | TreeRefusal {
    let current: string;
    try {
      current = this.read(PRODUCT);
    } catch {
      return { ok: false, reason: "repair-target-missing" };
    }
    if (!current.includes(NOTE_BYPASS)) return { ok: false, reason: "repair-target-missing" };
    return this.write(PRODUCT, current.replace(NOTE_BYPASS, ""));
  }

  read(file: string): string {
    const full = insideRoot(this.root, file);
    if (!full) throw new Error("path-escape");
    return readFileSync(full, "utf8");
  }

  write(file: string, contents: string): TreeWrite | TreeRefusal {
    const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
    const violations = fenceViolations([normalized], this.fence);
    if (violations.length > 0) return { ok: false, reason: `${violations[0]?.reason}:${normalized}` };
    if (normalized.endsWith(".test.ts")) {
      const dropped = missingAssertions(contents, this.assertionIds);
      if (dropped.length > 0) return { ok: false, reason: `dropped-assertion:${dropped[0]}` };
    }
    const full = insideRoot(this.root, normalized);
    if (!full) return { ok: false, reason: `path-escape:${normalized}` };
    const before = exists(full) ? readFileSync(full, "utf8") : "";
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
    return { ok: true, diff: textDiff(before, contents) };
  }

  /** Bundle the seeded test with esbuild and run it under node:test. Vitest is not installed. */
  test(): UnitRun {
    const outfile = join(this.root, "unit.test.mjs");
    const bundled = spawnSync(this.esbuild, [join(this.root, TEST), "--bundle", "--platform=node", "--format=esm", `--outfile=${outfile}`], {
      encoding: "utf8",
    });
    if (bundled.status !== 0) {
      return { passed: false, output: `${bundled.stdout ?? ""}${bundled.stderr ?? ""}`.trim() };
    }
    const env = { ...process.env };
    // The harness itself is node --test. A child inherits NODE_TEST_CONTEXT and then skips the file, exiting 0.
    delete env.NODE_TEST_CONTEXT;
    const ran = spawnSync(process.execPath, ["--test", outfile], { encoding: "utf8", env });
    const output = `${ran.stdout ?? ""}${ran.stderr ?? ""}`.trim();
    return { passed: ran.status === 0, output };
  }
}

function exists(file: string): boolean {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}

export function failureExcerpt(output: string): string {
  const lines = output.split("\n").filter((line) => /AC-CO50-NOTE|AssertionError|!==/.test(line));
  const picked = (lines.length > 0 ? lines : output.split("\n").slice(-8)).slice(0, 12);
  return picked.join("\n");
}
