import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { nextUnitAttempt } from "../../orchestrator/src/stall.ts";
import { FeatureBTree, SEEDED_APPEAL_READY } from "./tree.ts";

const FENCE = ["packages/domain/**", "packages/rcm/**"];
const ASSERTIONS = ["AC-CO50-NOTE", "AC-CO50-DEADLINE", "AC-CO50-READY", "AC-PR1-NOT-DENIAL"];

function repoRoot(): string {
  const root = process.env.NORTHWIND_ROOT;
  if (!root) throw new Error("NORTHWIND_ROOT is required");
  return root;
}

function scratch(): { dir: string; tree: FeatureBTree; remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "northwind-tree-"));
  const tree = FeatureBTree.seed(dir, FENCE, ASSERTIONS, repoRoot());
  return { dir, tree, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

test("the seeded tree fails AC-CO50-NOTE, and one fenced patch makes node:test pass", () => {
  const scratchTree = scratch();
  try {
    const red = scratchTree.tree.test();
    assert.equal(red.passed, false);
    assert.match(red.output, /AC-CO50-NOTE/);
    assert.match(red.output, /true/);
    const first = nextUnitAttempt({ priorFingerprints: [], diff: "seed: skip the clinical note", failureOutput: red.output });
    assert.equal(first.action, "retry");

    const wrote = scratchTree.tree.repairClinicalNote();
    assert.equal(wrote.ok, true);
    if (!wrote.ok) return;
    assert.match(wrote.diff, /clinicalNoteRef/);
    assert.ok(wrote.diff.split("\n").every((line) => line.startsWith("- ")));
    assert.equal(wrote.diff.includes("appealReadyBuggy"), false);
    const repaired = scratchTree.tree.read("packages/domain/src/appealReady.ts");
    assert.equal(repaired.includes('field !== "clinicalNoteRef"'), false);
    assert.equal(repaired.includes("appealReadyBuggy"), false);
    const green = scratchTree.tree.test();
    assert.equal(green.passed, true);
    const again = scratchTree.tree.repairClinicalNote();
    assert.equal(again.ok, false);
    const second = nextUnitAttempt({ priorFingerprints: [first.fingerprint], diff: wrote.diff, failureOutput: null });
    assert.equal(second.action, "advance");
  } finally {
    scratchTree.remove();
  }
});

test("a repeated failing patch stalls, and the fence refuses the factory and a deleted assertion", () => {
  const scratchTree = scratch();
  try {
    const red = scratchTree.tree.test();
    const same = scratchTree.tree.write("packages/domain/src/appealReady.ts", SEEDED_APPEAL_READY);
    assert.equal(same.ok, true);
    if (!same.ok) return;
    const again = scratchTree.tree.test();
    const first = nextUnitAttempt({ priorFingerprints: [], diff: same.diff, failureOutput: again.output });
    const second = nextUnitAttempt({ priorFingerprints: [first.fingerprint], diff: same.diff, failureOutput: again.output });
    assert.equal(second.action, "stalled");
    assert.equal(red.passed, false);

    const factory = scratchTree.tree.write("packages/factory/src/page.ts", "export const page = 1;\n");
    assert.equal(factory.ok, false);
    const secret = scratchTree.tree.write(".env", "TOKEN=sk-abcdefgh\n");
    assert.equal(secret.ok, false);
    const outside = scratchTree.tree.write("packages/knowledge/pack/carc-demo.md", "# no\n");
    assert.equal(outside.ok, false);
    const dropped = scratchTree.tree.write("packages/domain/src/appealReady.test.ts", "test('unrelated', () => {});\n");
    assert.equal(dropped.ok, false);
    if (!dropped.ok) assert.match(dropped.reason, /dropped-assertion:AC-CO50-NOTE/);
  } finally {
    scratchTree.remove();
  }
});
