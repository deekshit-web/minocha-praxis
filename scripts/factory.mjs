import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const esbuild = join(root, "tools/esbuild/esbuild");
const outDir = join(root, "runs/factory");
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, "server.mjs");
const result = spawnSync(
  esbuild,
  [join(root, "packages/factory/src/main.ts"), "--bundle", "--platform=node", "--format=esm", `--outfile=${outfile}`],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);

const child = spawnSync(process.execPath, [outfile], {
  stdio: "inherit",
  env: { ...process.env, NORTHWIND_ROOT: root, PORT: process.env.PORT ?? "4317" },
});
process.exit(child.status ?? 1);
