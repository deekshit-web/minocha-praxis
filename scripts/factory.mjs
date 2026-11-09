import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "runs/factory");
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, "server.mjs");
buildSync({
  entryPoints: [join(root, "packages/factory/src/main.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  // esbuild cannot be bundled, and undici is CommonJS that breaks inside an ESM bundle. Node loads both from node_modules.
  external: ["esbuild", "undici"],
});

const child = spawnSync(process.execPath, [outfile], {
  stdio: "inherit",
  env: { ...process.env, NORTHWIND_ROOT: root, PORT: process.env.PORT ?? "4317" },
});
process.exit(child.status ?? 1);
