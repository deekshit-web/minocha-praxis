import type { Server } from "node:http";
import { buildSeed } from "@northwind/domain";
import { createWorkbenchServer } from "./workbench.ts";

export interface PriorityResult {
  id: string;
  passed: boolean;
  detail: string;
}

const ENABLED = `type="submit">Mark appeal ready</button>`;
const DISABLED = `type="submit" disabled`;

async function page(url: string, method = "GET"): Promise<string> {
  const response = await fetch(url, { method });
  return response.text();
}

async function withWorkbench(run: (origin: string) => Promise<PriorityResult[]>): Promise<PriorityResult[]> {
  const server: Server = createWorkbenchServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function check(id: string, origin: string): Promise<PriorityResult> {
  const seed = buildSeed();
  const denial = (carc: string, note: "missing" | "present" | "any", deadline: "missing" | "present" | "any") =>
    seed.denials.find((item) => {
      if (item.carc !== carc) return false;
      if (note === "missing" && item.clinicalNoteRef) return false;
      if (note === "present" && !item.clinicalNoteRef) return false;
      if (deadline === "missing" && item.filingDeadline) return false;
      if (deadline === "present" && !item.filingDeadline) return false;
      return true;
    });

  if (id === "TC-1") {
    const row = denial("CO-50", "missing", "present");
    if (!row) return { id, passed: false, detail: "The seed has no CO-50 with a deadline and no clinical note." };
    const got = await page(`${origin}/denial/${row.id}`);
    const posted = await page(`${origin}/denial/${row.id}/ready`, "POST");
    const passed = got.includes("Clinical note reference: Missing") && got.includes(DISABLED) && posted.includes("Clinical note reference") && !posted.includes("Marked appeal ready");
    return { id, passed, detail: passed ? `${row.id} names the missing clinical note and stays blocked.` : `${row.id} did not stay blocked.` };
  }
  if (id === "TC-2") {
    const row = denial("CO-50", "any", "missing");
    if (!row) return { id, passed: false, detail: "The seed has no CO-50 without a filing deadline." };
    const got = await page(`${origin}/denial/${row.id}`);
    const posted = await page(`${origin}/denial/${row.id}/ready`, "POST");
    const passed = got.includes("Filing deadline: Missing") && got.includes(DISABLED) && posted.includes("Filing deadline") && !posted.includes("Marked appeal ready");
    return { id, passed, detail: passed ? `${row.id} names the missing filing deadline and stays blocked.` : `${row.id} did not name the filing deadline.` };
  }
  if (id === "TC-3") {
    const row = seed.denials.find((item) => item.carc === "CO-50" && item.clinicalNoteRef === "DOC-003" && item.filingDeadline);
    if (!row) return { id, passed: false, detail: "The seed has no CO-50 with DOC-003 and a filing deadline." };
    const got = await page(`${origin}/denial/${row.id}`);
    const posted = await page(`${origin}/denial/${row.id}/ready`, "POST");
    const passed = got.includes(ENABLED) && posted.includes("Marked appeal ready");
    return { id, passed, detail: passed ? `${row.id} with DOC-003 was marked appeal ready.` : `${row.id} did not become appeal ready.` };
  }
  if (id === "TC-4") {
    const row = denial("CO-16", "any", "any");
    if (!row) return { id, passed: false, detail: "The seed has no CO-16 denial." };
    const queue = await page(`${origin}/?class=denial`);
    const got = await page(`${origin}/denial/${row.id}`);
    const posted = await page(`${origin}/denial/${row.id}/ready`, "POST");
    const passed = queue.includes(row.id) && queue.includes("CO-16") && !queue.includes("PR-1") && got.includes(ENABLED) && posted.includes("Marked appeal ready");
    return { id, passed, detail: passed ? `${row.id} is on the denial list and marks ready without the CO-50 note rule.` : `${row.id} did not mark ready.` };
  }
  if (id === "TC-5") {
    const row = denial("PR-1", "any", "any");
    if (!row) return { id, passed: false, detail: "The seed has no PR-1 line." };
    const got = await page(`${origin}/denial/${row.id}`);
    const passed = got.includes("Do not open an appeal") && !got.includes("Mark appeal ready");
    return { id, passed, detail: passed ? `${row.id} offers no appeal action.` : `${row.id} still offers an appeal.` };
  }
  return { id, passed: false, detail: `${id} has no workbench check.` };
}

/** Request each priority case from a fresh workbench. The demo server on 4173 is left alone. */
export async function runPriorityChecks(caseIds: string[]): Promise<PriorityResult[]> {
  if (caseIds.length === 0) return [];
  return withWorkbench(async (origin) => {
    const results: PriorityResult[] = [];
    for (const id of caseIds) results.push(await check(id, origin));
    return results;
  });
}
