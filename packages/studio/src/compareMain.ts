import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "@northwind/orchestrator";
import { type GatedResult, liveGatedProviders, runGated } from "./gated.ts";
import { DOMAINS, loadSpecs, riskOf } from "./workflows.ts";

/**
 * Runs the Jev-gated pipeline on every recorded workflow and compares it with the recorded full panel:
 * `npm run compare-gated` (--force reruns, --cap= limits new spend, ids to choose workflows).
 */
const args = process.argv.slice(2);
const force = args.includes("--force");
const capUsd = Number(args.find((arg) => arg.startsWith("--cap="))?.slice(6) ?? 5);
const wanted = args.filter((arg) => !arg.startsWith("--"));
const dir = join(repoRoot(), "packages/studio/recordings/gated");
mkdirSync(dir, { recursive: true });

let spent = 0;
const results: GatedResult[] = [];
for (const spec of loadSpecs().filter((item) => item.recording && (!wanted.length || wanted.includes(item.id)))) {
  const path = join(dir, `${spec.id}.json`);
  if (!force && existsSync(path)) {
    results.push(JSON.parse(readFileSync(path, "utf8")) as GatedResult);
    continue;
  }
  if (spent >= capUsd) {
    console.log(`Stopped at the $${capUsd} cap.`);
    break;
  }
  const domain = DOMAINS.find((item) => item.id === spec.domain)?.name ?? spec.domain;
  try {
    const result = await runGated(spec, spec.recording!, riskOf(spec.id), domain, liveGatedProviders(spec, domain));
    writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
    const newSpend = result.gated.newCalls.reduce((total, item) => total + item.costUsd, 0) + result.decisions.reduce((total, item) => total + item.costUsd, 0) + (result.judges ? result.judges.claude.costUsd + result.judges.grok.costUsd : 0);
    spent += newSpend;
    results.push(result);
    console.log(`${spec.id}: ${result.mergePath}${result.skippedReviewOfA ? ", skipped B's review" : ""}; $${result.full.costUsd.toFixed(3)} → $${result.gated.costUsd.toFixed(3)}, ${Math.round(result.full.seconds)} s → ${Math.round(result.gated.seconds)} s. New spend $${newSpend.toFixed(3)}.`);
  } catch (error) {
    console.log(`${spec.id}: FAILED ${error instanceof Error ? error.message : String(error)}`);
  }
}

const sum = (pick: (result: GatedResult) => number) => results.reduce((total, result) => total + pick(result), 0);
console.log(`\n${results.length} workflows. Full panel $${sum((r) => r.full.costUsd).toFixed(2)}, ${Math.round(sum((r) => r.full.seconds))} s. Gated $${sum((r) => r.gated.costUsd).toFixed(2)}, ${Math.round(sum((r) => r.gated.seconds))} s.`);
