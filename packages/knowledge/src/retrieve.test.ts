import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadPack, retrieve } from "./retrieve.ts";

const packRoot = process.env.NORTHWIND_ROOT
  ? join(process.env.NORTHWIND_ROOT, "packages/knowledge/pack")
  : join(dirname(fileURLToPath(import.meta.url)), "../pack");

test("retrieval cites the CARC table, the payer rule, and the PHI policy for a CO-50 brief", () => {
  const chunks = loadPack(packRoot);
  const found = retrieve(chunks, ["co-50", "phi", "timely-filing", "denial"]);
  const paths = found.map((chunk) => chunk.path);
  assert.ok(paths.includes("carc-demo.md"));
  assert.ok(paths.includes("phi-policy.md"));
  assert.ok(paths.includes("payer-northwind.md"));
  assert.ok(found.length <= 6);
  assert.ok(found.every((chunk) => chunk.score > 0));
});

test("Feature A left a coverage decision Feature C can cite", () => {
  const chunks = loadPack(packRoot);
  const decision = chunks.find((chunk) => chunk.path === "decisions/ADR-001-patient-and-coverage.md");
  assert.ok(decision);
  assert.match(decision.text, /PAT-###/);
  assert.ok(decision.tags.includes("feature-a"));
});
