import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { repoRoot } from "@northwind/orchestrator";
import { type LiveRecord, type Rating, analyze, cohenKappa, collectFindings, packetFor, parseCsv, parseRatings, ratingKey, ratingSheet, renderReport, toCsv, wilson } from "./judging.ts";

const dir = join(repoRoot(), "evals/live-build/records");
const records: LiveRecord[] = readdirSync(dir)
  .filter((name) => name.endsWith(".json"))
  .map((name) => ({ ...JSON.parse(readFileSync(join(dir, name), "utf8")), label: name.replace(/\.json$/, "") }));
const findings = collectFindings(records);

test("The ten live build records hold 29 findings: 20 on the requirements, 8 on designs and 1 on code.", () => {
  assert.equal(records.length, 10);
  assert.equal(findings.length, 29);
  const count = (stage: string) => findings.filter((item) => item.stage === stage).length;
  assert.equal(count("panel-A") + count("panel-B") + count("panel-final"), 20);
  assert.equal(count("design"), 8);
  assert.equal(count("code"), 1);
});

test("Nine of the findings are rated P0. Each finding has a number, a title and an explanation.", () => {
  assert.equal(findings.filter((item) => item.severity === "P0").length, 9);
  assert.deepEqual(findings.map((item) => item.fid).slice(0, 3), ["F01", "F02", "F03"]);
  assert.equal(new Set(findings.map((item) => item.fid)).size, 29);
  for (const item of findings) assert.ok(item.title && item.detail, `${item.fid} has no text`);
});

test("The builder's answer is attached to a requirements finding, a design finding and a code finding.", () => {
  const find = (build: string, id: string) => findings.find((item) => item.build === build && item.id === id)!;
  assert.equal(find("10-pallets-contradiction", "D-A1").response?.outcome, "fixed");
  assert.equal(find("03-grade-weights", "AR-1").response?.outcome, "applied");
  const code = find("05-stacked-promo", "CR-1");
  assert.equal(code.response?.outcome, "declined");
  assert.match(code.response?.note ?? "", /BigInt/);
});

test("The finding that points at a quoted passage keeps the passage. A design finding has none.", () => {
  const quoted = findings.find((item) => item.build === "10-pallets-contradiction" && item.id === "D-A1")!;
  assert.equal(quoted.quote, "100 / 48 = 2.08");
  assert.equal(findings.find((item) => item.stage === "design")!.quote, "");
});

test("The reviewing model of a finding comes from the call that made it.", () => {
  const find = (build: string, id: string) => findings.find((item) => item.build === build && item.id === id)!;
  assert.match(find("10-pallets-contradiction", "D-A1").reviewer, /grok/);
  assert.match(find("10-pallets-contradiction", "D-B1").reviewer, /claude/);
  assert.match(find("05-stacked-promo", "CR-1").reviewer, /grok/);
});

test("The rating sheet names no model. The key does.", () => {
  const sheet = ratingSheet(findings);
  assert.ok(!/grok|claude|opus/i.test(sheet), "the sheet names a model");
  assert.ok(!/grok|claude|opus/i.test(records.map((record) => packetFor(record, findings)).join("\n")), "a packet names a model");
  assert.ok(Object.values(ratingKey(findings)).every((entry) => /grok|claude/.test(entry.reviewer)));
});

test("The rating sheet has one row for each finding and four empty columns for the rater.", () => {
  const rows = parseCsv(ratingSheet(findings));
  assert.equal(rows.length, 30);
  const header = rows[0]!;
  assert.deepEqual(header.slice(-4), ["real", "severity_check", "resolution_check", "comment"]);
  assert.ok(rows.slice(1).every((row) => row.slice(-4).every((cell) => cell === "")));
});

test("A packet holds the brief, its own findings and the text they are about. It holds no other build's findings.", () => {
  const record = records.find((item) => item.label === "05-stacked-promo")!;
  const packet = packetFor(record, findings);
  assert.ok(packet.includes(record.brief));
  for (const item of findings.filter((entry) => entry.build === "05-stacked-promo")) assert.ok(packet.includes(`### ${item.fid} ·`));
  assert.ok(!packet.includes("### F01 ·"));
  assert.ok(packet.includes("What was reviewed"));
  const clean = packetFor(records.find((item) => item.label === "06-reorder-point")!, findings);
  assert.match(clean, /There is nothing to rate/);
});

test("CSV keeps commas, quotes and line breaks inside a field.", () => {
  const rows = [["a", 'he said "no", twice', "line one\nline two"], ["", "x", ""]];
  assert.deepEqual(parseCsv(toCsv(rows)), [["a", 'he said "no", twice', "line one\nline two"], ["", "x", ""]].filter((row) => row.some(Boolean)));
});

