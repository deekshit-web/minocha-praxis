// The build workflows' tests, as real code. Each feature exists twice: as first written, with the bug the
// demo describes, and after Claude's one fix. The page runs the generated tests against both in the browser;
// the project's own tests run this same file and check the workflows show what it really produces.
//
// The text between "<test-script>" markers is the test script the page shows, so what a viewer reads is
// exactly what runs.

class AssertionError extends Error {}
const show = (value) => (typeof value === "string" ? JSON.stringify(value) : value === Infinity ? "Infinity" : JSON.stringify(value));
const assert = {
  equal(actual, expected) {
    if (!Object.is(actual, expected)) throw new AssertionError(`expected ${show(expected)}, received ${show(actual)}`);
  },
  deepEqual(actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new AssertionError(`expected ${show(expected)}, received ${show(actual)}`);
  },
  ok(value) {
    if (!value) throw new AssertionError(`expected a result, received ${show(value)}`);
  },
  match(text, pattern) {
    if (!pattern.test(String(text))) throw new AssertionError(`expected text matching ${pattern}, received ${show(text)}`);
  },
  throws(run, pattern) {
    try {
      run();
    } catch (error) {
      // Node's assert.throws tests the pattern against String(error), "Error: <message>"; tests here have used the
      // bare message. Models write it either way, so either passes.
      const message = error instanceof Error ? error.message : String(error);
      if (pattern.test(message) || (error instanceof Error && pattern.test(String(error)))) return;
      throw new AssertionError(`expected an error matching ${pattern}, received ${show(message)}`);
    }
    throw new AssertionError(`expected an error matching ${pattern}, received none`);
  },
};

// ---------- Time zones, shared by the delay notifications.

