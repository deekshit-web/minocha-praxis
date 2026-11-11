import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "@northwind/orchestrator";
import { livePanel, recordPanel, recordingFor } from "./record.ts";
import { DOMAINS, loadSpecs } from "./workflows.ts";

/**
 * Records real panel runs: `npm run record-panels -- fmcg-document` for one workflow, or no ids for every
 * workflow without a recording. --force re-records. Stops before a workflow would take spend past the cap.
 */
const args = process.argv.slice(2);
const force = args.includes("--force");
const capUsd = Number(args.find((arg) => arg.startsWith("--cap="))?.slice(6) ?? 30);
const wanted = args.filter((arg) => !arg.startsWith("--"));
const dir = join(repoRoot(), "packages/studio/recordings");
mkdirSync(dir, { recursive: true });

const specs = loadSpecs(undefined, { recordings: false }).filter((spec) => (wanted.length ? wanted.includes(spec.id) : true));
let spent = 0;
for (const spec of specs) {
  if (!force && recordingFor(spec.id, dir)) {
    console.log(`${spec.id}: already recorded, skipped`);
    continue;
  }
  if (spent >= capUsd) {
    console.log(`Stopped: $${spent.toFixed(2)} spent, cap $${capUsd}.`);
    break;
  }
  const domain = DOMAINS.find((item) => item.id === spec.domain)?.name ?? spec.domain;
  const started = Date.now();
  try {
    const recording = await recordPanel(spec, livePanel(spec, domain));
    writeFileSync(join(dir, `${spec.id}.json`), `${JSON.stringify(recording, null, 2)}\n`);
    const cost = recording.calls.reduce((total, call) => total + call.costUsd, 0);
    spent += cost;
    const p0 = [...recording.reviewOfA.findings, ...recording.reviewOfB.findings].filter((finding) => finding.severity === "P0").length;
    console.log(`${spec.id}: recorded in ${Math.round((Date.now() - started) / 1000)} s, $${cost.toFixed(3)}, findings A ${recording.reviewOfA.findings.length} / B ${recording.reviewOfB.findings.length}, P0 ${p0}. Total $${spent.toFixed(2)}.`);
  } catch (error) {
    console.log(`${spec.id}: FAILED ${error instanceof Error ? error.message : String(error)}`);
  }
}
