// `npm run live-build-survivors`: sorts the mutants that survived the tests of the ten live builds.
//
// A surviving mutant is either a gap in the tests (some input gives a different answer and no test tries it) or an
// equivalent mutant (no input can tell it from the real code, so no test could catch it). This script runs the real
// code and each surviving mutant side by side on many inputs built from each build's contract: boundaries, a sweep of
// ordinary values, and inputs that break the contract, which are labelled invalid. A mutant that answers differently
// on a valid input is a gap; one that differs only on invalid input is a gap in the input checks; one that never
// differs is listed for a reasoned verdict, which lives in EQUIVALENT below with the reason.
//
// The code is model-written, so each build runs in a child process with no environment, Node's permission model and
// a network namespace where the machine allows one. No model is called. Results go to
// evals/live-build/survivors-<date>.json and a summary is printed.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const recordsDir = join(root, "evals/live-build/records");
const testsPath = join(root, "packages/studio/public/tests.js");

// ---------- Inputs, from each build's contract. Each case is { args, valid }.

const day = (iso, plus) => new Date(Date.parse(iso + "T00:00:00Z") + plus * 864e5).toISOString().slice(0, 10);
// Every "2026-MM-DD" with MM and DD from 00 to 99, and whether it is a real calendar date.
const pad = (n) => String(n).padStart(2, "0");
const EVERY_DATE = Array.from({ length: 10000 }, (_, i) => {
  const text = `2026-${pad(Math.floor(i / 100))}-${pad(i % 100)}`;
  return { text, real: !Number.isNaN(Date.parse(text + "T00:00:00Z")) && new Date(Date.parse(text + "T00:00:00Z")).toISOString().startsWith(text) };
});
const range = (from, to, step = 1) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
const ok = (...args) => ({ args, valid: true });
const bad = (...args) => ({ args, valid: false });
// A small fixed-seed generator, so every run tries the same inputs.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const INPUTS = {
  "01-claim-window": () => {
    const cases = [];
    for (const denial of ["2026-01-10", "2024-02-28", "2023-12-31", "2028-02-29", "2026-10-31", "1999-01-01", "1999-12-01", "1900-01-15", "2100-01-15", "0099-12-31", "0001-01-01"]) {
      for (const k of [...range(0, 130), 200, 365, 366, 1000]) cases.push(ok({ denialDate: denial, checkDate: day(denial, k) }));
      for (const k of [-1, -2, -30]) cases.push(bad({ denialDate: denial, checkDate: day(denial, k) }));
    }
    const badDates = ["2026-03-10x", " 2026-03-10", "2026-03-10\\n", "2026-03-10T00:00:00Z", ["2026-03-10"], "2026-13-01", "2026-00-10", "2026-02-30", "2026-02-29", "2026-01-32", "2026-01-00", "2026-04-31", "2026-1-01", "abcd-ef-gh", "", "2026-01-10T00:00", 20260110, null];
    for (const value of badDates) {
      cases.push(bad({ denialDate: value, checkDate: "2026-03-10" }), bad({ denialDate: "2026-01-10", checkDate: value }));
    }
    for (const { text, real } of EVERY_DATE) {
      cases.push({ args: [{ denialDate: "2025-12-01", checkDate: text }], valid: real }, { args: [{ denialDate: text, checkDate: "2026-12-31" }], valid: real });
    }
    cases.push(bad({ denialDate: "2026-01-10" }), bad({ checkDate: "2026-01-10" }), bad({}), bad(null), bad(undefined), bad("x"));
    cases.push(bad({ denialDate: "2026-01-10", checkDate: "2026-03-10", extra: 1 }), bad({ denialDate: undefined, checkDate: "2026-03-10" }));
    return cases;
  },
  "02-duplicate-claims": () => [ok([])],
  "03-grade-weights": () => {
    const random = rng(3);
    const cases = [];
    const score = () => Math.round(random() * 100);
    for (let i = 0; i < 1500; i++) {
      const homework = Array.from({ length: Math.floor(random() * 8) }, score);
      const quizzes = Array.from({ length: Math.floor(random() * 5) }, score);
      const exam = random() < 0.2 ? [] : [score()];
      cases.push(ok({ homework, quizzes, exam }));
    }
    for (const homework of [[50, 60, 70, 80], [80, 50, 60, 70], [60, 70, 50, 80], [70, 70, 70, 70], [40, 90, 40, 90, 100], [100, 0, 0, 100]]) cases.push(ok({ homework, quizzes: [80], exam: [90] }));
    cases.push(ok({ homework: [], quizzes: [], exam: [] }), ok({}));
    cases.push(bad(null), bad(undefined), bad(5), bad("x"), bad({ homework: [1], extra: 1 }));
    return cases;
  },
  "04-attendance-streak": () => {
    const random = rng(4);
    const cases = [];
    for (let i = 0; i < 1500; i++) {
      const days = Array.from({ length: Math.floor(random() * 12) }, (_, j) => ({ date: day("2026-09-01", j), status: random() < 0.55 ? "absent" : "present" }));
      cases.push(ok(days));
    }
    cases.push(ok([]), bad(null), bad("x"), bad([null]), bad([5]), bad([{ date: "2026-09-01", status: "late" }]), bad([{ date: "2026-09-01", status: "absent" }, null]));
    return cases;
  },
  "05-stacked-promo": () => {
    const cases = [];
    const prices = [0, 0.01, 0.05, 0.1, 0.5, 1, 1.05, 1.5, 2, 2.5, 2.675, 3.33, 9.99, 10, 12.5, 19.95, 100, 1234.56, 1e-7, 1e21, 0.000001];
    for (const unitPrice of prices) for (const units of range(0, 25)) cases.push(ok({ sku: "A", units, unitPrice }));
    for (const units of [-1, 1.5, NaN, Infinity, "3", null]) cases.push(bad({ sku: "A", units, unitPrice: 2 }));
    for (const unitPrice of [-1, -0.01, NaN, Infinity, "2", null]) cases.push(bad({ sku: "A", units: 3, unitPrice }));
    cases.push(ok({ sku: "A", units: 4, unitPrice: -0 }), ok({ sku: "A", units: -0, unitPrice: 2 }), bad(null), bad({}));
    return cases;
  },
  "06-reorder-point": () => [ok({ averageDailySales: 10, leadTimeDays: 5, stockOnHand: 60 })],
  "07-interest-days": () => {
    const cases = [];
    const starts = ["2026-03-01", "2028-02-01", "2025-12-31", "1999-12-01", "1900-02-01", "2100-02-01", "1600-02-01"];
    for (const startDate of starts) {
      for (const span of [0, 1, 2, 29, 30, 31, 59, 90, 180, 365, 366, 730]) {
        for (const principal of [0.01, 1, 73, 100, 1000, 10000, 12345.67]) {
          for (const annualRate of [0.001, 0.025, 0.05, 0.06, 0.1, 1, 2.5]) cases.push(ok({ principal, annualRate, startDate, endDate: day(startDate, span) }));
        }
      }
    }
    // Exact halves: principal x rate x days / 365 x 100 lands on k + 0.5.
    for (const [principal, annualRate, span] of [[73, 0.025, 1], [365, 0.005, 1], [182.5, 0.01, 1], [36.5, 0.05, 1], [730, 0.0025, 1], [3650, 0.0005, 1]]) {
      cases.push(ok({ principal, annualRate, startDate: "2026-03-01", endDate: day("2026-03-01", span) }));
    }
    for (const principal of [0, -1, NaN, "100", null]) cases.push(bad({ principal, annualRate: 0.05, startDate: "2026-03-01", endDate: "2026-04-01" }));
    for (const annualRate of [0, -0.05, NaN, "0.05", null]) cases.push(bad({ principal: 100, annualRate, startDate: "2026-03-01", endDate: "2026-04-01" }));
    for (const value of ["2026-04-01x", " 2026-04-01", "2026-04-01T00:00:00Z", ["2026-04-01"], "2026-02-30", "2026-13-01", "2026-00-01", "2026-01-00", "2026-01-32", "26-01-01", "", 5, null]) {
      cases.push(bad({ principal: 100, annualRate: 0.05, startDate: value, endDate: "2026-04-01" }), bad({ principal: 100, annualRate: 0.05, startDate: "2026-03-01", endDate: value }));
    }
    for (const { text, real } of EVERY_DATE) {
      cases.push({ args: [{ principal: 1000, annualRate: 0.05, startDate: "2025-12-01", endDate: text }], valid: real }, { args: [{ principal: 1000, annualRate: 0.05, startDate: text, endDate: "2026-12-31" }], valid: real });
    }
    cases.push(bad({ principal: 100, annualRate: 0.05, startDate: "2026-04-01", endDate: "2026-03-01" }), bad(null), bad("x"), bad({ principal: 100, annualRate: 0.05, startDate: "2026-03-01", endDate: "2026-04-01", fee: 1 }));
    return cases;
  },
  "08-velocity-alert": () => {
    const random = rng(8);
    const cases = [];
    const iso = (ms) => new Date(ms).toISOString().replace(".000Z", "Z");
    const base = Date.parse("2024-01-01T10:00:00Z");
    for (let i = 0; i < 2000; i++) {
      let t = base;
      const times = [];
      for (let j = 0; j < Math.floor(random() * 12); j++) {
        t += [0, 30e3, 60e3, 119e3, 120e3, 150e3, 599e3, 600e3, 601e3][Math.floor(random() * 9)];
        times.push(iso(t));
      }
      cases.push(ok({ paymentTimes: times }));
    }
    cases.push(ok({ paymentTimes: [] }), bad({ paymentTimes: [], extra: 1 }));
    return cases;
  },
  "09-window-overlap": () => {
    const cases = [];
    const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const points = [0, 59, 60, 61, 119, 120, 121, 600, 601, 602, 1439];
    for (const s1 of points) for (const e1 of points) for (const s2 of points) for (const e2 of points) {
      const valid = s1 < e1 && s2 < e2;
      cases.push({ args: [{ start: hhmm(s1), end: hhmm(e1) }, { start: hhmm(s2), end: hhmm(e2) }], valid });
    }
    cases.push(bad({ start: "09:00", end: "10:00", extra: 1 }, { start: "09:00", end: "10:00" }));
    return cases;
  },
  "10-pallets-contradiction": () => {
    const cases = [];
    const weights = [0.001, 0.1, 1, 8, 10, 12.5, 20, 20.8, 20.833333333333332, 20.84, 1000 / 47, 1000 / 48, 1000 / 49, 21, 25, 33.333333333333336, 0.1 + 0.2, 100, 333.3333333333333, 499.99, 500, 500.01, 999.99, 1000];
    for (const w of [...weights, ...range(1, 60).map((k) => 1000 / k), ...range(1, 200).map((k) => k * 0.1 + 0.05)]) {
      for (const n of [0, 1, 2, 47, 48, 49, 95, 96, 97, 100, 1000]) cases.push(ok({ cartons: n, cartonWeightKg: w }));
    }
    const random = rng(10);
    const nudge = (x, ulps) => { const b = new Float64Array([x]); const i = new BigInt64Array(b.buffer); i[0] += BigInt(ulps); return b[0]; };
    for (let c = 1; c <= 49; c++) for (let u = -4; u <= 4; u++) for (const n of [0, 1, 49, 97]) cases.push(ok({ cartons: n, cartonWeightKg: nudge(1000 / c, u) }));
    for (let i = 0; i < 4000; i++) cases.push(ok({ cartons: Math.floor(random() * 300), cartonWeightKg: random() < 0.5 ? random() * 1000 : Math.round(random() * 100000) / 100 }));
    for (const w of [1000.0001, 2000, 0, -1, NaN, "8", null]) cases.push(bad({ cartons: 10, cartonWeightKg: w }));
    for (const n of [-1, 1.5, NaN, "10", null, 2 ** 53]) cases.push(bad({ cartons: n, cartonWeightKg: 8 }));
    cases.push(ok({ cartons: -0, cartonWeightKg: 8 }), bad({ cartons: undefined, cartonWeightKg: 8 }), bad({ cartons: 10, cartonWeightKg: undefined }), bad({ cartons: 10 }), bad({ cartonWeightKg: 8 }), bad({}), bad(null), bad("x"), bad({ cartons: 10, cartonWeightKg: 8, extra: 1 }));
    return cases;
  },
};

