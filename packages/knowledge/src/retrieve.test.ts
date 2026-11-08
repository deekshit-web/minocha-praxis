import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadPack, matchTerms, relevant, retrieve, scoreChunk } from "./retrieve.ts";

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

test("a tag matches on its hyphenated parts and a brief's plural matches the singular tag", () => {
  assert.deepEqual(matchTerms("denial-specialist"), ["denial-specialist", "denial", "specialist"]);
  assert.deepEqual(matchTerms("denials"), ["denials", "denial"]);
  assert.deepEqual(matchTerms("co-50"), ["co-50"]);
  assert.deepEqual(matchTerms("class"), ["class"]);
  const roles = loadPack(packRoot).find((chunk) => chunk.path === "roles.md");
  assert.ok(roles);
  assert.ok(scoreChunk(roles, ["specialist"]) > 0);
});

test("an always-on policy is retrieved for any brief and leads a short list", () => {
  const chunks = loadPack(packRoot);
  assert.deepEqual(
    chunks.filter((chunk) => chunk.always).map((chunk) => chunk.path),
    ["phi-policy.md"],
  );
  assert.deepEqual(retrieve(chunks, ["unrelated"]).map((chunk) => chunk.path), ["phi-policy.md"]);
  assert.equal(retrieve(chunks, ["co-50", "denial", "appeal", "deadline"], 2)[0]?.path, "phi-policy.md");
  assert.equal(relevant(chunks, ["co-50"]).some((chunk) => chunk.path === "glossary.md"), false);
});
