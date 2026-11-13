// `npm run live-build-trap-check`: checks the four "built to fail" builds of the second dry run against reference
// answers written from their briefs, not by the pipeline.
//
// The pipeline's own tests come from the PRD the same pipeline wrote, so a build that passes them could still be wrong
// about the brief. Here each trap has a small reference implementation of the brief's rule, and the model-written code
// and the reference answer thousands of generated inputs side by side: daylight-saving nights (12), exact halves and
// float-hostile decimals (14), month ends and leap years (17), the cutoff, weekends and holidays (20). Every
// disagreement is listed with its input. The model-written code runs in a child process with no environment, Node's
// permission model and a network namespace where the machine allows one. No model is called.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const runDir = join(root, "evals/live-build/run-2");
const testsPath = join(root, "packages/studio/public/tests.js");

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const pad = (n, w = 2) => String(n).padStart(w, "0");
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (date, n) => ymd(Date.parse(date + "T00:00:00Z") + n * 864e5);
const weekday = (date) => new Date(date + "T00:00:00Z").getUTCDay();

// ---------- 12: real elapsed time between two America/New_York wall-clock times.
const NY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const wall = (ms) => NY.format(new Date(ms)).replace(", ", " ");
/** Every UTC instant that shows this wall-clock time in New York: one normally, none in the spring gap, two in the autumn overlap. */
function instants(text) {
  const guess = Date.parse(text.replace(" ", "T") + ":00Z");
  return [4, 5].map((hours) => guess + hours * 3600e3).filter((ms) => wall(ms) === text);
}
function observationCases() {
  const random = rng(12);
  const cases = [];
  const days = ["2026-03-07", "2026-03-08", "2026-10-31", "2026-11-01", "2026-01-10", "2026-06-15", "2027-03-14", "2027-11-07"];
  for (let i = 0; i < 4000; i++) {
    const day = random() < 0.7 ? days[Math.floor(random() * days.length)] : addDays("2026-01-01", Math.floor(random() * 730));
    const admission = `${day} ${pad(Math.floor(random() * 24))}:${pad(Math.floor(random() * 60))}`;
    const [start] = instants(admission);
    if (start === undefined || instants(admission).length !== 1) continue; // gaps and overlaps have their own statuses
    const minutes = Math.floor(random() < 0.5 ? random() * 3000 : random() * 300);
    const discharge = wall(start + minutes * 60e3);
    if (instants(discharge).length !== 1) continue;
    cases.push({ args: [{ admission, discharge }], expected: { elapsedMinutes: minutes, billableHours: Math.min(48, Math.ceil(minutes / 60)) } });
  }
  // The brief's own examples.
  for (const [admission, discharge, billableHours] of [["2026-01-10 08:00", "2026-01-10 10:01", 3], ["2026-03-07 22:00", "2026-03-08 22:00", 23], ["2026-10-31 22:00", "2026-11-01 22:00", 25], ["2026-01-10 08:00", "2026-01-13 08:00", 48]]) {
    cases.push({ args: [{ admission, discharge }], expected: { billableHours } });
  }
  return cases;
}

// ---------- 14: weighted GPA in exact decimals, rounded half to even to 2 decimals.
const toFraction = (text) => {
  const [whole, frac = ""] = text.split(".");
  return { n: BigInt(whole + frac), d: 10n ** BigInt(frac.length) };
};
function gpa(courses) {
  let num = 0n;
  let den = 1n;
  let credits = 0n;
  let creditsDen = 1n;
  for (const { gradePoints, credits: c } of courses) {
    const g = toFraction(gradePoints);
    const k = toFraction(c);
    // num/den += (g.n*k.n)/(g.d*k.d); credits/creditsDen += k.n/k.d
    num = num * g.d * k.d + g.n * k.n * den;
    den = den * g.d * k.d;
    credits = credits * k.d + k.n * creditsDen;
    creditsDen = creditsDen * k.d;
  }
  if (credits === 0n) return null;
  // value = (num/den) / (credits/creditsDen); scaled by 100
  const top = num * creditsDen * 100n;
  const bottom = den * credits;
  let q = top / bottom;
  const r = top % bottom;
  if (2n * r > bottom || (2n * r === bottom && q % 2n === 1n)) q += 1n;
  return `${q / 100n}.${pad(Number(q % 100n))}`;
}
function gpaCases() {
  const random = rng(14);
  const cases = [];
  const decimal = (max, places) => {
    const scale = 10 ** places;
    const v = Math.floor(random() * max * scale) / scale;
    return places && random() < 0.7 ? v.toFixed(Math.floor(random() * places) + 1) : String(Math.round(v));
  };
  for (let i = 0; i < 4000; i++) {
    const courses = Array.from({ length: 1 + Math.floor(random() * 5) }, () => ({ gradePoints: decimal(4.01, 3), credits: random() < 0.2 ? decimal(5, 1) : String(1 + Math.floor(random() * 4)) }));
    cases.push({ args: [{ courses }], expected: { gpa: gpa(courses) } });
  }
  for (const v of ["0.005", "0.015", "1.005", "2.675", "3.125", "3.135", "2.665", "0.125", "1.115", "4.000"]) cases.push({ args: [{ courses: [{ gradePoints: v, credits: "1" }] }], expected: { gpa: gpa([{ gradePoints: v, credits: "1" }]) } });
  cases.push({ args: [{ courses: [] }], expected: { gpa: null } });
  return cases;
}