// ---------- Survivors that no input told apart, each with a verdict ("equivalent": it can never differ, with the
// reason; "no difference found": not proven) in evals/live-build/survivors-equivalent.json, keyed by build and the
// mutant's index among that build's mutants. A listed mutant that some input does tell apart is reported as a gap.

const EQUIVALENT = JSON.parse(readFileSync(join(root, "evals/live-build/survivors-equivalent.json"), "utf8"));

// ---------- Runs in the child.

const CHILD = `
import { mutantsOf, loadRecorded, runRecorded } from ${JSON.stringify(pathToFileURL(testsPath).href)};
let input = "";
for await (const chunk of process.stdin) input += chunk;
// JSON has no undefined, NaN or Infinity; they arrive tagged. Walking (not a reviver) keeps a key whose value is undefined.
const untag = (value) => {
  if (value && typeof value === "object" && value.$ === "undefined") return undefined;
  if (value && typeof value === "object" && value.$ === "number") return Number(value.v);
  if (Array.isArray(value)) return value.map(untag);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, untag(v)]));
  return value;
};
const { code, scripts, cases } = untag(JSON.parse(input));
const show = (value) => JSON.stringify(value, (key, v) => (v === undefined && key !== "" ? "<undefined>" : typeof v === "number" && !Number.isFinite(v) ? String(v) : Object.is(v, -0) ? "-0" : v));
const call = (module, args) => {
  const name = Object.keys(module)[0];
  try {
    return "returns " + show(module[name](...structuredClone(args)));
  } catch (error) {
    return "throws " + (error instanceof Error ? error.constructor.name + ": " + error.message : String(error));
  }
};
const real = loadRecorded(code);
const expected = cases.map((c) => call(real, c.args));
const mutants = mutantsOf(code);
const out = [];
mutants.forEach((mutant, index) => {
  let killed;
  try {
    killed = scripts.some((script) => runRecorded(mutant.source, script).some((r) => !r.pass));
  } catch {
    return; // not valid code, as the mutation run skips it
  }
  if (killed) return;
  let module;
  try {
    module = loadRecorded(mutant.source);
  } catch {
    return;
  }
  let validDiff = null;
  let invalidDiff = null;
  for (let i = 0; i < cases.length && !validDiff; i++) {
    const got = call(module, cases[i].args);
    if (got === expected[i]) continue;
    const diff = { args: show(cases[i].args), real: expected[i], mutant: got };
    if (cases[i].valid) validDiff = diff;
    else if (!invalidDiff) invalidDiff = diff;
  }
  out.push({ index, operator: mutant.operator, line: mutant.line, validDiff, invalidDiff });
});
process.stdout.write(JSON.stringify({ cases: cases.length, survivors: out }));
`;

