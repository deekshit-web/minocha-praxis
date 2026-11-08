import { carcRule, type CarcClass } from "../../domain/src/carc.ts";
import { appealReady } from "../../domain/src/appealReady.ts";
import { buildSeed, type Denial, type Patient, type PracticeSeed } from "../../domain/src/seed.ts";
import { daysRemaining, deadlineRisk, type DeadlineRisk } from "../../domain/src/filing.ts";

export const PROPOSED_SCREENS = ["SCR-1", "SCR-2", "SCR-3"] as const;

export type ProposedScreenId = (typeof PROPOSED_SCREENS)[number];

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function patientName(seed: PracticeSeed, id: string): Patient {
  const patient = seed.patients.find((item) => item.id === id);
  if (!patient) throw new Error(`Unknown patient ${id}`);
  return patient;
}

function riskLabel(days: number | null): { risk: DeadlineRisk; text: string } {
  if (days === null) return { risk: "overdue", text: "No deadline" };
  return { risk: deadlineRisk(days), text: `${days} days` };
}

function queueRows(seed: PracticeSeed): Array<{ denial: Denial; name: string; days: number | null; risk: DeadlineRisk; text: string }> {
  return seed.denials
    .map((denial) => {
      const days = denial.filingDeadline ? daysRemaining(denial.filingDeadline) : null;
      const label = riskLabel(days);
      return { denial, name: patientName(seed, denial.patientId).displayName, days, risk: label.risk, text: label.text };
    })
    .sort((a, b) => (a.days ?? -9999) - (b.days ?? -9999) || a.denial.id.localeCompare(b.denial.id));
}

const MISSING: Record<string, string> = {
  clinicalNoteRef: "Clinical note reference",
  filingDeadline: "Filing deadline",
};

function page(screen: ProposedScreenId, title: string, body: string): string {
  const links = PROPOSED_SCREENS.map((id) => {
    const label = id === "SCR-1" ? "Workqueue" : id === "SCR-2" ? "Denial detail" : "Lead summary";
    const current = id === screen ? ` aria-current="page"` : "";
    return `<a href="/proposed/${id}"${current}>${label}</a>`;
  }).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)} · Proposed</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; background: #f3ecdf; color: #1c1915; font: 15px/1.4 ui-sans-serif, system-ui, sans-serif; }
    header, main { padding: 20px 24px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-end; border-bottom: 1px solid #e3d5c3; }
    h1 { margin: 0; font: 32px/1.1 Palatino, Georgia, serif; font-weight: 500; }
    .badge { border: 1px solid #8d3d2c; color: #8d3d2c; border-radius: 999px; padding: 4px 10px; letter-spacing: 0.08em; text-transform: uppercase; font-size: 12px; }
    nav { display: flex; gap: 8px; margin-top: 12px; }
    a { color: #0e6b66; }
    a[aria-current="page"] { font-weight: 700; }
    table { width: 100%; border-collapse: collapse; background: #fffaf3; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e3d5c3; }
    .overdue, .urgent { color: #8d3d2c; font-weight: 650; }
    .soon { color: #8a5a12; }
    .comfortable { color: #2a6840; }
    .checklist { list-style: none; padding: 0; }
    .checklist li { padding: 8px 0; border-bottom: 1px solid #e3d5c3; }
    button { font: inherit; padding: 8px 14px; border-radius: 999px; border: 1px solid #0e6b66; background: #0e6b66; color: #f7fffe; }
    button:disabled { background: #efe7db; color: #5e564c; border-color: #e3d5c3; }
    .watermark { position: fixed; inset: 30% 0 auto; text-align: center; font: 72px Palatino, Georgia, serif; color: rgba(14, 107, 102, 0.12); pointer-events: none; transform: rotate(-12deg); }
  </style>
</head>
<body>
  <p class="watermark">Proposed</p>
  <header>
    <div>
      <p class="badge">Proposed</p>
      <h1>${esc(title)}</h1>
      <nav>${links}</nav>
    </div>
    <p>Northwind Imaging · synthetic remit</p>
  </header>
  <main>${body}</main>
</body>
</html>`;
}

function workqueue(seed: PracticeSeed): string {
  const rows = queueRows(seed)
    .map((row) => {
      const rule = carcRule(row.denial.carc);
      return `<tr>
        <td>${esc(row.denial.id)}</td>
        <td>${esc(row.name)}</td>
        <td>${esc(row.denial.patientId)}</td>
        <td>${esc(row.denial.carc)}</td>
        <td>${esc(rule?.carcClass ?? "unmapped")}</td>
        <td class="${esc(row.risk)}">${esc(row.text)}</td>
      </tr>`;
    })
    .join("");
  return page(
    "SCR-1",
    "Workqueue",
    `<p>Sorted by days left until the filing deadline. The soonest row is first.</p>
     <table>
       <thead><tr><th>Denial</th><th>Patient</th><th>Id</th><th>CARC</th><th>Class</th><th>Deadline</th></tr></thead>
       <tbody>${rows}</tbody>
     </table>`,
  );
}

function detail(seed: PracticeSeed): string {
  const denial = seed.denials.find((item) => item.carc === "CO-50" && item.clinicalNoteRef === null && item.filingDeadline);
  if (!denial) throw new Error("Seed is missing the CO-50 row with a deadline and no note.");
  const rule = carcRule(denial.carc);
  const ready = appealReady({ carc: denial.carc, clinicalNoteRef: denial.clinicalNoteRef, filingDeadline: denial.filingDeadline });
  const items = ["Clinical note reference", "Filing deadline"].map((label) => {
    const missing = ready.missing.some((field) => MISSING[field] === label);
    return `<li>${esc(label)}: ${missing ? "Missing" : "Present"}</li>`;
  });
  const name = patientName(seed, denial.patientId).displayName;
  return page(
    "SCR-2",
    "Denial detail",
    `<p>${esc(denial.id)} · ${esc(name)} · ${esc(denial.patientId)} · ${esc(denial.claimId)}</p>
     <p>${esc(denial.carc)}. ${esc(rule?.meaning ?? "Unmapped code.")}</p>
     <p>Next action: ${esc(rule?.nextAction ?? "Stop. This code is not in the table.")}</p>
     <ul class="checklist">${items.join("")}</ul>
     <button type="button"${ready.ready ? "" : " disabled"}>Mark appeal ready</button>`,
  );
}

function summary(seed: PracticeSeed): string {
  const counts = new Map<CarcClass | "unmapped", number>();
  for (const denial of seed.denials) {
    const key = carcRule(denial.carc)?.carcClass ?? "unmapped";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rows = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, count]) => `<tr><td>${esc(label)}</td><td>${count}</td></tr>`)
    .join("");
  return page(
    "SCR-3",
    "Lead summary",
    `<p>${seed.denials.length} denials on the synthetic remit.</p>
     <table><thead><tr><th>Class</th><th>Count</th></tr></thead><tbody>${rows}</tbody></table>`,
  );
}

export function renderProposedScreen(id: ProposedScreenId, seed: PracticeSeed = buildSeed()): string {
  if (id === "SCR-1") return workqueue(seed);
  if (id === "SCR-2") return detail(seed);
  if (id === "SCR-3") return summary(seed);
  throw new Error(`Unknown proposed screen ${id}`);
}
