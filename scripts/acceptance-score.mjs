// `npm run acceptance-score [run folder]`: scores Model B's acceptance test scripts from `npm run acceptance-eval` (and
// the ones the ten live builds recorded) against each build's real code. The run folder defaults to the first run,
// evals/live-build; the second is evals/live-build/run-2.
//
// For each script: how many tests it has, which fail on the real code (a wrong test, or a real bug: read them), and
// how many mutants it catches, leaving out the equivalent mutants (<run>/survivors-equivalent.json) and any test that
// fails on the real code. It also counts how many of the run's known gaps it closes, ordinary and extreme on valid
// input and those on invalid input only, from <run>/survivors-<date>.json.
//
// The code and the tests are model-written, so each build runs in a child process with no environment, Node's
// permission model and a network namespace where the machine allows one. No model is called.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const evalDir = process.argv[2] ? resolve(process.argv[2]) : join(root, "evals/live-build");
const answersDir = join(evalDir, "acceptance-prompt");
const testsPath = join(root, "packages/studio/public/tests.js");

const equivalent = JSON.parse(readFileSync(join(evalDir, "survivors-equivalent.json"), "utf8"));
const survivorsFile = readdirSync(evalDir).filter((name) => /^survivors-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().pop();
const survivors = JSON.parse(readFileSync(join(evalDir, survivorsFile), "utf8")).builds.flatMap((b) => b.survivors);
// The valid-input gaps that need extreme inputs (see docs/live-build-dry-run.md): 7 in the first run, 4 in the second.
const EXTREME = new Set([
  "05-stacked-promo#19", "05-stacked-promo#20", "05-stacked-promo#21", "05-stacked-promo#25", "07-interest-days#18", "10-pallets-contradiction#2", "10-pallets-contradiction#28",
  "17-due-dates#12", "17-due-dates#13", "19-billable-weight#0", "19-billable-weight#2",
]);
const gapKind = Object.fromEntries(
  survivors.filter((s) => s.verdict.startsWith("gap")).map((s) => [s.key, s.verdict === "gap" ? (EXTREME.has(s.key) ? "extreme" : "ordinary") : "invalid"]),
);

const CHILD = `
import { mutantsOf, runRecorded } from ${JSON.stringify(pathToFileURL(testsPath).href)};
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { code, scripts, skip } = JSON.parse(input);
const mutants = mutantsOf(code);
const out = scripts.map((script) => {
  let clean;
  try {
    clean = runRecorded(code, script);
  } catch (error) {
    return { error: String(error && error.message) };
  }
  const failing = clean.filter((r) => !r.pass).map((r) => ({ name: r.name, message: r.message }));
  const bad = new Set(failing.map((f) => f.name));
  const killed = [];
  let total = 0;
  mutants.forEach((mutant, index) => {
    if (skip.includes(index)) return;
    let results;
    try {
      results = runRecorded(mutant.source, script);
    } catch {
      return; // not valid code, as the mutation run skips it
    }
    total += 1;
    if (results.some((r) => !r.pass && !bad.has(r.name))) killed.push(index);
  });
  return { tests: clean.length, failing, total, killed };
});
process.stdout.write(JSON.stringify(out));
`;
const canUnshare = spawnSync("unshare", ["-rn", "--", process.execPath, "-e", "process.exit(0)"], { env: {}, timeout: 5000, stdio: "ignore" }).status === 0;
const nodeArgs = ["--permission", `--allow-fs-read=${testsPath}`, "--max-old-space-size=512", "--input-type=module", "-e", CHILD];
const [command, args] = canUnshare ? ["unshare", ["-rn", "--", process.execPath, ...nodeArgs]] : [process.execPath, nodeArgs];

const answers = !existsSync(answersDir) ? [] : readdirSync(answersDir).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(readFileSync(join(answersDir, name), "utf8")));
const rows = [];
for (const file of readdirSync(join(evalDir, "records")).filter((name) => name.endsWith(".json")).sort()) {
  const build = file.replace(/\.json$/, "");
  const record = JSON.parse(readFileSync(join(evalDir, "records", file), "utf8")).build;
  const entries = [{ build, variant: "recorded", n: 0, script: record.testScript }, ...answers.filter((a) => a.build === build).sort((a, b) => a.variant.localeCompare(b.variant) || a.n - b.n)];
  const skip = Object.entries(equivalent).filter(([key, v]) => key.startsWith(build + "#") && v.verdict === "equivalent").map(([key]) => Number(key.split("#")[1]));
  const child = spawnSync(command, args, { env: {}, input: JSON.stringify({ code: record.finalCode, scripts: entries.map((e) => e.script), skip }), timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  if (child.status !== 0) throw new Error(`${build}: ${child.error?.message ?? String(child.stderr).trim().split("\n").slice(-3).join(" ")}`);
  JSON.parse(String(child.stdout)).forEach((result, i) => {
    const { variant, n } = entries[i];
    const closed = { ordinary: 0, extreme: 0, invalid: 0 };
    for (const index of result.killed ?? []) {
      const kind = gapKind[`${build}#${index}`];
      if (kind) closed[kind] += 1;
    }
    rows.push({ build, variant, n, ...result, killedCount: result.killed?.length ?? 0, closed, cases: answers.find((a) => a.build === build && a.variant === variant && a.n === n)?.cases?.length ?? null });
  });
}

const gapCount = (kind) => Object.values(gapKind).filter((k) => k === kind).length;
const variants = ["recorded", "before", "after", "current", "current-low"].filter((v) => rows.some((r) => r.variant === v));
const summary = {};
for (const variant of variants) {
  const these = rows.filter((r) => r.variant === variant && !r.error);
  const sets = new Set(these.map((r) => r.n)).size;
  const sum = (f) => these.reduce((acc, r) => acc + f(r), 0);
  summary[variant] = {
    scripts: these.length,
    errors: rows.filter((r) => r.variant === variant && r.error).length,
    testsPerBuild: sum((r) => r.tests) / these.length,
    wrongTestsPerBuild: sum((r) => r.failing.length) / these.length,
    killRate: sum((r) => r.killedCount) / sum((r) => r.total),
    // Per sample set (all ten builds), averaged, of the run's ordinary, extreme and invalid-input gaps.
    ordinaryGapsClosed: sum((r) => r.closed.ordinary) / sets,
    extremeGapsClosed: sum((r) => r.closed.extreme) / sets,
    invalidGapsClosed: sum((r) => r.closed.invalid) / sets,
  };
}
const date = new Date().toISOString().slice(0, 10);
const outPath = join(evalDir, `acceptance-score-${date}.json`);
writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), networkNamespace: canUnshare, summary, rows }, null, 2) + "\n");

const pct = (x) => `${Math.round(100 * x)}%`;
console.log(`| Prompt | Scripts | Tests a build | Tests that fail on the real code, a build | Mutants caught | Ordinary gaps closed (of ${gapCount("ordinary")}) | Extreme (of ${gapCount("extreme")}) | Invalid input (of ${gapCount("invalid")}) |\n| --- | --- | --- | --- | --- | --- | --- | --- |`);
for (const [variant, s] of Object.entries(summary)) {
  console.log(`| ${variant} | ${s.scripts}${s.errors ? ` (+${s.errors} would not run)` : ""} | ${s.testsPerBuild.toFixed(1)} | ${s.wrongTestsPerBuild.toFixed(2)} | ${pct(s.killRate)} | ${s.ordinaryGapsClosed.toFixed(1)} | ${s.extremeGapsClosed.toFixed(1)} | ${s.invalidGapsClosed.toFixed(1)} |`);
}
for (const r of rows.filter((r) => r.error || r.failing.length)) {
  console.log(`\n${r.build} ${r.variant} ${r.n}: ${r.error ? "could not run: " + r.error : r.failing.map((f) => `\n  ✗ ${f.name}\n    ${f.message}`).join("")}`);
}
console.log(`\nWritten to ${outPath}`);
