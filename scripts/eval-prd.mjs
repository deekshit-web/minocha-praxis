import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "runs/eval");
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, "eval-prd.mjs");
buildSync({
  entryPoints: [join(root, "packages/harness/src/evalMain.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  // undici is CommonJS that breaks inside an ESM bundle. Node loads it from node_modules.
  external: ["undici"],
});

// Pass flags such as --part, --variant and --approve-harness through to the runner.
const child = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NORTHWIND_ROOT: root },
});
process.exit(child.status ?? 1);