const canUnshare = spawnSync("unshare", ["-rn", "--", process.execPath, "-e", "process.exit(0)"], { env: {}, timeout: 5000, stdio: "ignore" }).status === 0;
const nodeArgs = ["--permission", `--allow-fs-read=${testsPath}`, "--max-old-space-size=512", "--input-type=module", "-e", CHILD];
const [command, args] = canUnshare ? ["unshare", ["-rn", "--", process.execPath, ...nodeArgs]] : [process.execPath, nodeArgs];
// JSON has no undefined, NaN or Infinity; send them tagged.
const encode = (value) => JSON.stringify(value, (key, v) => (v === undefined ? { $: "undefined" } : typeof v === "number" && !Number.isFinite(v) ? { $: "number", v: String(v) } : v));

const builds = [];
for (const file of readdirSync(recordsDir).filter((name) => name.endsWith(".json")).sort()) {
  const name = file.replace(/\.json$/, "");
  const { build } = JSON.parse(readFileSync(join(recordsDir, file), "utf8"));
  const cases = INPUTS[name]();
  const child = spawnSync(command, args, { env: {}, input: encode({ code: build.finalCode, scripts: [build.unitScript, build.testScript], cases }), timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  if (child.status !== 0) throw new Error(`${name}: ${child.error?.message ?? String(child.stderr).trim().split("\n").slice(-3).join(" ")}`);
  const result = JSON.parse(String(child.stdout));
  const survivors = result.survivors.map((s) => {
    const key = `${name}#${s.index}`;
    const noted = EQUIVALENT[key];
    const verdict = s.validDiff ? "gap" : s.invalidDiff ? "gap (invalid input only)" : noted ? noted.verdict : "unexplained";
    if (noted && (s.validDiff || s.invalidDiff)) console.warn(`${key} is listed as ${noted.verdict}, but an input tells it apart`);
    return { key, ...s, verdict, ...(noted && !s.validDiff && !s.invalidDiff ? { reason: noted.reason } : {}) };
  });
  builds.push({ build: name, inputs: result.cases, survivors });
}

const all = builds.flatMap((b) => b.survivors);
const count = (verdict) => all.filter((s) => s.verdict === verdict).length;
const totals = { survivors: all.length, gap: count("gap"), gapInvalidOnly: count("gap (invalid input only)"), equivalent: count("equivalent"), noDifferenceFound: count("no difference found"), unexplained: count("unexplained") };
const date = new Date().toISOString().slice(0, 10);
const outPath = join(root, `evals/live-build/survivors-${date}.json`);
writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), networkNamespace: canUnshare, totals, builds }, null, 2) + "\n");

console.log("| Build | Inputs | Survivors | Gap (valid input) | Gap (invalid input only) | Equivalent | No difference found | Unexplained |\n| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const b of builds) {
  const n = (v) => b.survivors.filter((s) => s.verdict === v).length;
  console.log(`| ${b.build} | ${b.inputs} | ${b.survivors.length} | ${n("gap")} | ${n("gap (invalid input only)")} | ${n("equivalent")} | ${n("no difference found")} | ${n("unexplained")} |`);
}
console.log(`| **All** | | ${totals.survivors} | ${totals.gap} | ${totals.gapInvalidOnly} | ${totals.equivalent} | ${totals.noDifferenceFound} | ${totals.unexplained} |`);
for (const s of all.filter((s) => s.verdict === "unexplained")) console.log(`unexplained ${s.key} ${s.operator} | ${s.line}`);
console.log(`\nWritten to ${outPath}`);
