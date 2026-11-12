import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import test from "node:test";
import { findPhi } from "@northwind/orchestrator";
import { buildSeed, carcRule } from "@northwind/domain";
import { createWorkbenchServer, denialView } from "./workbench.ts";

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const server: Server = createWorkbenchServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("The workqueue sorts by deadline. The class filter removes PR-1 from the denial list.", async () => {
  await withServer(async (origin) => {
    const all = await (await fetch(`${origin}/`)).text();
    assert.equal(findPhi(all).length, 0);
    assert.equal(all.includes("Proposed"), false);
    const first = all.slice(all.indexOf("<tbody>")).match(/DEN-\d{2}/);
    const seed = buildSeed();
    const soonest = [...seed.denials].sort((a, b) => {
      const left = a.filingDeadline ? a.filingDeadline : "0000";
      const right = b.filingDeadline ? b.filingDeadline : "0000";
      return left.localeCompare(right) || a.id.localeCompare(b.id);
    })[0];
    assert.equal(first?.[0], soonest?.id);
    const filtered = await (await fetch(`${origin}/?class=patient-responsibility`)).text();
    assert.match(filtered, /PR-1/);
    assert.equal(filtered.includes("CO-50"), false);
    assert.match(filtered, /2 rows/);
  });
});

test("A CO-50 denial without a note stays blocked. PR-1 is not an appeal. A complete denial can be marked ready.", async () => {
  const seed = buildSeed();
  const blocked = seed.denials.find((item) => item.carc === "CO-50" && item.clinicalNoteRef === null && item.filingDeadline);
  const responsibility = seed.denials.find((item) => item.carc === "PR-1");
  const open = seed.denials.find((item) => item.carc === "CO-16");
  assert.ok(blocked && responsibility && open);
  assert.equal(denialView(blocked).ready, false);
  assert.equal(denialView(blocked).missing.includes("Clinical note reference"), true);
  assert.equal(denialView(responsibility).appealable, false);
  assert.equal(denialView(open).ready, true);
  assert.equal(denialView(blocked).meaning, carcRule("CO-50")?.meaning);

  await withServer(async (origin) => {
    const detail = await (await fetch(`${origin}/denial/${blocked.id}`)).text();
    assert.match(detail, /Clinical note reference: Missing/);
    assert.match(detail, /disabled/);
    assert.match(detail, /MRI|CT|Chest|X-ray/);
    const refused = await fetch(`${origin}/denial/${blocked.id}/ready`, { method: "POST" });
    assert.match(await refused.text(), /Clinical note reference/);
    const pr = await (await fetch(`${origin}/denial/${responsibility.id}`)).text();
    assert.match(pr, /Do not open an appeal/);
    assert.equal(pr.includes("Mark appeal ready"), false);
    const marked = await fetch(`${origin}/denial/${open.id}/ready`, { method: "POST" });
    assert.match(await marked.text(), /Marked appeal ready/);
    const summary = await (await fetch(`${origin}/summary`)).text();
    assert.match(summary, /denial/);
    assert.match(summary, /patient-responsibility/);
  });
});

test("The eligibility check cites the coverage decision. It blocks only the last patient.", async () => {
  const seed = buildSeed();
  await withServer(async (origin) => {
    const html = await (await fetch(`${origin}/eligibility`)).text();
    assert.equal(findPhi(html).length, 0);
    assert.equal(html.includes("Proposed"), false);
    assert.match(html, /pack\/decisions\/ADR-001-patient-and-coverage\.md/);
    assert.match(html, /no second patient key/);
    const ids = [...html.matchAll(/\bPAT-\d{3}\b/g)].map((match) => match[0]);
    const known = new Set(seed.patients.map((patient) => patient.id));
    assert.equal(new Set(ids).size, known.size);
    for (const id of ids) assert.equal(known.has(id), true);
    const first = html.slice(html.indexOf("PAT-001"), html.indexOf("PAT-002"));
    assert.match(first, /active/);
    assert.match(first, /2500 cents/);
    assert.equal(first.includes("Do not schedule"), false);
    const lastId = seed.patients.at(-1)?.id ?? "";
    const last = html.slice(html.indexOf(lastId));
    assert.match(last, /Coverage is inactive\. Do not schedule/);
    assert.match(html, /Lane Croft/);
  });
});

test("Reset removes the ready mark from memory. The seed denial is blocked again.", async () => {
  const open = buildSeed().denials.find((item) => item.carc === "CO-16");
  assert.ok(open);
  await withServer(async (origin) => {
    const marked = await fetch(`${origin}/denial/${open.id}/ready`, { method: "POST" });
    assert.match(await marked.text(), /Marked appeal ready/);
    const reset = await fetch(`${origin}/reset`, { method: "POST" });
    assert.equal(reset.status, 200);
    assert.deepEqual(await reset.json(), { cleared: true });
    const again = await (await fetch(`${origin}/denial/${open.id}`)).text();
    assert.equal(again.includes("Marked appeal ready"), false);
    assert.match(again, /type="submit">Mark appeal ready<\/button>/);
  });
});

function rawStatus(origin: string, method: string, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const sent = request(`${origin}${path}`, { method, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    sent.on("error", reject);
    sent.end();
  });
}

test("The workbench rejects a POST from another site. It rejects a Host that is not loopback.", async () => {
  const open = buildSeed().denials.find((item) => item.carc === "CO-16");
  assert.ok(open);
  await withServer(async (origin) => {
    const host = new URL(origin).host;
    assert.equal(await rawStatus(origin, "POST", "/reset", { origin: "https://evil.example" }), 403);
    assert.equal(await rawStatus(origin, "POST", `/denial/${open.id}/ready`, { origin: "https://evil.example" }), 403);
    assert.equal(await rawStatus(origin, "GET", "/", { host: "rebound.example:80" }), 403);
    assert.equal(await rawStatus(origin, "POST", "/reset", { origin: `http://${host}` }), 200);
    assert.equal(await rawStatus(origin, "POST", "/reset", {}), 200);
    const page = await (await fetch(`${origin}/denial/${open.id}`)).text();
    assert.equal(page.includes("Marked appeal ready"), false);
  });
});
