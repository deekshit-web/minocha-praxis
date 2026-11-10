import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
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
for (const name of ["domain", "knowledge", "orchestrator", "harness", "implementer", "rcm", "factory", "studio"]) {
  walk(join(root, "packages", name, "src"));
}

const bundled = [];
for (const file of files) {
  const outfile = join(out, `${bundled.length}.test.mjs`);
  // esbuild cannot be bundled, and undici is CommonJS that breaks inside an ESM bundle. Node loads both from node_modules.
  buildSync({ entryPoints: [file], bundle: true, platform: "node", format: "esm", outfile, external: ["esbuild", "undici"] });
  bundled.push(outfile);
}

const test = spawnSync(process.execPath, ["--test", "--test-reporter", "spec", ...bundled], {
  stdio: "inherit",
  env: { ...process.env, NORTHWIND_ROOT: root },
});
process.exit(test.status ?? 1);
