// `npm run judging-prepare` and `npm run judging-analyze`: the rating kit for the findings of the live build records.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "runs/record");
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, "judging.mjs");
buildSync({ entryPoints: [join(root, "packages/studio/src/judgingMain.ts")], bundle: true, platform: "node", format: "esm", outfile, external: ["undici", "esbuild"] });
const child = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, NORTHWIND_ROOT: root } });
process.exit(child.status ?? 1);