test("The Wilson interval is wide for few findings and stays between 0 and 1.", () => {
  const none = wilson(0, 10);
  assert.equal(none.low, 0);
  assert.ok(Math.abs(none.high - 0.2775) < 0.001);
  const half = wilson(5, 10);
  assert.ok(Math.abs(half.low - 0.2366) < 0.001 && Math.abs(half.high - 0.7634) < 0.001);
  assert.ok(Number.isNaN(wilson(0, 0).rate));
  assert.equal(wilson(10, 10).high, 1);
});

test("Kappa is 1 for full agreement and 0 for agreement no better than chance.", () => {
  assert.equal(cohenKappa([true, false, true, false], [true, false, true, false]), 1);
  assert.equal(cohenKappa([true, true, false, false], [true, false, true, false]), 0);
  assert.ok(cohenKappa([true, true, true, false], [true, true, false, false]) > 0);
});

const rate = (real: Rating["real"], severity: Rating["severity"] = "right", resolution: Rating["resolution"] = "good"): Rating => ({ real, severity, resolution, comment: "" });
const key = ratingKey(findings.slice(0, 6));
const fids = Object.keys(key);

test("A finding is a false alarm when every rater who decided said no. It is disputed when they differ.", () => {
  const one = new Map<string, Rating>([[fids[0]!, rate("yes")], [fids[1]!, rate("no")], [fids[2]!, rate("partly")], [fids[3]!, rate("no")], [fids[4]!, rate("unsure")]]);
  const two = new Map<string, Rating>([[fids[0]!, rate("yes")], [fids[1]!, rate("no")], [fids[2]!, rate("no")], [fids[3]!, rate("yes")]]);
  const report = analyze(key, [{ name: "one", ratings: one }, { name: "two", ratings: two }]);
  assert.deepEqual([fids[0], fids[1], fids[2], fids[3], fids[4], fids[5]].map((fid) => report.verdicts[fid!]), ["real", "false alarm", "disputed", "disputed", "unrated", "unrated"]);
  assert.deepEqual(report.counts, { real: 1, "false alarm": 1, disputed: 2, unrated: 2 });
  assert.deepEqual([report.falseAlarm.k, report.falseAlarm.n], [1, 2]);
  assert.deepEqual([report.falseAlarmLenient.k, report.falseAlarmLenient.n], [3, 4]);
  assert.deepEqual(report.disputed, [fids[2], fids[3]]);
});

test("Agreement counts only the findings that both raters decided.", () => {
  const one = new Map<string, Rating>([[fids[0]!, rate("yes")], [fids[1]!, rate("no")], [fids[2]!, rate("yes")], [fids[3]!, rate("unsure")]]);
  const two = new Map<string, Rating>([[fids[0]!, rate("partly")], [fids[1]!, rate("no")], [fids[2]!, rate("no")], [fids[3]!, rate("yes")]]);
  const report = analyze(key, [{ name: "one", ratings: one }, { name: "two", ratings: two }]);
  assert.deepEqual([report.agreement?.compared, report.agreement?.agreed], [3, 2]);
});

test("With one rater the report still works, and it says agreement needs two.", () => {
  const solo = new Map<string, Rating>([[fids[0]!, rate("no", "too_high", "bad")], [fids[1]!, rate("yes")]]);
  const report = analyze(key, [{ name: "solo", ratings: solo }]);
  assert.equal(report.agreement, null);
  assert.deepEqual([report.falseAlarm.k, report.falseAlarm.n], [1, 2]);
  assert.deepEqual([report.tooHigh.k, report.badResolution.k], [1, 1]);
  assert.match(renderReport(report), /Agreement: needs two raters/);
});

test("The report breaks the false alarms down by severity, stage and reviewing model.", () => {
  const all = collectFindings(records);
  const bigKey = ratingKey(all);
  const mark = new Map<string, Rating>(Object.keys(bigKey).map((fid) => [fid, rate(bigKey[fid]!.severity === "P0" ? "no" : "yes")]));
  const report = analyze(bigKey, [{ name: "a", ratings: mark }]);
  assert.deepEqual([report.bySeverity.P0!.k, report.bySeverity.P0!.n], [9, 9]);
  assert.equal(report.bySeverity.P1!.k, 0);
  assert.ok(Object.keys(report.byReviewer).length === 2);
  assert.ok(Object.keys(report.byStage).length >= 4);
});

test("A sheet that a rater filled in is read back, with the answers in lower case.", () => {
  const sheet = ratingSheet(findings.slice(0, 2)).split("\n");
  const filled = [sheet[0], sheet[1]!.replace(/,,,,$/, ",YES,Too_High,Good,checked in node"), sheet[2]].join("\n");
  const ratings = parseRatings(filled);
  assert.deepEqual(ratings.get("F01"), { real: "yes", severity: "too_high", resolution: "good", comment: "checked in node" });
  assert.equal(ratings.get("F02")!.real, "");
});
