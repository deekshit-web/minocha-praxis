import assert from "node:assert/strict";
import test from "node:test";
import { createStudioServer } from "./server.ts";

test("the studio serves its catalog and each simulated workflow, and refuses other sites", async () => {
  const server = createStudioServer();
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
    const page = await (await fetch(`${origin}/`)).text();
    assert.match(page, /no model is called/i);
    assert.equal((await fetch(`${origin}/api/catalog`, { method: "POST", headers: { origin: "https://evil.example" } })).status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("hosted, the studio answers any host name but stays read-only", async () => {
  const server = createStudioServer({ hosted: true });
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
