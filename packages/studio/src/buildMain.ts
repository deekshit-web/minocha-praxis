import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "@northwind/orchestrator";
import { liveBuildSeats, recordBuild } from "./build.ts";
import { panelContext } from "./record.ts";
import { DOMAINS, loadSpecs } from "./workflows.ts";

/** `npm run record-builds` (ids to choose, --force re-records). Builds on each workflow's recorded PRD. */
const args = process.argv.slice(2);
const force = args.includes("--force");
const wanted = args.filter((arg) => !arg.startsWith("--"));
const dir = join(repoRoot(), "packages/studio/recordings/build");
mkdirSync(dir, { recursive: true });

const specs = loadSpecs().filter((spec) => spec.kind === "build" && spec.recording && (!wanted.length || wanted.includes(spec.id)));
await Promise.all(
  specs.map(async (spec) => {
    const path = join(dir, `${spec.id}.json`);
    if (!force && existsSync(path)) return console.log(`${spec.id}: already recorded, skipped`);
    const domain = DOMAINS.find((item) => item.id === spec.domain)?.name ?? spec.domain;
    const started = Date.now();
    try {
      const recording = await recordBuild(spec, spec.recording!.merge.document, liveBuildSeats(panelContext(spec, domain)));
      writeFileSync(path, `${JSON.stringify(recording, null, 2)}\n`);
      const cost = recording.calls.reduce((total, call) => total + call.costUsd, 0);
      console.log(`${spec.id}: ${Math.round((Date.now() - started) / 1000)} s, $${cost.toFixed(3)}, ${recording.calls.length} calls; runs: ${recording.runs.map((run) => `round ${run.round} ${run.failing} failing`).join(", ")}.`);
    } catch (error) {
      console.log(`${spec.id}: FAILED ${error instanceof Error ? error.message : String(error)}`);
    }
  }),
);
