import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "@northwind/orchestrator";
import { type LiveRecord, RATER_README, analyze, collectFindings, packetFor, parseRatings, ratingKey, ratingSheet, renderReport } from "./judging.ts";

/**
 * `npm run judging-prepare` builds the rating kit from the live build records: the findings, a blind sheet for each of
 * two raters, a page per build, and the key. It never overwrites a sheet that has been started.
 * `npm run judging-analyze` reads the two sheets and writes report.md.
 */
const root = join(repoRoot(), "evals/live-build");
const dir = join(root, "judging");
const mode = process.argv[2];
const records = (): LiveRecord[] =>
  readdirSync(join(root, "records"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ ...JSON.parse(readFileSync(join(root, "records", name), "utf8")), label: name.replace(/\.json$/, "") }) as LiveRecord);

if (mode === "prepare") {
  const all = records();
  const findings = collectFindings(all);
  mkdirSync(join(dir, "packets"), { recursive: true });
  writeFileSync(join(dir, "README.md"), RATER_README);
  writeFileSync(join(dir, "findings.csv"), ratingSheet(findings));
  writeFileSync(join(dir, "key.json"), `${JSON.stringify(ratingKey(findings), null, 1)}\n`);
  for (const record of all) writeFileSync(join(dir, "packets", `${record.label}.md`), packetFor(record, findings));
  for (const name of ["rater-1.csv", "rater-2.csv"]) {
    if (existsSync(join(dir, name))) console.log(`${name} already exists, so it was left alone`);
    else writeFileSync(join(dir, name), ratingSheet(findings));
  }
  console.log(`${findings.length} findings from ${all.length} builds, in ${dir}`);
} else if (mode === "analyze") {
  const key = JSON.parse(readFileSync(join(dir, "key.json"), "utf8"));
  const raters = ["rater-1", "rater-2"]
    .filter((name) => existsSync(join(dir, `${name}.csv`)))
    .map((name) => ({ name, ratings: parseRatings(readFileSync(join(dir, `${name}.csv`), "utf8")) }));
  const report = analyze(key, raters);
  if (!report.raters.some((rater) => rater.rated > 0)) {
    console.error("Nobody has rated any finding yet. Fill in the real, severity_check and resolution_check columns of the sheets first.");
    process.exit(1);
  }
  const text = renderReport(report);
  writeFileSync(join(dir, "report.md"), text);
  console.log(text);
} else console.log("Usage: judging-prepare | judging-analyze");
