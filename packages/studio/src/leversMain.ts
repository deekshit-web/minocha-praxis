import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "@northwind/orchestrator";
import { liveLeverProviders, runLevers } from "./levers.ts";
import { DOMAINS, loadSpecs } from "./workflows.ts";

/** `npm run compare-levers` (ids to choose workflows, --force reruns, --cap= limits spend). */
const args = process.argv.slice(2);
const force = args.includes("--force");
const capUsd = Number(args.find((arg) => arg.startsWith("--cap="))?.slice(6) ?? 6);
const wanted = args.filter((arg) => !arg.startsWith("--"));
const dir = join(repoRoot(), "packages/studio/recordings/levers");
mkdirSync(dir, { recursive: true });

let spent = 0;
const specs = loadSpecs().filter((spec) => spec.recording && (!wanted.length || wanted.includes(spec.id)));
const run = async (spec: (typeof specs)[number]) => {
  const path = join(dir, `${spec.id}.json`);
  if (!force && existsSync(path)) return;
  if (spent >= capUsd) return console.log(`${spec.id}: skipped, $${capUsd} cap reached`);
  const domain = DOMAINS.find((item) => item.id === spec.domain)?.name ?? spec.domain;
  try {
    const result = await runLevers(spec, spec.recording!, liveLeverProviders(spec, domain));
    writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
    const judgeCost = result.merges.reduce((total, merge) => total + merge.judges.claude.costUsd + merge.judges.grok.costUsd, 0) + [...result.fastB.draft.verdicts, ...result.fastB.review.verdicts].reduce((total, verdict) => total + verdict.costUsd, 0);
    const cost = result.merges.reduce((total, merge) => total + merge.costUsd, 0) + result.fastB.draft.costUsd + result.fastB.review.costUsd + judgeCost;
    spent += cost;
    console.log(`${spec.id}: ${result.merges.map((merge) => `${merge.variant} $${merge.costUsd.toFixed(4)} ${merge.seconds}s`).join(", ")}; fast B draft ${result.fastB.draft.seconds}s review ${result.fastB.review.seconds}s. Spent $${cost.toFixed(3)} (total $${spent.toFixed(2)}).`);
  } catch (error) {
    console.log(`${spec.id}: FAILED ${error instanceof Error ? error.message : String(error)}`);
  }
};
// Three workflows at a time: the calls inside each already run in parallel.
for (let i = 0; i < specs.length; i += 3) await Promise.all(specs.slice(i, i + 3).map(run));
