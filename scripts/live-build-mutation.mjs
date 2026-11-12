// `npm run live-build-mutation`: mutation testing on the ten live builds in evals/live-build/records/.
//
// For each build it breaks the final model-written code in small, systematic ways (the same operators the page uses,
// from packages/studio/public/tests.js) and re-runs the tests, three ways: Model A's unit tests alone, Model B's
// acceptance tests alone (written from the PRD without seeing the code), and both together. A mutant that no test
// notices "survives": a change the tests cannot tell apart from the real code.
//
// The code is model-written, so each build runs in its own child process with an empty environment, Node's permission
// model (it may read tests.js and nothing else), a network namespace where the machine allows one, and a time limit.
// It calls no model and costs nothing. Results go to evals/live-build/mutation-<date>.json and a table is printed.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const recordsDir = join(root, "evals/live-build/records");
const testsPath = join(root, "packages/studio/public/tests.js");
const TIME_LIMIT_MS = 180_000;

const CHILD = `
import { mutationTestRecorded, runRecorded } from ${JSON.stringify(pathToFileURL(testsPath).href)};
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { code, unit, acceptance } = JSON.parse(input);
// A test that already fails on the real code would "kill" every mutant, so it is left out: each script runs with a
// test() that skips the names that failed on the real code.
const failed = (script) => runRecorded(code, script).filter((r) => !r.pass).map((r) => ({ name: r.name, message: r.message }));
const cleanFailures = { unit: failed(unit), acceptance: failed(acceptance) };
const skipping = (script, skip) => skip.length ? "const runTest = test;\\n{ const test = (name, body) => " + JSON.stringify(skip.map((s) => s.name)) + ".includes(name) ? undefined : runTest(name, body);\\n" + script + "\\n}" : script;
const u = skipping(unit, cleanFailures.unit);
const a = skipping(acceptance, cleanFailures.acceptance);
const summary = (run) => ({ total: run.total, killed: run.killed, results: run.results });
const out = {
  cleanFailures,
  unit: summary(mutationTestRecorded(code, [u])),
  acceptance: summary(mutationTestRecorded(code, [a])),
  both: summary(mutationTestRecorded(code, [u, a])),
};
process.stdout.write(JSON.stringify(out));
`;

const canUnshare = spawnSync("unshare", ["-rn", "--", process.execPath, "-e", "process.exit(0)"], { env: {}, timeout: 5000, stdio: "ignore" }).status === 0;
const nodeArgs = ["--permission", `--allow-fs-read=${testsPath}`, "--max-old-space-size=256", "--input-type=module", "-e", CHILD];
const [command, args] = canUnshare ? ["unshare", ["-rn", "--", process.execPath, ...nodeArgs]] : [process.execPath, nodeArgs];
if (!canUnshare) console.warn("This machine cannot make a network namespace; running with the permission model only.");

const pct = (k, t) => (t ? `${Math.round((100 * k) / t)}%` : "–");
const builds = [];
for (const file of readdirSync(recordsDir).filter((name) => name.endsWith(".json")).sort()) {
  const name = file.replace(/\.json$/, "");
  const { build } = JSON.parse(readFileSync(join(recordsDir, file), "utf8"));
  const started = Date.now();
  const child = spawnSync(command, args, {
    env: {},
    input: JSON.stringify({ code: build.finalCode, unit: build.unitScript, acceptance: build.testScript }),
    timeout: TIME_LIMIT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  if (child.status !== 0) {
    const reason = child.error ? String(child.error.message) : String(child.stderr).trim().split("\n").slice(-3).join(" ");
    builds.push({ build: name, seconds, error: reason });
    console.log(`${name}: did not finish (${reason})`);
    continue;
  }
  const result = JSON.parse(String(child.stdout));
  const survivors = result.both.results.filter((r) => !r.killed).map(({ operator, line }) => ({ operator, line }));
  builds.push({ build: name, seconds, ...result, survivors });
  console.log(`${name}: ${result.both.killed}/${result.both.total} killed in ${seconds}s`);
}

const done = builds.filter((b) => !b.error);
const sum = (key, field) => done.reduce((n, b) => n + b[key][field], 0);
const totals = Object.fromEntries(["unit", "acceptance", "both"].map((key) => [key, { total: sum(key, "total"), killed: sum(key, "killed") }]));
const date = new Date().toISOString().slice(0, 10);
const outPath = join(root, `evals/live-build/mutation-${date}.json`);
writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), networkNamespace: canUnshare, totals, builds }, null, 2) + "\n");

console.log("\n| Build | Mutants | Unit (A) | Acceptance (B) | Both |\n| --- | --- | --- | --- | --- |");
for (const b of builds) {
  if (b.error) console.log(`| ${b.build} | did not finish | | | |`);
  else console.log(`| ${b.build} | ${b.both.total} | ${pct(b.unit.killed, b.unit.total)} | ${pct(b.acceptance.killed, b.acceptance.total)} | ${pct(b.both.killed, b.both.total)} |`);
}
console.log(`| **All** | ${totals.both.total} | ${pct(totals.unit.killed, totals.unit.total)} | ${pct(totals.acceptance.killed, totals.acceptance.total)} | ${pct(totals.both.killed, totals.both.total)} |`);
console.log(`\nWritten to ${outPath}`);
