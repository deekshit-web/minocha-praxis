import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { carcRule, type CarcClass } from "../../domain/src/carc.ts";
import { appealReady } from "../../domain/src/appealReady.ts";
import { coverageSnapshot, schedulingDecision } from "../../domain/src/eligibility.ts";
import { buildSeed, type Denial, type PracticeSeed } from "../../domain/src/seed.ts";
import { daysRemaining, deadlineRisk, type DeadlineRisk } from "../../domain/src/filing.ts";

const CLASSES = ["denial", "patient-responsibility", "informational"] as const;

export interface DenialView {
  appealable: boolean;
  ready: boolean;
  missing: string[];
  meaning: string;
  nextAction: string;
  carcClass: CarcClass | "unmapped";
}

const MISSING: Record<string, string> = {
  clinicalNoteRef: "Clinical note reference",
  filingDeadline: "Filing deadline",
};

export function denialView(denial: Denial): DenialView {
  const rule = carcRule(denial.carc);
  if (!rule) {
    return {
      appealable: false,
      ready: false,
      missing: [],
      meaning: "This code is not in the Northwind table.",
      nextAction: "Stop. Leave the code unmapped.",
      carcClass: "unmapped",
    };
  }
  const result = appealReady({
    carc: denial.carc,
    clinicalNoteRef: denial.clinicalNoteRef,
    filingDeadline: denial.filingDeadline,
  });
  return {
    appealable: rule.carcClass === "denial",
    ready: result.ready,
    missing: result.missing.map((field) => MISSING[field] ?? field),
    meaning: rule.meaning,
    nextAction: rule.nextAction,
    carcClass: rule.carcClass,
  };
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function send(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(html);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The workbench and the factory listen on loopback with no login, but any page in the browser can still send them requests.
 * Refuse a Host that is not loopback, which stops DNS rebinding, and a POST whose Origin is another site.
 */
export function foreignRequest(req: IncomingMessage): boolean {
  const host = req.headers.host ?? "";
  if (!LOOPBACK.has(host.replace(/:\d+$/, ""))) return true;
  if (req.method !== "POST") return false;
  const origin = req.headers.origin;
  return origin !== undefined && origin !== `http://${host}`;
}

function page(title: string, body: string): string {
  const nav = [
    ["/", "Workqueue"],
    ["/summary", "Lead summary"],
    ["/eligibility", "Eligibility"],
  ]
    .map(([href, label]) => `<a href="${href}">${label}</a>`)
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)} · Northwind Imaging</title>
  <style>
    body { margin: 0; background: #f3ecdf; color: #1c1915; font: 15px/1.4 ui-sans-serif, system-ui, sans-serif; }
    header, main { padding: 20px 24px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-end; border-bottom: 1px solid #e3d5c3; }
    h1 { margin: 0; font: 32px/1.1 Palatino, Georgia, serif; font-weight: 500; }
    nav, .filters { display: flex; gap: 12px; margin-top: 12px; }
    a { color: #0e6b66; }
    table { width: 100%; border-collapse: collapse; background: #fffaf3; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e3d5c3; }
    .overdue, .urgent { color: #8d3d2c; font-weight: 650; }
    .soon { color: #8a5a12; }
    .comfortable { color: #2a6840; }
    .checklist { list-style: none; padding: 0; }
    .checklist li { padding: 8px 0; border-bottom: 1px solid #e3d5c3; }
    button { font: inherit; padding: 8px 14px; border-radius: 999px; border: 1px solid #0e6b66; background: #0e6b66; color: #f7fffe; }
    button:disabled { background: #efe7db; color: #5e564c; border-color: #e3d5c3; }
    .banner { padding: 10px 12px; background: #fffaf3; border: 1px solid #e3d5c3; border-radius: 10px; }
  </style>
</head>
<body>
  <header>
    <div>
      <p>Northwind Imaging · denial workbench</p>
      <h1>${esc(title)}</h1>
      <nav>${nav}</nav>
    </div>
    <p>Synthetic remit · Northwind Health</p>
  </header>
  <main>${body}</main>
</body>
</html>`;
}

interface Row {
  denial: Denial;
  name: string;
  days: number | null;
  risk: DeadlineRisk;
  text: string;
  carcClass: string;
}

function rows(seed: PracticeSeed): Row[] {
  return seed.denials
    .map((denial) => {
      const patient = seed.patients.find((item) => item.id === denial.patientId);
      const days = denial.filingDeadline ? daysRemaining(denial.filingDeadline) : null;
      const risk = days === null ? "overdue" : deadlineRisk(days);
      return {
        denial,
        name: patient?.displayName ?? denial.patientId,
        days,
        risk,
        text: days === null ? "No deadline" : `${days} days`,
        carcClass: denialView(denial).carcClass,
      };
    })
    .sort((a, b) => (a.days ?? -9999) - (b.days ?? -9999) || a.denial.id.localeCompare(b.denial.id));
}

function queue(seed: PracticeSeed, selected: string): string {
  const visible = selected ? rows(seed).filter((row) => row.carcClass === selected) : rows(seed);
  const filters = ["", ...CLASSES]
    .map((value) => {
      const label = value === "" ? "All" : value;
      const href = value === "" ? "/" : `/?class=${encodeURIComponent(value)}`;
      const current = value === selected ? ` aria-current="page"` : "";
      return `<a href="${href}"${current}>${esc(label)}</a>`;
    })
    .join("");
  const body = visible
    .map(
      (row) => `<tr>
        <td><a href="/denial/${esc(row.denial.id)}">${esc(row.denial.id)}</a></td>
        <td>${esc(row.name)}</td>
        <td>${esc(row.denial.patientId)}</td>
        <td>${esc(row.denial.carc)}</td>
        <td>${esc(row.carcClass)}</td>
        <td class="${esc(row.risk)}">${esc(row.text)}</td>
      </tr>`,
    )
    .join("");
  return page(
    "Workqueue",
    `<nav class="filters">${filters}</nav>
     <p>Sorted by days left until timely filing. ${visible.length} rows.</p>
     <table>
       <thead><tr><th>Denial</th><th>Patient</th><th>Id</th><th>CARC</th><th>Class</th><th>Deadline</th></tr></thead>
       <tbody>${body}</tbody>
     </table>`,
  );
}

function detail(seed: PracticeSeed, denial: Denial, readyIds: Set<string>, notice: string): string {
  const view = denialView(denial);
  const patient = seed.patients.find((item) => item.id === denial.patientId);
  const line = seed.lines.find((item) => item.id === denial.lineId);
  const marked = readyIds.has(denial.id);
  const checklist = ["Clinical note reference", "Filing deadline"]
    .map((label) => `<li>${esc(label)}: ${view.missing.includes(label) ? "Missing" : "Present"}</li>`)
    .join("");
  let action = "";
  if (!view.appealable) {
    action = `<p>${esc(view.nextAction)}</p>`;
  } else if (marked) {
    action = `<p class="banner">Marked appeal ready.</p>`;
  } else {
    action = `<form method="post" action="/denial/${esc(denial.id)}/ready">
      <button type="submit"${view.ready ? "" : " disabled"}>Mark appeal ready</button>
    </form>`;
  }
  const banner = notice ? `<p class="banner">${esc(notice)}</p>` : "";
  return page(
    denial.id,
    `${banner}
     <p>${esc(patient?.displayName ?? denial.patientId)} · ${esc(denial.patientId)} · ${esc(denial.claimId)}</p>
     <p>${esc(line?.procedure.code ?? "")} ${esc(line?.procedure.label ?? "")}</p>
     <p>${esc(denial.carc)} / ${esc(denial.rarc)}. ${esc(view.meaning)}</p>
     <p>Next action: ${esc(view.nextAction)}</p>
     <ul class="checklist">${checklist}</ul>
     ${action}`,
  );
}

function eligibility(seed: PracticeSeed): string {
  const coverage = coverageSnapshot(seed.patients);
  const rowsHtml = coverage
    .map((row) => {
      const patient = seed.patients.find((item) => item.id === row.patientId);
      const decision = schedulingDecision(row);
      const copay = row.copayCents === null ? "none" : `${row.copayCents} cents`;
      return `<tr>
        <td>${esc(patient?.displayName ?? row.patientId)}</td>
        <td>${esc(row.patientId)}</td>
        <td>${esc(row.status)}</td>
        <td>${esc(copay)}</td>
        <td>${esc(decision.banner ?? "Schedule allowed")}</td>
      </tr>`;
    })
    .join("");
  const blocked = coverage.filter((row) => !schedulingDecision(row).allowSchedule);
  const notice = blocked
    .map((row) => `<p class="banner">${esc(row.patientId)}: ${esc(schedulingDecision(row).banner ?? "")}</p>`)
    .join("");
  return page(
    "Eligibility",
    `${notice}
     <p>This snapshot cites pack/decisions/ADR-001-patient-and-coverage.md. Patient ids are the workbench ids. There is no second patient key, and this page is not a factory run.</p>
     <table>
       <thead><tr><th>Patient</th><th>Id</th><th>Status</th><th>Copay</th><th>Front desk</th></tr></thead>
       <tbody>${rowsHtml}</tbody>
     </table>`,
  );
}

function summary(seed: PracticeSeed): string {
  const counts = new Map<string, number>();
  for (const denial of seed.denials) {
    const key = denialView(denial).carcClass;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const body = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, count]) => `<tr><td>${esc(label)}</td><td>${count}</td></tr>`)
    .join("");
  return page(
    "Lead summary",
    `<p>${seed.denials.length} remittance lines on the synthetic remit.</p>
     <table><thead><tr><th>Class</th><th>Count</th></tr></thead><tbody>${body}</tbody></table>`,
  );
}

export function createWorkbenchServer(seed: PracticeSeed = buildSeed()): Server {
  const readyIds = new Set<string>();
  return createServer((req, res) => {
    if (foreignRequest(req)) {
      send(res, 403, page("Refused", "<p>The workbench only answers pages it served.</p>"));
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const denialMatch = url.pathname.match(/^\/denial\/(DEN-\d{2})(\/ready)?$/);
    if (denialMatch) {
      const denial = seed.denials.find((item) => item.id === denialMatch[1]);
      if (!denial) {
        send(res, 404, page("Not on this remit", "<p>That denial is not in the synthetic seed.</p>"));
        return;
      }
      if (req.method === "POST" && denialMatch[2]) {
        const view = denialView(denial);
        if (!view.appealable || !view.ready) {
          const why = view.missing.length > 0 ? `Missing ${view.missing.join(" and ")}.` : view.nextAction;
          send(res, 200, detail(seed, denial, readyIds, why));
          return;
        }
        readyIds.add(denial.id);
        send(res, 200, detail(seed, denial, readyIds, ""));
        return;
      }
      if (req.method === "GET" && !denialMatch[2]) {
        send(res, 200, detail(seed, denial, readyIds, ""));
        return;
      }
    }
    if (req.method === "POST" && url.pathname === "/reset") {
      readyIds.clear();
      sendJson(res, 200, { cleared: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/eligibility") {
      send(res, 200, eligibility(seed));
      return;
    }
    if (req.method === "GET" && url.pathname === "/summary") {
      send(res, 200, summary(seed));
      return;
    }
    if (req.method === "GET" && url.pathname === "/") {
      const selected = url.searchParams.get("class") ?? "";
      const known = selected === "" || (CLASSES as readonly string[]).includes(selected);
      send(res, 200, queue(seed, known ? selected : ""));
      return;
    }
    send(res, 404, page("Not found", "<p>That page is not in the workbench.</p>"));
  });
}

export function listenWorkbench(port = 4173): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createWorkbenchServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      resolve({
        port: actual,
        close: () => new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      });
    });
  });
}
