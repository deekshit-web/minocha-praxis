import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const esbuild = join(root, "tools/esbuild/esbuild");
const out = join(root, "runs/harness");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".test.ts")) files.push(full);
  }
}
for (const name of ["domain", "knowledge", "orchestrator", "harness", "implementer", "rcm", "factory"]) {
  walk(join(root, "packages", name, "src"));
}

const bundled = [];
for (const file of files) {
  const outfile = join(out, `${bundled.length}.test.mjs`);
  const result = spawnSync(esbuild, [file, "--bundle", "--platform=node", "--format=esm", `--outfile=${outfile}`], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  bundled.push(outfile);
}

const test = spawnSync(process.execPath, ["--test", "--test-reporter", "spec", ...bundled], {
  stdio: "inherit",
  env: { ...process.env, NORTHWIND_ROOT: root },
});
process.exit(test.status ?? 1);
