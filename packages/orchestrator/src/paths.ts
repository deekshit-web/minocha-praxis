import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The scripts set NORTHWIND_ROOT. A bundle cannot find the repo from its own path, so the fallback only works unbundled. */
export function repoRoot(): string {
  if (process.env.NORTHWIND_ROOT) return process.env.NORTHWIND_ROOT;
  return join(dirname(fileURLToPath(import.meta.url)), "../../..");
}