// ---------- 17: monthly due dates that clamp to the month's last day and go back to the original day.
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1..12
function dueDates(start, count) {
  const [y, m, d] = start.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const total = m - 1 + i + 1;
    const yy = y + Math.floor(total / 12);
    const mm = (total % 12) + 1;
    return `${yy}-${pad(mm)}-${pad(Math.min(d, daysIn(yy, mm)))}`;
  });
}
function dueCases() {
  const random = rng(17);
  const cases = [];
  for (let i = 0; i < 3000; i++) {
    const startDate = random() < 0.6 ? `${2024 + Math.floor(random() * 8)}-${pad(1 + Math.floor(random() * 12))}-${pad(28 + Math.floor(random() * 4))}` : addDays("2024-01-01", Math.floor(random() * 2900));
    if (Number.isNaN(Date.parse(startDate)) || ymd(Date.parse(startDate)) !== startDate) continue;
    const count = 1 + Math.floor(random() * 26);
    cases.push({ args: [{ startDate, count }], expected: dueDates(startDate, count) });
  }
  return cases;
}

// ---------- 20: ship and delivery dates over a 14:00 cutoff, weekends and listed holidays.
const isBusiness = (date, holidays) => weekday(date) !== 0 && weekday(date) !== 6 && !holidays.includes(date);
const nextBusiness = (date, holidays) => {
  let d = addDays(date, 1);
  while (!isBusiness(d, holidays)) d = addDays(d, 1);
  return d;
};
function promise(bookedAt, transitDays, holidays) {
  const [date, time] = bookedAt.split("T");
  const shipDate = isBusiness(date, holidays) && time < "14:00" ? date : nextBusiness(date, holidays);
  let deliveryDate = shipDate;
  for (let i = 0; i < transitDays; i++) deliveryDate = nextBusiness(deliveryDate, holidays);
  return { shipDate, deliveryDate };
}
function promiseCases() {
  const random = rng(20);
  const pool = ["2026-07-03", "2026-07-06", "2026-12-24", "2026-12-25", "2026-12-28", "2027-01-01", "2026-11-26", "2026-11-27", "2026-09-07"];
  const cases = [];
  for (let i = 0; i < 4000; i++) {
    const date = addDays(random() < 0.6 ? "2026-06-28" : "2026-11-20", Math.floor(random() * 50));
    const times = ["00:00", "09:00", "13:59", "14:00", "14:01", "23:59", `${pad(Math.floor(random() * 24))}:${pad(Math.floor(random() * 60))}`];
    const bookedAt = `${date}T${times[Math.floor(random() * times.length)]}`;
    const holidays = pool.filter(() => random() < 0.4);
    const transitDays = Math.floor(random() * 8);
    cases.push({ args: [{ bookedAt, transitDays, holidays }], expected: promise(bookedAt, transitDays, holidays) });
  }
  return cases;
}

