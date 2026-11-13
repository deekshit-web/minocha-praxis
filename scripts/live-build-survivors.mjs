// `npm run live-build-survivors [run folder]`: sorts the mutants that survived the tests of a run's live builds (default: the first run, evals/live-build).
//
// A surviving mutant is either a gap in the tests (some input gives a different answer and no test tries it) or an
// equivalent mutant (no input can tell it from the real code, so no test could catch it). This script runs the real
// code and each surviving mutant side by side on many inputs built from each build's contract: boundaries, a sweep of
// ordinary values, and inputs that break the contract, which are labelled invalid. A mutant that answers differently
// on a valid input is a gap; one that differs only on invalid input is a gap in the input checks; one that never
// differs is listed for a reasoned verdict, read from <run folder>/survivors-equivalent.json with the reason. Inputs the
// contract leaves open (such as an exact half cent it does not settle) count as invalid.
//
// The code is model-written, so each build runs in a child process with no environment, Node's permission model and
// a network namespace where the machine allows one. No model is called. Results go to
// <run folder>/survivors-<date>.json and a summary is printed.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
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
  "12-observation-hours": () => {
    const cases = [];
    const at = (date, minutes) => `${date} ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    // Across both 2026 clock changes (8 March and 1 November) and an ordinary day, every 15 minutes, and every
    // minute of the changeover hours.
    for (const date of ["2026-03-08", "2026-11-01", "2026-06-15"]) {
      const times = [...range(0, 1425, 15), ...range(60, 180)];
      for (const m of times) {
        cases.push(ok({ admission: at(date, m), discharge: at(day(date, 1), 600) }));
        cases.push(ok({ admission: at(day(date, -1), 1200), discharge: at(date, m) }));
      }
    }
    // Lengths of stay from 0 minutes to 3 days, around the hour boundaries and the 48-hour cap.
    for (const minutes of [...range(0, 180), ...range(2820, 2940), 4320]) cases.push(ok({ admission: "2026-05-04 09:00", discharge: at(day("2026-05-04", Math.floor((540 + minutes) / 1440)), (540 + minutes) % 1440) }));
    for (const { text, real } of EVERY_DATE) cases.push({ args: [{ admission: "2025-12-31 23:00", discharge: text + " 10:00" }], valid: real }, { args: [{ admission: text + " 10:00", discharge: "2027-01-02 08:00" }], valid: real });
    for (const date of ["2028-02-29", "2027-02-29", "1900-02-29", "2000-02-29", "2026-12-31", "2027-01-01"]) cases.push({ args: [{ admission: date + " 08:00", discharge: "2028-03-01 08:00" }], valid: date !== "2027-02-29" && date !== "1900-02-29" });
    for (const time of ["24:00", "23:60", "24:30", "99:99", "00:60", "7:00", "07:0", "07-00"]) cases.push(bad({ admission: "2026-05-04 " + time, discharge: "2026-05-06 10:00" }), bad({ admission: "2026-05-04 08:00", discharge: "2026-05-05 " + time }));
    for (const value of [undefined, null, "", 5, "2026-05-04T08:00", " 2026-05-04 08:00", "2026-05-04 08:00 ", ["2026-05-04 08:00"]]) cases.push(bad({ admission: value, discharge: "2026-05-05 10:00" }), bad({ admission: "2026-05-04 08:00", discharge: value }));
    cases.push(bad({ admission: "2026-05-04 08:00" }), bad({ discharge: "2026-05-04 08:00" }), bad({}), bad(null), bad(undefined), bad("x"), bad(5));
    cases.push(bad({ admission: "2026-05-05 08:00", discharge: "2026-05-04 08:00" }), bad({ admission: "2026-05-04 08:00", discharge: "2026-05-05 08:00", ward: "A" }));
    return cases;
  },
  "13-late-penalty": () => {
    const cases = [];
    const deadline = Date.parse("2026-10-01T17:00:00Z");
    const offsets = [...range(-3, 3), ...range(1, 8).flatMap((d) => [d * 864e5 - 1, d * 864e5, d * 864e5 + 1]), -864e5, 3600e3, 12 * 864e5];
    for (const off of offsets) {
      cases.push({ fn: "countLatePeriods", ...ok({ deadline, submittedAt: deadline + off }) });
      for (const [maxPoints, rawScore] of [[100, 100], [100, 85], [100, 30], [100, 0], [20, 17.5], [10, 1]]) cases.push({ fn: "applyLatePenalty", ...ok({ maxPoints, rawScore, deadline, submittedAt: deadline + off }) });
    }
    for (const value of [null, undefined, "x", 5]) cases.push({ fn: "countLatePeriods", ...bad(value) }, { fn: "applyLatePenalty", ...bad(value) });
    cases.push({ fn: "countLatePeriods", ...bad({ deadline, submittedAt: deadline, extra: 1 }) }, { fn: "applyLatePenalty", ...bad({ maxPoints: 100, rawScore: 90, deadline, submittedAt: deadline, extra: 1 }) });
    cases.push({ fn: "countLatePeriods", ...bad({ deadline, submittedAt: NaN }) }, { fn: "countLatePeriods", ...bad({ deadline }) });
    return cases;
  },
  "14-gpa-rounding": () => {
    const random = rng(14);
    const cases = [];
    const points = ["0", "1", "2", "3", "4", "0.0", "1.3", "1.7", "2.3", "2.7", "3.0", "3.3", "3.7", "4.0", "4.00", "3.33", "2.675", "0.5"];
    const credits = ["0", "1", "2", "3", "4", "0.5", "1.5", "3.0", "4.0", "0.25", "3.75", "10", "0.0"];
    const pick = (list) => list[Math.floor(random() * list.length)];
    for (let i = 0; i < 3000; i++) cases.push(ok({ courses: Array.from({ length: Math.floor(random() * 6) }, () => ({ gradePoints: pick(points), credits: pick(credits) })) }));
    for (const g of points) for (const c of credits) cases.push(ok({ courses: [{ gradePoints: g, credits: c }] }), ok({ courses: [{ gradePoints: g, credits: c }, { gradePoints: "3", credits: "2" }] }));
    for (const value of [3, "3.", ".5", "-1", "3,7", " 3", "", null, undefined, "1e2", "0x1"]) cases.push(bad({ courses: [{ gradePoints: value, credits: "3" }] }), bad({ courses: [{ gradePoints: "3", credits: value }] }));
    for (const value of [null, undefined, 5, "x", [], [{ courses: [] }]]) cases.push(bad(value));
    for (const value of [null, undefined, 5, "x", {}]) cases.push(bad({ courses: value }));
    cases.push(bad({ courses: [null] }), bad({ courses: [5] }), bad({ courses: [[]] }), bad({ courses: [], extra: 1 }), bad({ courses: [{ gradePoints: "3", credits: "3", name: "x" }] }));
    return cases;
  },
  "15-case-pack": () => {
    const cases = [];
    for (const orderUnits of [...range(1, 60), 0.5, 1.5, 99.9, 100, 1000, 1e6]) for (const caseSize of [1, 2, 3, 6, 12, 24, 25, 0.5, 2.5, 100]) cases.push(ok({ orderUnits, caseSize }));
    // 0 or less is left open by the PRD (AC-4), so those are not valid input.
    for (const value of [0, -0, -1, -12, NaN, Infinity, -Infinity, "12", null, undefined, true]) cases.push(bad({ orderUnits: value, caseSize: 12 }), bad({ orderUnits: 30, caseSize: value }));
    cases.push(bad({ orderUnits: 30 }), bad({ caseSize: 12 }), bad({}), bad({ orderUnits: 30, caseSize: 12, sku: "A" }));
    return cases;
  },
  "16-volume-rebate": () => {
    const random = rng(16);
    const cases = [];
    // The contract leaves an exact half cent open (REQ-3), and zero or less open (REQ-1): those are not valid input.
    const exactHalf = (x) => (Math.round(x * 100) * 2 - 1e6 * 2 > 0 ? Math.max(0, Math.min(Math.round(x * 100), 5e6) - 1e6) * 2 + Math.max(0, Math.round(x * 100) - 5e6) * 3 : 0) % 100 === 50;
    const add = (x) => cases.push({ args: [{ quarterlyPurchases: x }], valid: x > 0 && !exactHalf(x) });
    for (const x of [0.01, 1, 9999.99, 10000, 10000.01, 10000.25, 10000.5, 10000.75, 49999.99, 50000, 50000.01, 50000.17, 50000.5, 60000, 123456.78, 1e7]) add(x);
    for (let c = 1; c <= 400; c++) add((1e6 + c) / 100), add((5e6 + c) / 100);
    for (let i = 0; i < 4000; i++) add(Math.round(random() * 2e7) / 100);
    for (const value of [0, -1, -10000.5, NaN, Infinity, "100", null, undefined]) cases.push(bad({ quarterlyPurchases: value }));
    cases.push(bad({}), bad(null), bad(undefined), bad("x"), bad({ quarterlyPurchases: 100, region: "N" }));
    return cases;
  },
  "17-due-dates": () => {
    const cases = [];
    for (const year of [1600, 1601, 1700, 1800, 1900, 1999, 2000, 2001, 2024, 2025, 2026, 2027, 2028, 2100, 2399, 2400]) {
      for (const month of range(1, 12)) for (const d of [1, 15, 28, 29, 30, 31]) {
        const text = `${year}-${pad(month)}-${pad(d)}`;
        if (new Date(Date.parse(text + "T00:00:00Z")).toISOString().startsWith(text)) cases.push(ok({ startDate: text, count: 14 }));
      }
    }
    for (const count of range(1, 60)) cases.push(ok({ startDate: "2026-01-31", count }), ok({ startDate: "1999-08-31", count }));
    for (const count of [0, -1]) cases.push(bad({ startDate: "2026-01-31", count }));
    return cases;
  },
  "18-id-expiry": () => {
    const cases = [];
    for (const k of [...range(-40, 40), 365, 366, 3650]) for (const checkDate of ["2026-06-01", "2028-02-01", "2026-12-15", "2000-02-15", "2100-02-15"]) cases.push(ok({ checkDate, expiryDate: day(checkDate, k) }));
    for (const { text, real } of EVERY_DATE) cases.push({ args: [{ checkDate: "2026-06-01", expiryDate: text }], valid: real }, { args: [{ checkDate: text, expiryDate: "2026-06-01" }], valid: real });
    for (const value of [undefined, null, 5, "", "2026-6-01", "2026-06-01T00:00", " 2026-06-01", ["2026-06-01"]]) cases.push(bad({ checkDate: value, expiryDate: "2026-07-01" }), bad({ checkDate: "2026-06-01", expiryDate: value }));
    cases.push(bad(null), bad(undefined), bad("x"), bad(5), bad({}), bad({ checkDate: "2026-06-01", expiryDate: "2026-07-01", type: "passport" }));
    return cases;
  },
  "19-billable-weight": () => {
    const cases = [];
    const nudge = (x, ulps) => { const b = new Float64Array([x]); const i = new BigInt64Array(b.buffer); i[0] += BigInt(ulps); return b[0]; };
    for (const w of [...range(0, 200).map((k) => k / 10), ...range(0, 40).map((k) => k / 2), 0.1 + 0.2, 1.1 * 3, 5e-10, 2 + 1e-12, 2 + 1e-10, 2 + 5e-10, 2 + 2e-9, 2 - 1e-10, 2.5 + 3e-10, 7.5 + 4e-10]) {
      cases.push({ fn: "roundUpToHalfKg", ...ok(w) });
      for (let u = -3; u <= 3; u++) cases.push({ fn: "roundUpToHalfKg", ...ok(nudge(w, u)) });
    }
    for (const [l, wd, h] of [[40, 30, 20], [10, 10, 10], [33.3, 33.3, 33.3], [50, 50, 50], [12.5, 20, 10], [0.1, 0.2, 0.3], [100, 100, 100], [25, 20, 10], [41, 29, 21]]) {
      for (const actual of [0.1, 1, 2.2, 3.2, 4.8, 5, 12.25, 30]) cases.push({ fn: "billableWeight", ...ok({ lengthCm: l, widthCm: wd, heightCm: h, actualWeightKg: actual }) });
    }
    return cases;
  },
  "20-promised-date": () => {
    const cases = [];
    const holidaySets = [[], ["2026-07-03"], ["2026-12-25", "2026-12-28"], ["2026-07-06", "2026-07-07"]];
    for (let k = 0; k < 14; k++) {
      const date = day("2026-07-01", k);
      for (const time of ["00:00", "09:00", "13:59", "14:00", "14:01", "23:59"]) {
        for (const holidays of holidaySets) for (const transitDays of [0, 1, 2, 5]) cases.push({ fn: "promiseDelivery", ...ok({ bookedAt: `${date}T${time}`, transitDays, holidays }) });
      }
      for (const holidays of holidaySets) cases.push({ fn: "isBusinessDay", ...ok(date, holidays) });
    }
    for (const date of ["2026-12-24", "2026-12-31"]) for (const time of ["13:59", "14:00"]) cases.push({ fn: "promiseDelivery", ...ok({ bookedAt: `${date}T${time}`, transitDays: 3, holidays: ["2026-12-25", "2026-12-28", "2027-01-01"] }) });
    for (const bookedAt of ["2026-07-01T13:59:59", "2026-07-01T14:00:00", "2026-07-01T13:5", "2026-07-01T1400", "2026-07-01", "2026-07-01T14:00Z"]) cases.push({ fn: "promiseDelivery", ...bad({ bookedAt, transitDays: 1, holidays: [] }) });
    for (const transitDays of [-1, 1.5, NaN, "1", null]) cases.push({ fn: "promiseDelivery", ...bad({ bookedAt: "2026-07-01T10:00", transitDays, holidays: [] }) });
    cases.push({ fn: "promiseDelivery", ...bad({ bookedAt: "2026-07-01T10:00", transitDays: 1, holidays: [], carrier: "X" }) });
    return cases;
  },
};

// ---------- Which run. A run folder may be given (default: the first dry run, evals/live-build). It holds records/,
// the mutation results from `npm run live-build-mutation` (mutation-<date>.json, the latest is used), and the
// verdicts for survivors that no input told apart, survivors-equivalent.json: each keyed by build and the mutant's
// index among that build's mutants, with "equivalent" (it can never differ, with the reason) or "no difference
// found" (not proven). A listed mutant that some input does tell apart is reported as a gap.

const runDir = process.argv[2] ? resolve(process.argv[2]) : join(root, "evals/live-build");
const recordsDir = join(runDir, "records");
const mutationFile = readdirSync(runDir).filter((name) => /^mutation-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().pop();
if (!mutationFile) throw new Error(`no mutation results in ${runDir}; run npm run live-build-mutation first`);
const MUTATION = JSON.parse(readFileSync(join(runDir, mutationFile), "utf8"));
const equivalentPath = join(runDir, "survivors-equivalent.json");
const EQUIVALENT = existsSync(equivalentPath) ? JSON.parse(readFileSync(equivalentPath, "utf8")) : {};

// ---------- Runs in a child. "list": which mutants are valid code (the mutation run skips the rest), with their
// operator and line. "diff": the real code and one mutant on every input; the first input that tells them apart.

const CHILD = `
import { mutantsOf, loadRecorded } from ${JSON.stringify(pathToFileURL(testsPath).href)};
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
const { mode, code, cases, index } = untag(JSON.parse(input));
const mutants = mutantsOf(code);
if (mode === "list") {
  process.stdout.write(JSON.stringify(mutants.map((mutant, i) => {
    try {
      loadRecorded(mutant.source);
      return { index: i, valid: true, operator: mutant.operator, line: mutant.line };
    } catch {
      return { index: i, valid: false };
    }
  })));
} else {
  const show = (value) => JSON.stringify(value, (key, v) => (v === undefined && key !== "" ? "<undefined>" : typeof v === "number" && !Number.isFinite(v) ? String(v) : Object.is(v, -0) ? "-0" : v));
  const call = (module, c) => {
    const name = c.fn ?? Object.keys(module)[0];
    try {
      return "returns " + show(module[name](...structuredClone(c.args)));
    } catch (error) {
      return "throws " + (error instanceof Error ? error.constructor.name + ": " + error.message : String(error));
    }
  };
  const real = loadRecorded(code);
  const module = loadRecorded(mutants[index].source);
  let validDiff = null;
  let invalidDiff = null;
  for (let i = 0; i < cases.length && !validDiff; i++) {
    const expected = call(real, cases[i]);
    const got = call(module, cases[i]);
    if (got === expected) continue;
    const diff = { args: (cases[i].fn ? cases[i].fn + " " : "") + show(cases[i].args), real: expected, mutant: got };
    if (cases[i].valid) validDiff = diff;
    else if (!invalidDiff) invalidDiff = diff;
  }
  process.stdout.write(JSON.stringify({ validDiff, invalidDiff }));
}
`;

const canUnshare = spawnSync("unshare", ["-rn", "--", process.execPath, "-e", "process.exit(0)"], { env: {}, timeout: 5000, stdio: "ignore" }).status === 0;
const nodeArgs = ["--permission", `--allow-fs-read=${testsPath}`, "--max-old-space-size=512", "--input-type=module", "-e", CHILD];
const [command, args] = canUnshare ? ["unshare", ["-rn", "--", process.execPath, ...nodeArgs]] : [process.execPath, nodeArgs];
// JSON has no undefined, NaN or Infinity; send them tagged.
const encode = (value) => JSON.stringify(value, (key, v) => (v === undefined ? { $: "undefined" } : typeof v === "number" && !Number.isFinite(v) ? { $: "number", v: String(v) } : v));
const DIFF_LIMIT_MS = 120_000;
const child = (payload, timeout) => spawnSync(command, args, { env: {}, input: encode(payload), timeout, maxBuffer: 64 * 1024 * 1024 });

const builds = [];
for (const file of readdirSync(recordsDir).filter((name) => name.endsWith(".json")).sort()) {
  const name = file.replace(/\.json$/, "");
  const { build } = JSON.parse(readFileSync(join(recordsDir, file), "utf8"));
  // Line the mutation run's results (valid mutants only, in order) up with the mutants' indices.
  const listed = child({ mode: "list", code: build.finalCode }, 60_000);
  if (listed.status !== 0) throw new Error(`${name}: ${listed.error?.message ?? String(listed.stderr).trim().split("\n").slice(-3).join(" ")}`);
  const valid = JSON.parse(String(listed.stdout)).filter((m) => m.valid);
  const results = MUTATION.builds.find((b) => b.build === name)?.both.results ?? [];
  if (results.length !== valid.length) throw new Error(`${name}: the mutation run has ${results.length} mutants but ${valid.length} are valid code now`);
  const survivorsAt = [];
  valid.forEach((m, k) => {
    const r = results[k];
    if (r.operator && (r.operator !== m.operator || r.line !== m.line)) throw new Error(`${name}: mutant ${m.index} does not line up with the mutation run`);
    if (!r.killed) survivorsAt.push(m);
  });
  const cases = INPUTS[name] ? INPUTS[name]() : [];
  if (survivorsAt.length && !cases.length) throw new Error(`${name}: ${survivorsAt.length} survivors but no inputs written for this build`);
  const survivors = survivorsAt.map((m) => {
    const key = `${name}#${m.index}`;
    const ran = child({ mode: "diff", code: build.finalCode, cases, index: m.index }, DIFF_LIMIT_MS);
    if (ran.status !== 0) return { key, index: m.index, operator: m.operator, line: m.line, verdict: "ran out of time", note: "some input made this mutant run past the time limit, so it differs from the real code" };
    const s = JSON.parse(String(ran.stdout));
    const noted = EQUIVALENT[key];
    const verdict = s.validDiff ? "gap" : s.invalidDiff ? "gap (invalid input only)" : noted ? noted.verdict : "unexplained";
    if (noted && (s.validDiff || s.invalidDiff)) console.warn(`${key} is listed as ${noted.verdict}, but an input tells it apart`);
    return { key, index: m.index, operator: m.operator, line: m.line, validDiff: s.validDiff, invalidDiff: s.invalidDiff, verdict, ...(noted && !s.validDiff && !s.invalidDiff ? { reason: noted.reason } : {}) };
  });
  builds.push({ build: name, inputs: cases.length, survivors });
}

