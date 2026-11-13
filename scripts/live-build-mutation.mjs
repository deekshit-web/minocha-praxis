// `npm run live-build-mutation [records folder]`: mutation testing on live builds (default: evals/live-build/records/).
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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// A records folder may be given (default: the first dry run's); the results go in the folder above it.
const recordsDir = process.argv[2] ? resolve(process.argv[2]) : join(root, "evals/live-build/records");
const testsPath = join(root, "packages/studio/public/tests.js");
const TIME_LIMIT_MS = 60_000;

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

// The slow path, for code where some mutant never finishes (a loop that no longer ends): one mutant against one
// suite per child, with its own time limit. A mutant that runs out of time counts as caught, as a test runner that
// stops a hung test reports it failing.
const ONE = `
import { mutantsOf, runRecorded } from ${JSON.stringify(pathToFileURL(testsPath).href)};
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { code, script, index } = JSON.parse(input);
if (index === -1) {
  process.stdout.write(JSON.stringify({ count: mutantsOf(code).length, failing: runRecorded(code, script).filter((r) => !r.pass).map((r) => r.name) }));
} else {
  const { skip } = JSON.parse(input);
  const mutant = mutantsOf(code)[index];
  let results;
  try {
    results = runRecorded(mutant.source, script);
  } catch {
    results = null; // not valid code
  }
  process.stdout.write(JSON.stringify(results === null ? { valid: false } : { valid: true, operator: mutant.operator, line: mutant.line, by: (results.find((r) => !r.pass && !skip.includes(r.name)) || {}).name || null }));
}
`;
const ONE_LIMIT_MS = 10_000;

const canUnshare = spawnSync("unshare", ["-rn", "--", process.execPath, "-e", "process.exit(0)"], { env: {}, timeout: 5000, stdio: "ignore" }).status === 0;
const nodeArgs = ["--permission", `--allow-fs-read=${testsPath}`, "--max-old-space-size=256", "--input-type=module", "-e", CHILD];
const [command, args] = canUnshare ? ["unshare", ["-rn", "--", process.execPath, ...nodeArgs]] : [process.execPath, nodeArgs];
const oneArgs = ["--permission", `--allow-fs-read=${testsPath}`, "--max-old-space-size=256", "--input-type=module", "-e", ONE];
const [oneCommand, oneArgv] = canUnshare ? ["unshare", ["-rn", "--", process.execPath, ...oneArgs]] : [process.execPath, oneArgs];
const runOne = (payload) => spawnSync(oneCommand, oneArgv, { env: {}, input: JSON.stringify(payload), timeout: ONE_LIMIT_MS, maxBuffer: 16 * 1024 * 1024 });

function slowPath(build) {
  const suites = { unit: build.unitScript, acceptance: build.testScript };
  const out = { cleanFailures: {}, slowPath: true };
  const per = {};
  for (const [name, script] of Object.entries(suites)) {
    const clean = JSON.parse(String(runOne({ code: build.finalCode, script, index: -1 }).stdout));
    out.cleanFailures[name] = clean.failing.map((test) => ({ name: test }));
    per[name] = [];
    for (let index = 0; index < clean.count; index += 1) {
      const child = runOne({ code: build.finalCode, script, index, skip: clean.failing });
      if (child.error || child.status !== 0) {
        per[name][index] = { valid: true, killed: true, by: "(ran out of time)", operator: null, line: null };
        continue;
      }
      const result = JSON.parse(String(child.stdout));
      per[name][index] = result.valid ? { valid: true, killed: result.by !== null, by: result.by, operator: result.operator, line: result.line } : { valid: false };
    }
  }
  // Fill in the operator and line for timed-out entries from the other suite where it ran.
  const count = per.unit.length;
  const pick = (index) => [per.unit[index], per.acceptance[index]].find((r) => r && r.operator) || {};
  const summarise = (killedAt) => {
    const results = [];
    for (let index = 0; index < count; index += 1) {
      if (!per.unit[index]?.valid || !per.acceptance[index]?.valid) continue;
      const { operator, line } = pick(index);
      const by = killedAt(index);
      results.push({ operator, line, killed: by !== null, by });
    }
    return { total: results.length, killed: results.filter((r) => r.killed).length, results };
  };
  const byOf = (suite, index) => (per[suite][index].killed ? per[suite][index].by : null);
  out.unit = summarise((index) => byOf("unit", index));
  out.acceptance = summarise((index) => byOf("acceptance", index));
  out.both = summarise((index) => byOf("unit", index) ?? byOf("acceptance", index));
  return out;
}
if (!canUnshare) console.warn("This machine cannot make a network namespace; running with the permission model only.");

const pct = (k, t) => (t ? `${Math.round((100 * k) / t)}%` : "–");
const builds = [];
for (const file of readdirSync(recordsDir).filter((name) => name.endsWith(".json")).sort()) {
  const name = file.replace(/\.json$/, "");
  const { build } = JSON.parse(readFileSync(join(recordsDir, file), "utf8"));
  const started = Date.now();
  // MUTATION_SLOW=1 runs every build the slow way, to check it agrees with the fast one.
  const child = process.env.MUTATION_SLOW === "1" ? { status: 1, error: new Error("slow path forced") } : spawnSync(command, args, {
    env: {},
    input: JSON.stringify({ code: build.finalCode, unit: build.unitScript, acceptance: build.testScript }),
    timeout: TIME_LIMIT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  let result;
  if (child.status !== 0) {
    const reason = child.error ? String(child.error.message) : String(child.stderr).trim().split("\n").slice(-3).join(" ");
    console.log(`${name}: the fast path did not finish (${reason}); running each mutant on its own`);
    result = slowPath(build);
  } else {
    result = JSON.parse(String(child.stdout));
  }
  const survivors = result.both.results.filter((r) => !r.killed).map(({ operator, line }) => ({ operator, line }));
  builds.push({ build: name, seconds, ...result, survivors });
  console.log(`${name}: ${result.both.killed}/${result.both.total} killed in ${seconds}s`);
}

const done = builds.filter((b) => !b.error);
const sum = (key, field) => done.reduce((n, b) => n + b[key][field], 0);
const totals = Object.fromEntries(["unit", "acceptance", "both"].map((key) => [key, { total: sum(key, "total"), killed: sum(key, "killed") }]));
const date = new Date().toISOString().slice(0, 10);
const outPath = join(dirname(recordsDir), `mutation-${date}.json`);
writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), networkNamespace: canUnshare, totals, builds }, null, 2) + "\n");

console.log("\n| Build | Mutants | Unit (A) | Acceptance (B) | Both |\n| --- | --- | --- | --- | --- |");
for (const b of builds) {
  if (b.error) console.log(`| ${b.build} | did not finish | | | |`);
  else console.log(`| ${b.build} | ${b.both.total} | ${pct(b.unit.killed, b.unit.total)} | ${pct(b.acceptance.killed, b.acceptance.total)} | ${pct(b.both.killed, b.both.total)} |`);
}
console.log(`| **All** | ${totals.both.total} | ${pct(totals.unit.killed, totals.unit.total)} | ${pct(totals.acceptance.killed, totals.acceptance.total)} | ${pct(totals.both.killed, totals.both.total)} |`);
console.log(`\nWritten to ${outPath}`);
