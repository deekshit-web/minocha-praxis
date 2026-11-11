import assert from "node:assert/strict";
import test from "node:test";
import { createDecider } from "./jev.ts";
import { createStudioServer } from "./server.ts";

test("the studio serves its catalog and each simulated workflow, and refuses other sites", async () => {
  const server = createStudioServer({ decider: createDecider({ apiKey: "" }) });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  try {
    const catalog = (await (await fetch(`${origin}/api/catalog`)).json()) as Array<{ id: string; workflows: Array<{ id: string }> }>;
    assert.equal(catalog.length, 5);
    const first = catalog[0]?.workflows[0]?.id ?? "";
    const workflow = (await (await fetch(`${origin}/api/workflows/${first}`)).json()) as { steps: unknown[] };
    assert.ok(workflow.steps.length > 8);
    assert.equal((await fetch(`${origin}/api/workflows/nope`)).status, 404);
    const status = (await (await fetch(`${origin}/api/status`)).json()) as { decisionsLive: boolean; recordings: { count: number } };
    assert.equal(status.decisionsLive, false);
    assert.equal(typeof status.recordings.count, "number");
    const decision = (await (await fetch(`${origin}/api/decide/fmcg-build/goNoGo`)).json()) as { text: string };
    assert.match(decision.text, /Recommendation: go/);
    assert.equal((await fetch(`${origin}/api/decide/fmcg-build/code`)).status, 404);
    const checks = await fetch(`${origin}/checks.js`);
    assert.match(checks.headers.get("content-type") ?? "", /javascript/);
    assert.match(await checks.text(), /export const LIVE_CHECKS/);
    assert.match(await (await fetch(`${origin}/tests.js`)).text(), /export function runTests/);
    const evidence = (await (await fetch(`${origin}/api/evidence`)).json()) as { totals: { calls: number }; highlight: { severity: string } };
    assert.equal(evidence.totals.calls, 5);
    assert.equal(evidence.highlight.severity, "P0");
    assert.match((await fetch(`${origin}/api/evidence?download=1`)).headers.get("content-disposition") ?? "", /attachment/);
    const page = await (await fetch(`${origin}/`)).text();
    assert.match(page, /no model is called/i);
    assert.equal((await fetch(`${origin}/api/catalog`, { method: "POST", headers: { origin: "https://evil.example" } })).status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("hosted, the studio answers any host name but stays read-only", async () => {
  const server = createStudioServer({ hosted: true, decider: createDecider({ apiKey: "" }) });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  try {
    const page = await fetch(`${origin}/`, { headers: { host: "studio.up.railway.app" } });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await fetch(`${origin}/api/catalog`, { headers: { host: "studio.up.railway.app" } })).status, 200);
    assert.equal((await fetch(`${origin}/api/catalog`, { method: "POST" })).status, 405);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("the container image ships every folder the server reads at runtime", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { repoRoot } = await import("@northwind/orchestrator");
  const dockerfile = readFileSync(join(repoRoot(), "Dockerfile"), "utf8");
  for (const folder of ["public", "workflows", "evidence", "recordings"]) {
    assert.match(dockerfile, new RegExp(`COPY --from=build /app/packages/studio/${folder} `), `Dockerfile does not copy packages/studio/${folder}`);
  }
});
