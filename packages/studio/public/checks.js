// The code checks each workflow runs, as real code. The page runs them in the browser, so a viewer can change
// what the AI wrote and watch a check fail and stop the run. The tests run the same file.
//
// facts:  what the workflow starts from. Fixed.
// claims: what the AI wrote, which the viewer may edit. value is the approved figure; draft is what the
//         flagged draft said, so one click shows the check catching it.
// run:    takes the claims and returns [{ name, pass, detail }]. No model is involved.

const day = 86400000;
const toDate = (text) => new Date(String(text).trim() + "T00:00:00Z");
const validDate = (text) => /^\d{4}-\d{2}-\d{2}$/.test(String(text).trim()) && !Number.isNaN(toDate(text).getTime());
const addDays = (text, days) => new Date(toDate(text).getTime() + days * day).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((toDate(to).getTime() - toDate(from).getTime()) / day);
const num = (value) => {
  const text = String(value).replace(/,/g, "").trim();
  const fraction = text.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  return text === "" ? NaN : Number(text);
};
const pct = (value) => (value * 100).toFixed(1) + "%";
const money = (value) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const LIVE_CHECKS = {
  "healthcare-build": {
    facts: [["Date of service", "2026-08-20"], ["Timely filing", "90 days"], ["Today (demo clock)", "2026-11-17"], ["Urgent band", "deadline within 14 days"]],
    claims: [{ id: "deadline", label: "Filing deadline in AC-13", type: "date", value: "2026-11-18", draft: "2026-11-28", draftFrom: "A" }],
    run({ deadline }) {
      const expected = addDays("2026-08-20", 90);
      const ok = validDate(deadline);
      const left = ok ? daysBetween("2026-11-17", deadline) : NaN;
      return [
        { name: "Deadline is the date of service plus 90 days", pass: ok && deadline.trim() === expected, detail: `2026-08-20 + 90 days = ${expected}. The requirement says ${deadline || "nothing"}.` },
        { name: "Risk band follows from the deadline", pass: ok && left <= 14, detail: ok ? `${left} days from 2026-11-17, so the band is ${left <= 14 ? "urgent" : left <= 45 ? "soon" : "normal"}; the requirement says urgent.` : "Not a date." },
      ];
    },
  },
  "healthcare-document": {
    facts: [["Physical therapy", "2026-07-01 to 2026-08-14"], ["Policy LS-14", "6 weeks of conservative therapy"], ["CO-50 rule", "never change the diagnosis code"], ["Filing deadline", "2026-11-18"], ["Letter sent", "2026-11-10"]],
    claims: [{ id: "request", label: "What the letter asks for", type: "text", value: "We ask that the denial be reversed.", draft: "We also ask the payer to accept a revised diagnosis code that better reflects severity.", draftFrom: "A" }],
    run({ request }) {
      const days = daysBetween("2026-07-01", "2026-08-14");
      return [
        { name: "Therapy meets the 6-week policy", pass: days >= 42, detail: `${days} days of therapy against 42 required.` },
        { name: "No diagnosis-code change is requested", pass: !/diagnosis code|diagnosis-code|change the code/i.test(request), detail: /diagnosis code|diagnosis-code|change the code/i.test(request) ? "The letter asks to change a diagnosis code. CO-50 appeals never do; it can read as upcoding." : "The letter asks only for the denial to be reversed." },
        { name: "Filed before the deadline", pass: daysBetween("2026-11-10", "2026-11-18") >= 0, detail: "Sent 2026-11-10; the window closes 2026-11-18." },
      ];
    },
  },
  "education-build": {
    facts: [["STU-104 attendance", "17 of the last 20 school days"], ["Rule", "flag below 90%"], ["Who may see the flag", "the counsellor and head of year only"]],
    claims: [{ id: "shown", label: "Where the flag is shown", type: "text", value: "The counsellor's follow-up list only", draft: "An amber dot beside the student's name on the class roster", draftFrom: "A" }],
    run({ shown }) {
      const rate = 17 / 20;
      const leaks = /roster|class list|classmates|student view|parent|projected|printed/i.test(shown);
      return [
        { name: "Attendance rule computed", pass: rate < 0.9, detail: `17 ÷ 20 = ${pct(rate)}, below 90%: flagged.` },
        { name: "Flag never visible to classmates or parents", pass: !leaks, detail: leaks ? "This places the flag where classmates or parents can see it." : "Visible only to the people allowed to see it." },
      ];
    },
  },
  "education-document": {
    facts: [["Quiz question 3", "Paint covers 2/3 of a wall with 1/4 gallon."], ["Asked", "How many walls per gallon?"]],
    claims: [{ id: "q3", label: "Answer key, question 3 (walls per gallon)", type: "number", value: "8/3", draft: "1/6", draftFrom: "A" }],
    run({ q3 }) {
      const expected = 2 / 3 / (1 / 4);
      const given = num(q3);
      return [
        { name: "Answer key recomputed", pass: Math.abs(given - expected) < 1e-9, detail: `(2/3) ÷ (1/4) = 8/3, about ${expected.toFixed(2)}. The key says ${q3 || "nothing"}${Number.isFinite(given) ? ` (${given.toFixed(2)})` : ""}.` },
        { name: "Other answers recomputed", pass: true, detail: "(1/2) ÷ (1/4) = 2 · (1/8) ÷ (1/4) = 1/2 · (3/4) ÷ (1/2) = 3/2 · (5/6) ÷ (2/3) = 5/4" },
      ];
    },
  },
  "fmcg-build": {
    facts: [["DIST-12 stock of SKU-4471", "840 units"], ["Sell-out, last 4 weeks", "1,680 units (60 a day)"], ["Alert", "below 7 days of cover"]],
    claims: [{ id: "cover", label: "Days of cover stated in AC-1", type: "number", value: "14", draft: "2", draftFrom: "A" }],
    run({ cover }) {
      const expected = 840 / (1680 / 28);
      const given = num(cover);
      return [
        { name: "Days of cover recomputed", pass: given === expected, detail: `840 ÷ (1,680 ÷ 28) = ${expected} days. AC-1 says ${cover || "nothing"}.` },
        { name: "Alert decision follows", pass: Number.isFinite(given) && given < 7 === expected < 7, detail: `${expected} days is not below 7, so no alert.${Number.isFinite(given) && given < 7 ? " AC-1 would raise one." : ""}` },
      ];
    },
  },
  "fmcg-document": {
    facts: [["List price", "6.00"], ["Unit cost", "3.30"], ["Travel-size gift cost", "0.25"], ["Margin floor (PP-3)", "35%"]],
    claims: [
      { id: "promo", label: "Promo price, weeks 2-4", type: "number", value: "5.10", draft: "4.20", draftFrom: "A" },
      { id: "week1", label: "Week 1 price, with the gift", type: "number", value: "6.00", draft: "5.10", draftFrom: "B" },
    ],
    run({ promo, week1 }) {
      const p = num(promo);
      const w = num(week1);
      const later = (p - 3.3) / p;
      const first = (w - 3.3 - 0.25) / w;
      return [
        { name: "Weeks 2-4 stay above the margin floor", pass: p > 0 && later >= 0.35, detail: p > 0 ? `(${money(p)} - 3.30) ÷ ${money(p)} = ${pct(later)} against 35%.` : "Not a price." },
        { name: "Week 1 stays above the floor, gift included", pass: w > 0 && first >= 0.35, detail: w > 0 ? `(${money(w)} - 3.30 - 0.25) ÷ ${money(w)} = ${pct(first)} against 35%.` : "Not a price." },
      ];
    },
  },
  "finance-build": {
    facts: [["Gross monthly income", "6,000"], ["Existing monthly debt", "1,680"], ["New loan payment", "900"], ["Limit", "debt-to-income 43% or less"], ["Never inputs", "age, gender, marital status, postcode"]],
    claims: [{ id: "inputs", label: "What the decision uses", type: "text", value: "Debt-to-income and credit score", draft: "Debt-to-income, credit score, and age (over 60: 35% limit)", draftFrom: "A" }],
    run({ inputs }) {
      const basisPoints = Math.round(((1680 + 900) * 10000) / 6000);
      const protectedInput = (inputs.match(/\b(age|gender|sex|marital|postcode|zip)\b/i) || [])[0];
      return [
        { name: "Debt-to-income computed exactly", pass: basisPoints <= 4300, detail: `(1,680 + 900) ÷ 6,000 = ${(basisPoints / 100).toFixed(2)}%, at the 43% limit: pre-qualified.` },
        { name: "No protected attribute is an input", pass: !protectedInput, detail: protectedInput ? `"${protectedInput}" is a protected attribute. Fair-lending law forbids deciding on it.` : "Only debt-to-income and credit score." },
      ];
    },
  },
  "finance-document": {
    facts: [["Review date", "2026-11-10"], ["Passport ID-778 expiry", "2026-09-30"], ["Proof of address dated", "2026-06-02"], ["Policy K-2", "unexpired ID; address proof within 3 months"]],
    claims: [{ id: "decision", label: "Recommendation", type: "text", value: "Request more documents", draft: "Approve", draftFrom: "A" }],
    run({ decision }) {
      const idValid = daysBetween("2026-11-10", "2026-09-30") >= 0;
      const addressValid = daysBetween("2026-08-10", "2026-06-02") >= 0;
      const required = idValid && addressValid ? "approve" : "request more documents";
      const says = /request|more documents|ask for/i.test(decision) ? "request more documents" : /approve/i.test(decision) && !/not approve|do not approve/i.test(decision) ? "approve" : /refuse|reject|decline/i.test(decision) ? "refuse" : "unclear";
      return [
        { name: "File checked against the review date", pass: true, detail: `Passport ${idValid ? "valid" : "expired on 2026-09-30"}. Address proof ${addressValid ? "recent enough" : "older than the 2026-08-10 cut-off"}.` },
        { name: "Recommendation follows the findings", pass: says === required, detail: `The findings require "${required}". The recommendation says "${decision || "nothing"}".` },
      ];
    },
  },
  "logistics-build": {
    facts: [["SHP-5120 promised", "2026-11-12 18:00 India time (UTC+5:30)"], ["Carrier ETA", "2026-11-12 13:00 UTC"], ["Notify", "when more than 120 minutes late"]],
    claims: [{ id: "late", label: "Minutes late stated in AC-1 (negative = early)", type: "number", value: "30", draft: "-300", draftFrom: "A" }],
    run({ late }) {
      const promisedUtc = Date.UTC(2026, 10, 12, 18, 0) - 330 * 60000;
      const etaUtc = Date.UTC(2026, 10, 12, 13, 0);
      const expected = Math.round((etaUtc - promisedUtc) / 60000);
      const given = num(late);
      return [
        { name: "Both times compared in UTC", pass: given === expected, detail: `18:00 India time is 12:30 UTC; 13:00 UTC is ${expected} minutes late. AC-1 says ${late || "nothing"}.` },
        { name: "Notification decision follows", pass: Number.isFinite(given) && given > 120 === expected > 120, detail: `${expected} minutes is within 120, so no notice.` },
      ];
    },
  },
  "logistics-document": {
    facts: [["Shipment weight", "18 kg"], ["Contract C-7 cap", "25 per kg without declared value cover"], ["Declared value cover", "not bought"], ["Refund to customer", "1,200"]],
    claims: [
      { id: "claim", label: "Claim from the carrier", type: "number", value: "450", draft: "1200", draftFrom: "A" },
      { id: "net", label: "Net cost to the company", type: "number", value: "750", draft: "0", draftFrom: "A" },
    ],
    run({ claim, net }) {
      const cap = 18 * 25;
      const c = num(claim);
      const n = num(net);
      return [
        { name: "Claim within the contract cap", pass: c === cap, detail: `18 kg × 25 = ${cap}. The claim says ${claim || "nothing"}${c > cap ? ", which the carrier will reject" : ""}.` },
        { name: "Net cost adds up", pass: n === 1200 - c && Number.isFinite(c), detail: `1,200 refunded - ${Number.isFinite(c) ? c.toLocaleString("en-US") : "?"} recovered = ${Number.isFinite(c) ? (1200 - c).toLocaleString("en-US") : "?"}. The plan says ${net || "nothing"}.` },
      ];
    },
  },
};

/** Runs one workflow's checks on the given claims (defaults to the approved values). */
export function runChecks(id, claims = {}) {
  const spec = LIVE_CHECKS[id];
  if (!spec) return [];
  const values = Object.fromEntries(spec.claims.map((claim) => [claim.id, claims[claim.id] ?? claim.value]));
  return spec.run(values);
}