const all = builds.flatMap((b) => b.survivors);
const count = (verdict) => all.filter((s) => s.verdict === verdict).length;
const totals = { survivors: all.length, gap: count("gap"), gapInvalidOnly: count("gap (invalid input only)"), equivalent: count("equivalent"), noDifferenceFound: count("no difference found"), ranOutOfTime: count("ran out of time"), unexplained: count("unexplained") };
const date = new Date().toISOString().slice(0, 10);
const outPath = join(runDir, `survivors-${date}.json`);
writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), networkNamespace: canUnshare, mutationResults: mutationFile, totals, builds }, null, 2) + "\n");

console.log("| Build | Inputs | Survivors | Gap (valid input) | Gap (invalid input only) | Equivalent | No difference found | Unexplained |\n| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const b of builds) {
  const n = (v) => b.survivors.filter((s) => s.verdict === v).length;
  console.log(`| ${b.build} | ${b.inputs} | ${b.survivors.length} | ${n("gap")} | ${n("gap (invalid input only)")} | ${n("equivalent")} | ${n("no difference found")} | ${n("unexplained")} |`);
}
console.log(`| **All** | | ${totals.survivors} | ${totals.gap} | ${totals.gapInvalidOnly} | ${totals.equivalent} | ${totals.noDifferenceFound} | ${totals.unexplained} |`);
if (totals.ranOutOfTime) console.log(`${totals.ranOutOfTime} ran out of time on some input: ${all.filter((s) => s.verdict === "ran out of time").map((s) => s.key).join(", ")}`);
for (const s of all.filter((s) => s.verdict === "unexplained")) console.log(`unexplained ${s.key} ${s.operator} | ${s.line}`);
console.log(`\nWritten to ${outPath}`);