function offsetMinutes(zone, utcMs) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(utcMs));
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return Math.round((Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute")) - utcMs) / 60000);
}
function zonedToUtcMs({ local, zone }) {
  const guess = Date.parse(local + "Z");
  const first = offsetMinutes(zone, guess);
  const second = offsetMinutes(zone, guess - first * 60000);
  return guess - second * 60000;
}
const ZONE_NAMES = { "Asia/Kolkata": "India time", "America/New_York": "New York time" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------- The features under test, as source text: the code after Claude's fix. Each first version is the
// same source with one patch applied, so the page can show the real code and the real diff, and mutation
// testing can break the same code the tests run against.

const SOURCES = {
  "healthcare-build": `({
  appealReady(line) {
    if (line.carc === "PR-1") return { ready: false, missing: ["patient responsibility: no appeal"] };
    if (line.carc !== "CO-50") return { ready: true, missing: [] };
    const missing = [];
    if (!/^DOC-\\d{3}$/.test(line.noteRef || "")) missing.push("clinical-note reference");
    if (!line.filingDeadline) missing.push("filing deadline");
    return { ready: missing.length === 0, missing };
  },
})`,
  "education-build": `({
  riskFlag(student) {
    if (student.clearDays >= 10) return { flagged: false, reasons: [] };
    const rate = student.present / student.schoolDays;
    const reasons = [];
    if (rate < 0.9) reasons.push("attendance");
    if (student.failingGrades >= 2) reasons.push("grades");
    return { flagged: reasons.length > 0, reasons };
  },
  canSeeFlag(role) {
    return role === "counsellor" || role === "head-of-year";
  },
  rosterFor(classId) {
    return [{ id: "STU-104", classId }, { id: "STU-207", classId }];
  },
})`,
  "fmcg-build": `(() => {
  const daysOfCover = (stock, sellOut, weeks) => (sellOut === 0 ? Infinity : stock / (sellOut / (weeks * 7)));
  return {
    daysOfCover,
    createAlerter() {
      const sent = new Set();
      return {
        check({ distributor, sku, stock, sellOut, weeks, date }) {
          const cover = daysOfCover(stock, sellOut, weeks);
          if (!(cover < 7)) return null;
          const key = distributor + "|" + sku + "|" + date;
          if (sent.has(key)) return null;
          sent.add(key);
          return { distributor, sku, cover };
        },
      };
    },
  };
})()`,
  "finance-build": `({
  prequalify(input) {
    const allowed = ["grossMonthlyIncome", "monthlyDebt", "newPayment", "creditScore"];
    for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new Error("unknown field: " + key);
    const { grossMonthlyIncome: income, monthlyDebt: debt, newPayment: payment, creditScore: score } = input;
    const basisPoints = Math.round(((debt + payment) * 10000) / income);
    const withinLimit = basisPoints <= 4300;
    const reasons = [];
    if (!withinLimit) reasons.push("Your monthly debts, including this loan, would be " + basisPoints / 100 + "% of your income; the limit is 43%.");
    if (score < 640) reasons.push("Your credit score of " + score + " is below 640.");
    if (reasons.length) reasons.push("This is not a final decision; a full application may give a different result.");
    return { prequalified: reasons.length === 0, dti: basisPoints / 10000, reasons };
  },
})`,
  "logistics-build": `(() => {
  const minutesLate = (promised, etaUtc) => Math.round((Date.parse(etaUtc) - zonedToUtcMs(promised)) / 60000);
  return {
    minutesLate,
    toUtc: (zoned) => new Date(zonedToUtcMs(zoned)).toISOString().slice(0, 16) + "Z",
    createNotifier() {
      const last = new Map();
      return {
        update(id, promised, etaUtc) {
          const late = minutesLate(promised, etaUtc);
          if (!last.has(id)) {
            if (late <= 120) return null;
            last.set(id, etaUtc);
            return { id, late };
          }
          const slip = Math.round((Date.parse(etaUtc) - Date.parse(last.get(id))) / 60000);
          if (slip < 120) return null;
          last.set(id, etaUtc);
          return { id, late };
        },
      };
    },
    formatForCustomer(etaUtc, zone) {
      const ms = Date.parse(etaUtc);
      const local = new Date(ms + offsetMinutes(zone, ms) * 60000);
      const time = String(local.getUTCHours()).padStart(2, "0") + ":" + String(local.getUTCMinutes()).padStart(2, "0");
      return local.getUTCDate() + " " + MONTHS[local.getUTCMonth()] + ", " + time + " (" + (ZONE_NAMES[zone] || zone) + ")";
    },
  };
})()`,
};

/**
 * The bug each first version carried, as the patch Claude's fix reversed: in the first version, each `fixed`
 * text read as `first`. The bugs were planted to show the mechanism; the code and the tests are real.
 */
const FIRST_VERSION = {
  "healthcare-build": [{ fixed: `    const missing = [];\n`, first: `    if (line.filingDeadline) return { ready: true, missing: [] };\n    const missing = [];\n` }],
  "education-build": [{ fixed: `if (rate < 0.9)`, first: `if (rate <= 0.9)` }],
  "fmcg-build": [{ fixed: `distributor + "|" + sku + "|" + date`, first: `distributor + "|" + date` }],
  "finance-build": [
    { fixed: `    const basisPoints = Math.round(((debt + payment) * 10000) / income);\n    const withinLimit = basisPoints <= 4300;\n`, first: `    const share = debt / income + payment / income;\n    const basisPoints = Math.round(share * 10000);\n    const withinLimit = share <= 0.43;\n` },
  ],
  "logistics-build": [{ fixed: `          const slip =`, first: `          return null;\n          const slip =` }],
};

const HELPERS = { zonedToUtcMs, offsetMinutes, ZONE_NAMES, MONTHS };

/** The source of a feature: the fixed code, or the first version with its bug. */
export function sourceOf(id, version = "fixed") {
  let source = SOURCES[id];
  if (version === "first") for (const patch of FIRST_VERSION[id]) source = source.replace(patch.fixed, patch.first);
  return source;
}

/** The fix as a unified-style diff: what the first version said, and what replaced it. */
export function fixDiff(id) {
  return FIRST_VERSION[id]
    .map((patch) => [...patch.first.replace(/\n$/, "").split("\n").map((line) => "- " + line.trim()), ...patch.fixed.replace(/\n$/, "").split("\n").map((line) => "+ " + line.trim())].join("\n"))
    .join("\n");
}

function instantiate(source) {
  // Same-origin code we ship, never visitor input: the source above, or a mutant of it.
  return new Function("helpers", "const { zonedToUtcMs, offsetMinutes, ZONE_NAMES, MONTHS } = helpers;\nreturn " + source + ";")(HELPERS);
}

// ---------- The generated test scripts.

const SCRIPTS = {
  "healthcare-build": (test, assert, code) => {
    // <test-script>
    const { appealReady } = code;
    const line = (over = {}) => ({ carc: "CO-50", noteRef: "DOC-318", filingDeadline: "2026-11-18", ...over });

    test("AC-1 blocks ready when the clinical-note reference is missing", () => {
      assert.deepEqual(appealReady(line({ noteRef: "" })), { ready: false, missing: ["clinical-note reference"] });
    });
    test("AC-2 blocks ready when the filing deadline is missing", () => {
      assert.deepEqual(appealReady(line({ filingDeadline: "" })), { ready: false, missing: ["filing deadline"] });
    });
    test("AC-3 allows ready when both are present", () => {
      assert.deepEqual(appealReady(line()), { ready: true, missing: [] });
    });
    test("AC-4 leaves CO-16 unchanged", () => {
      assert.deepEqual(appealReady(line({ carc: "CO-16", noteRef: "" })).missing, []);
    });
    test("AC-5 refuses an appeal on PR-1", () => {
      assert.equal(appealReady(line({ carc: "PR-1" })).ready, false);
    });
    test("AC-6 names the missing items", () => {
      const result = appealReady(line({ noteRef: "", filingDeadline: "" }));
      assert.deepEqual(result.missing, ["clinical-note reference", "filing deadline"]);
    });
    // </test-script>
  },
  "education-build": (test, assert, code) => {
    // <test-script>
    const { riskFlag, canSeeFlag, rosterFor } = code;
    const student = (over = {}) => ({ id: "STU-104", present: 20, schoolDays: 20, failingGrades: 0, clearDays: 0, ...over });

    test("flags 17 of 20 days (85%)", () => {
      assert.deepEqual(riskFlag(student({ present: 17 })), { flagged: true, reasons: ["attendance"] });
    });
    test("does not flag exactly 90%", () => {
      assert.equal(riskFlag(student({ present: 18 })).flagged, false);
    });
    test("flags two failing grades", () => {
      assert.deepEqual(riskFlag(student({ failingGrades: 2 })).reasons, ["grades"]);
    });
    test("does not flag one failing grade", () => {
      assert.equal(riskFlag(student({ failingGrades: 1 })).flagged, false);
    });
    test("clears after 10 school days", () => {
      assert.equal(riskFlag(student({ present: 17, clearDays: 10 })).flagged, false);
    });
    test("hidden from teachers and rosters", () => {
      assert.equal(canSeeFlag("teacher"), false);
      assert.ok(rosterFor("7B").every((row) => !("flag" in row)));
    });
    test("visible to the counsellor and head of year", () => {
      assert.equal(canSeeFlag("counsellor"), true);
      assert.equal(canSeeFlag("head-of-year"), true);
    });
    // </test-script>
  },
  "fmcg-build": (test, assert, code) => {
    // <test-script>
    const { daysOfCover, createAlerter } = code;
    const check = (alerter, over = {}) =>
      alerter.check({ distributor: "DIST-27", sku: "SKU-4471", stock: 300, sellOut: 1680, weeks: 4, date: "2026-11-10", ...over });

    test("840 units at 60 a day is 14 days, no alert", () => {
      assert.equal(daysOfCover(840, 1680, 4), 14);
      assert.equal(check(createAlerter(), { stock: 840 }), null);
    });
    test("300 units at 60 a day is 5 days, alert", () => {
      assert.equal(daysOfCover(300, 1680, 4), 5);
      assert.ok(check(createAlerter()));
    });
    test("sends one alert per day", () => {
      const alerter = createAlerter();
      assert.ok(check(alerter));
      assert.equal(check(alerter), null);
    });
    test("two products at one distributor alert separately", () => {
      const alerter = createAlerter();
      assert.ok(check(alerter));
      assert.ok(check(alerter, { sku: "SKU-4472" }));
    });
    test("a new product uses the weeks it has", () => {
      assert.equal(daysOfCover(840, 840, 2), 14);
    });
    test("zero sales never divides by zero", () => {
      assert.equal(daysOfCover(300, 0, 4), Infinity);
      assert.equal(check(createAlerter(), { sellOut: 0 }), null);
    });
    test("exactly 7 days of cover does not alert", () => {
      assert.equal(check(createAlerter(), { stock: 420 }), null);
    });
    // </test-script>
  },
  "finance-build": (test, assert, code) => {
    // <test-script>
    const { prequalify } = code;
    const input = (over = {}) => ({ grossMonthlyIncome: 7500, monthlyDebt: 1500, newPayment: 900, creditScore: 700, ...over });

    test("45% is not pre-qualified", () => {
      const result = prequalify(input({ grossMonthlyIncome: 6000, monthlyDebt: 1800 }));
      assert.equal(result.prequalified, false);
      assert.equal(result.dti, 0.45);
    });
    test("32% is pre-qualified", () => {
      assert.equal(prequalify(input()).prequalified, true);
    });
    test("exactly 43% is pre-qualified", () => {
      assert.equal(prequalify(input({ grossMonthlyIncome: 6000, monthlyDebt: 1680 })).prequalified, true);
    });
    test("credit score 639 is declined with its reason", () => {
      const result = prequalify(input({ creditScore: 639 }));
      assert.equal(result.prequalified, false);
      assert.match(result.reasons[0], /credit score/);
    });
    test("decline says it is not a final decision", () => {
      assert.match(prequalify(input({ creditScore: 639 })).reasons.join(" "), /not a final decision/);
    });
    test("input type rejects an age field", () => {
      assert.throws(() => prequalify({ ...input(), age: 61 }), /unknown field: age/);
    });
    test("credit score 640 is accepted", () => {
      assert.equal(prequalify(input({ creditScore: 640 })).prequalified, true);
    });
    test("43.01% is not pre-qualified", () => {
      assert.equal(prequalify(input({ grossMonthlyIncome: 6000, monthlyDebt: 1680.6 })).prequalified, false);
    });
    // </test-script>
  },
  "logistics-build": (test, assert, code) => {
    // <test-script>
    const { minutesLate, toUtc, createNotifier, formatForCustomer } = code;
    const promised = { local: "2026-11-12T18:00", zone: "Asia/Kolkata" };

    test("30 minutes late: no notice", () => {
      assert.equal(minutesLate(promised, "2026-11-12T13:00Z"), 30);
      assert.equal(createNotifier().update("SHP-5120", promised, "2026-11-12T13:00Z"), null);
    });
    test("3 hours late: notice", () => {
      assert.equal(minutesLate(promised, "2026-11-12T15:30Z"), 180);
      assert.ok(createNotifier().update("SHP-5121", promised, "2026-11-12T15:30Z"));
    });
    test("second slip of 2 more hours sends a second notice", () => {
      const notifier = createNotifier();
      notifier.update("SHP-5121", promised, "2026-11-12T15:30Z");
      assert.ok(notifier.update("SHP-5121", promised, "2026-11-12T17:30Z"));
    });
    test("a small further slip sends nothing", () => {
      const notifier = createNotifier();
      notifier.update("SHP-5121", promised, "2026-11-12T15:30Z");
      assert.equal(notifier.update("SHP-5121", promised, "2026-11-12T16:00Z"), null);
    });
    test("daylight-saving delivery date uses that day's offset", () => {
      assert.equal(toUtc({ local: "2026-11-02T18:00", zone: "America/New_York" }), "2026-11-02T23:00Z");
    });
    test("times shown in the delivery's local zone", () => {
      assert.equal(formatForCustomer("2026-11-12T15:30Z", "Asia/Kolkata"), "12 Nov, 21:00 (India time)");
    });
    test("the 2-hour line: 120 minutes late sends nothing, 121 sends a notice", () => {
      assert.equal(createNotifier().update("SHP-5122", promised, "2026-11-12T14:30Z"), null);
      assert.ok(createNotifier().update("SHP-5123", promised, "2026-11-12T14:31Z"));
    });
    // </test-script>
  },
};

// ---------- Claude's own unit tests, written with the code. They cover what the author thought of, and pass
// on the first version too: the independent tests above are what catch the bug.

const UNIT_SCRIPTS = {
  "healthcare-build": (test, assert, code) => {
    // <unit-script>
    const { appealReady } = code;

    test("ready when the note and deadline are present", () => {
      assert.equal(appealReady({ carc: "CO-50", noteRef: "DOC-318", filingDeadline: "2026-11-18" }).ready, true);
    });
    test("not ready without a deadline", () => {
      assert.deepEqual(appealReady({ carc: "CO-50", noteRef: "DOC-318", filingDeadline: "" }).missing, ["filing deadline"]);
    });
    test("names both items when both are missing", () => {
      assert.equal(appealReady({ carc: "CO-50", noteRef: "", filingDeadline: "" }).missing.length, 2);
    });
    test("PR-1 is never appealable", () => {
      assert.equal(appealReady({ carc: "PR-1", noteRef: "DOC-318", filingDeadline: "2026-11-18" }).ready, false);
    });
    test("other codes are not gated", () => {
      assert.equal(appealReady({ carc: "CO-16", noteRef: "", filingDeadline: "" }).ready, true);
    });
    // </unit-script>
  },
  "education-build": (test, assert, code) => {
    // <unit-script>
    const { riskFlag, canSeeFlag } = code;
    const student = (over = {}) => ({ present: 20, schoolDays: 20, failingGrades: 0, clearDays: 0, ...over });

    test("flags 17 of 20 days", () => {
      assert.equal(riskFlag(student({ present: 17 })).flagged, true);
    });
    test("flags two failing grades", () => {
      assert.equal(riskFlag(student({ failingGrades: 2 })).flagged, true);
    });
    test("one failing grade alone is not flagged", () => {
      assert.equal(riskFlag(student({ failingGrades: 1 })).flagged, false);
    });
    test("clears after 10 school days", () => {
      assert.equal(riskFlag(student({ present: 17, clearDays: 10 })).flagged, false);
    });
    test("the counsellor can see the flag", () => {
      assert.equal(canSeeFlag("counsellor"), true);
    });
    // </unit-script>
  },
  "fmcg-build": (test, assert, code) => {
    // <unit-script>
    const { daysOfCover, createAlerter } = code;

    test("840 units at 60 a day is 14 days", () => {
      assert.equal(daysOfCover(840, 1680, 4), 14);
    });
    test("300 units at 60 a day is 5 days", () => {
      assert.equal(daysOfCover(300, 1680, 4), 5);
    });
    test("a new product uses the weeks it has", () => {
      assert.equal(daysOfCover(840, 840, 2), 14);
    });
    test("no sales means unlimited cover", () => {
      assert.equal(daysOfCover(300, 0, 4), Infinity);
    });
    test("sends one alert per day", () => {
      const alerter = createAlerter();
      const order = { distributor: "DIST-27", sku: "SKU-4471", stock: 300, sellOut: 1680, weeks: 4, date: "2026-11-10" };
      assert.ok(alerter.check(order));
      assert.equal(alerter.check(order), null);
    });
    // </unit-script>
  },
  "finance-build": (test, assert, code) => {
    // <unit-script>
    const { prequalify } = code;
    const input = (over = {}) => ({ grossMonthlyIncome: 7500, monthlyDebt: 1500, newPayment: 900, creditScore: 700, ...over });

    test("45% is not pre-qualified", () => {
      assert.equal(prequalify(input({ grossMonthlyIncome: 6000, monthlyDebt: 1800 })).prequalified, false);
    });
    test("32% is pre-qualified", () => {
      assert.equal(prequalify(input()).prequalified, true);
    });
    test("credit score 639 is declined", () => {
      assert.equal(prequalify(input({ creditScore: 639 })).prequalified, false);
    });
    test("reasons say it is not a final decision", () => {
      assert.match(prequalify(input({ creditScore: 639 })).reasons.join(" "), /not a final decision/);
    });
    test("dti is rounded to basis points", () => {
      assert.equal(prequalify(input({ grossMonthlyIncome: 6000, monthlyDebt: 1800 })).dti, 0.45);
    });
    // </unit-script>
  },
  "logistics-build": (test, assert, code) => {
    // <unit-script>
    const { minutesLate, toUtc, createNotifier, formatForCustomer } = code;
    const promised = { local: "2026-11-12T18:00", zone: "Asia/Kolkata" };

    test("30 minutes late is not notified", () => {
      assert.equal(createNotifier().update("SHP-5120", promised, "2026-11-12T13:00Z"), null);
    });
    test("3 hours late is notified", () => {
      assert.equal(minutesLate(promised, "2026-11-12T15:30Z"), 180);
      assert.ok(createNotifier().update("SHP-5121", promised, "2026-11-12T15:30Z"));
    });
    test("a small further slip sends nothing", () => {
      const notifier = createNotifier();
      notifier.update("SHP-5121", promised, "2026-11-12T15:30Z");
      assert.equal(notifier.update("SHP-5121", promised, "2026-11-12T16:00Z"), null);
    });
    test("daylight-saving date uses that day's offset", () => {
      assert.equal(toUtc({ local: "2026-11-02T18:00", zone: "America/New_York" }), "2026-11-02T23:00Z");
    });
    test("times shown in the local zone", () => {
      assert.equal(formatForCustomer("2026-11-12T15:30Z", "Asia/Kolkata"), "12 Nov, 21:00 (India time)");
    });
    // </unit-script>
  },
};

export const LIVE_TESTS = Object.keys(SCRIPTS);

/**
 * Runs a build workflow's tests against the first version of its feature, or the fixed one: the generated
 * acceptance tests by default, or with suite "unit" Claude's own unit tests.
 */
export function runTests(id, version = "fixed", suite = "acceptance") {
  return runSuite(id, instantiate(sourceOf(id, version)), suite);
}

function runSuite(id, code, suite) {
  const results = [];
  const test = (name, body) => {
    const started = typeof performance !== "undefined" ? performance.now() : Date.now();
    let error = null;
    try {
      body();
    } catch (caught) {
      error = caught instanceof AssertionError ? caught.message : `${caught.name}: ${caught.message}`;
    }
    const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
    results.push({ name, pass: !error, message: error, ms });
  };
  (suite === "unit" ? UNIT_SCRIPTS : SCRIPTS)[id](test, assert, code);
  return results;
}

// ---------- Mutation testing: break the fixed code in small, systematic ways and count how many broken
// versions the tests notice. A surviving mutant is a change the tests cannot tell apart from the real code.

const OPERATORS = [
  { name: "<= to <", pattern: /<=/g, to: "<" },
  { name: ">= to >", pattern: />=/g, to: ">" },
  { name: "< to <=", pattern: /(?<![<=])<(?![=<])/g, to: "<=" },
  { name: "> to >=", pattern: /(?<![=>-])>(?![=>])/g, to: ">=" },
  { name: "=== to !==", pattern: /===/g, to: "!==" },
  { name: "!== to ===", pattern: /!==/g, to: "===" },
  { name: "&& to ||", pattern: /&&/g, to: "||" },
  { name: "|| to &&", pattern: /\|\|/g, to: "&&" },
  { name: "true to false", pattern: /\btrue\b/g, to: "false" },
  { name: "false to true", pattern: /\bfalse\b/g, to: "true" },
  { name: "number + 1", pattern: /(?<![\w.{])\d+(?:\.\d+)?(?![\w}])/g, to: (match) => String(Number(match) + 1) },
];

/** Runs every mutant of a feature against its acceptance and unit tests. */
export function mutationTest(id) {
  return mutate(SOURCES[id], (source) => {
    const code = instantiate(source);
    return [...runSuite(id, code, "acceptance"), ...runSuite(id, code, "unit")];
  });
}

function mutate(source, runAll) {
  // Text inside string and regex literals is data, not logic; changing "STU-104" proves nothing.
  const literals = [...source.matchAll(/"(?:[^"\\]|\\.)*"|\/\^[^\n]*?\$\//g)].map((match) => [match.index, match.index + match[0].length]);
  const inLiteral = (at) => literals.some(([start, end]) => at >= start && at < end);
  const mutants = [];
  for (const operator of OPERATORS) {
    for (const match of source.matchAll(operator.pattern)) {
      if (inLiteral(match.index)) continue;
      const replacement = typeof operator.to === "function" ? operator.to(match[0]) : operator.to;
      const at = match.index;
      const lineStart = source.lastIndexOf("\n", at) + 1;
      const lineEnd = source.indexOf("\n", at);
      mutants.push({
        operator: operator.name,
        line: source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim(),
        source: source.slice(0, at) + replacement + source.slice(at + match[0].length),
      });
    }
  }
  const results = [];
  for (const mutant of mutants) {
    let outcome;
    try {
      outcome = runAll(mutant.source);
    } catch {
      continue; // Not valid code: not a meaningful mutant.
    }
    const failing = outcome.filter((result) => !result.pass);
    results.push({ operator: mutant.operator, line: mutant.line, killed: failing.length > 0, by: failing[0] ? failing[0].name : null });
  }
  return { total: results.length, killed: results.filter((result) => result.killed).length, results };
}

// ---------- Model-written code and tests, recorded from real runs. They run only if they pass a safety scan:
// no network, files, timers, globals or dynamic code. (They also ran first in a time-limited server sandbox.)

const FORBIDDEN = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|import|require|process|globalThis|window|document|self|eval|Function|setTimeout|setInterval|setImmediate|localStorage|sessionStorage|indexedDB|navigator|Worker|postMessage|constructor|__proto__)\b/g;

/** The forbidden names a piece of model-written code uses, ignoring text inside string literals. */
export function unsafeNames(source) {
  const code = String(source).replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
  return [...new Set(code.match(FORBIDDEN) || [])];
}

function instantiateRecorded(source) {
  const unsafe = unsafeNames(source);
  if (unsafe.length) throw new Error("refused to run: uses " + unsafe.join(", "));
  return new Function('"use strict"; return (' + source + ");")();
}

function runScriptAgainst(code, script) {
  const unsafe = unsafeNames(script);
  if (unsafe.length) throw new Error("refused to run the tests: they use " + unsafe.join(", "));
  const results = [];
  const test = (name, body) => {
    const started = typeof performance !== "undefined" ? performance.now() : Date.now();
    let error = null;
    try {
      body();
    } catch (caught) {
      error = caught instanceof AssertionError ? caught.message : `${caught && caught.name}: ${caught && caught.message}`;
    }
    results.push({ name, pass: !error, message: error, ms: (typeof performance !== "undefined" ? performance.now() : Date.now()) - started });
  };
  new Function("test", "assert", "code", '"use strict";\n' + script)(test, assert, code);
  return results;
}

/** Runs a recorded test script against recorded code. */
export function runRecorded(codeSource, script) {
  return runScriptAgainst(instantiateRecorded(codeSource), script);
}

/** Mutation testing on recorded code: every small break, every given test script re-run against it. */
export function mutationTestRecorded(codeSource, scripts) {
  return mutate(codeSource, (source) => {
    const code = instantiateRecorded(source);
    return scripts.flatMap((script) => runScriptAgainst(code, script));
  });
}

/** The text a test runner prints for these results. */
export function report(results) {
  const failing = results.filter((result) => !result.pass).length;
  const lines = results.map((result) => (result.pass ? `✓ ${result.name}` : `✗ ${result.name}\n  ${result.message}`));
  lines.push(failing ? `${failing} failing, ${results.length - failing} passing` : `${results.length} passing`);
  return lines.join("\n");
}
