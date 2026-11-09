import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "runs/live");
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, "live-prd.mjs");
buildSync({
  entryPoints: [join(root, "packages/harness/src/liveMain.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
});

const child = spawnSync(process.execPath, [outfile], {
  stdio: "inherit",
  env: { ...process.env, NORTHWIND_ROOT: root },
});
process.exit(child.status ?? 1);
