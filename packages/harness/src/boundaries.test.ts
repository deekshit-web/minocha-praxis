import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { repoRoot } from "@northwind/orchestrator";

function sources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sources(full));
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

function packages(): string[] {
  return readdirSync(join(repoRoot(), "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** A package is reached through its name and its index. A relative path into another package's src skips both. */
test("no package reaches into another package by relative path", () => {
  const escapes: string[] = [];
  for (const name of packages()) {
    for (const file of sources(join(repoRoot(), "packages", name, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/from "(\.\.\/\.\.\/[a-z]+\/src\/[^"]+)"/g)) {
        escapes.push(`${file.slice(repoRoot().length + 1)}: ${match[1]}`);
      }
    }
  }
  assert.deepEqual(escapes, []);
});

test("every @northwind import is declared in the importing package", () => {
  const undeclared: string[] = [];
  for (const name of packages()) {
    const manifest = JSON.parse(readFileSync(join(repoRoot(), "packages", name, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]);
    for (const file of sources(join(repoRoot(), "packages", name, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/from "(@northwind\/[a-z]+)"/g)) {
        const dependency = match[1] ?? "";
        if (!declared.has(dependency)) undeclared.push(`${name} imports ${dependency}`);
      }
    }
  }
  assert.deepEqual([...new Set(undeclared)], []);
});