// With --self-test, each trap gets the naive code a model might write instead, to show the check can fail.
const NAIVE = {
  "12-observation-hours": `({ billableObservationHours({ admission, discharge }) {
    const ms = (t) => Date.parse(t.replace(" ", "T") + ":00Z");
    const minutes = Math.round((ms(discharge) - ms(admission)) / 60000);
    return { status: "ok", elapsedMinutes: minutes, roundedHours: Math.ceil(minutes / 60), billableHours: Math.min(48, Math.ceil(minutes / 60)), flags: [] };
  } })`,
  "14-gpa-rounding": `({ calculateGpa({ courses }) {
    let points = 0, credits = 0;
    for (const c of courses) { points += Number(c.gradePoints) * Number(c.credits); credits += Number(c.credits); }
    return { gpa: credits === 0 ? null : (Math.round(points / credits * 100) / 100).toFixed(2) };
  } })`,
  "17-due-dates": `({ dueDates({ startDate, count }) {
    const out = [];
    for (let i = 1; i <= count; i++) { const d = new Date(startDate + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + i); out.push(d.toISOString().slice(0, 10)); }
    return out;
  } })`,
  "20-promised-date": `({ promiseDelivery({ bookedAt, transitDays }) {
    const next = (d) => { let t = Date.parse(d + "T00:00:00Z"); do { t += 864e5; } while ([0, 6].includes(new Date(t).getUTCDay())); return new Date(t).toISOString().slice(0, 10); };
    const [date, time] = bookedAt.split("T");
    const day = new Date(date + "T00:00:00Z").getUTCDay();
    let ship = day !== 0 && day !== 6 && time < "14:00" ? date : next(date);
    let deliver = ship;
    for (let i = 0; i < transitDays; i++) deliver = next(deliver);
    return { shipDate: ship, deliveryDate: deliver };
  } })`,
};
const selfTest = process.argv.includes("--self-test");

const TRAPS = [
  { build: "12-observation-hours", fn: "billableObservationHours", cases: observationCases },
  { build: "14-gpa-rounding", fn: "calculateGpa", cases: gpaCases },
  { build: "17-due-dates", fn: "dueDates", cases: dueCases },
  { build: "20-promised-date", fn: "promiseDelivery", cases: promiseCases },
];

// ---------- Runs in the child: calls the model-written function on every case; compares only the expected fields.
const CHILD = `
import { loadRecorded } from ${JSON.stringify(pathToFileURL(testsPath).href)};
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { code, fn, cases } = JSON.parse(input);
const module = loadRecorded(code);
const pick = (got, expected) => (Array.isArray(expected) || expected === null || typeof expected !== "object" ? got : Object.fromEntries(Object.keys(expected).map((k) => [k, got == null ? got : got[k]])));
const out = [];
for (const c of cases) {
  let got;
  try {
    got = module[fn](...c.args);
  } catch (error) {
    got = { thrown: String(error && error.message) };
  }
  const shown = got && got.thrown ? got : pick(got, c.expected);
  if (JSON.stringify(shown) !== JSON.stringify(c.expected)) out.push({ input: c.args, expected: c.expected, got: shown, full: got });
}
process.stdout.write(JSON.stringify(out));
`;
const canUnshare = spawnSync("unshare", ["-rn", "--", process.execPath, "-e", "process.exit(0)"], { env: {}, timeout: 5000, stdio: "ignore" }).status === 0;
const nodeArgs = ["--permission", `--allow-fs-read=${testsPath}`, "--max-old-space-size=512", "--input-type=module", "-e", CHILD];
const [command, args] = canUnshare ? ["unshare", ["-rn", "--", process.execPath, ...nodeArgs]] : [process.execPath, nodeArgs];

const results = [];
for (const trap of TRAPS) {
  const { build } = JSON.parse(readFileSync(join(runDir, "records", `${trap.build}.json`), "utf8"));
  const cases = trap.cases();
  const code = selfTest ? NAIVE[trap.build] : build.finalCode;
  const child = spawnSync(command, args, { env: {}, input: JSON.stringify({ code, fn: trap.fn, cases }), timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
  if (child.status !== 0) throw new Error(`${trap.build}: ${child.error?.message ?? String(child.stderr).trim().split("\n").slice(-3).join(" ")}`);
  const disagreements = JSON.parse(String(child.stdout));
  results.push({ build: trap.build, cases: cases.length, disagreements: disagreements.length, examples: disagreements.slice(0, 10) });
  console.log(`${trap.build}: ${cases.length} inputs, ${disagreements.length} disagreements`);
  for (const d of disagreements.slice(0, 5)) console.log(`  ${JSON.stringify(d.input)}\n    expected ${JSON.stringify(d.expected)}\n    got      ${JSON.stringify(d.got)}`);
}
if (selfTest) {
  const blind = results.filter((r) => r.disagreements === 0);
  console.log(blind.length ? `\nSELF-TEST FAILED: the check found nothing wrong with the naive code for ${blind.map((r) => r.build).join(", ")}` : "\nSelf-test passed: the check catches the naive code for every trap.");
  process.exit(blind.length ? 1 : 0);
}
const outPath = join(runDir, `trap-check-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), networkNamespace: canUnshare, results }, null, 2) + "\n");
console.log(`\nWritten to ${outPath}`);
