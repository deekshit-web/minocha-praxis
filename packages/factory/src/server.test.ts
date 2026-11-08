import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSeed } from "../../domain/src/seed.ts";
import { createWorkbenchServer } from "../../rcm/src/workbench.ts";
import { createFactoryServer } from "./server.ts";

async function withServer(run: (port: number) => Promise<void>): Promise<void> {
  const server: Server = createFactoryServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await run(port);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("the factory page and one act are served over HTTP", async () => {
  await withServer(async (port) => {
    const origin = `http://127.0.0.1:${port}`;
    const page = await fetch(`${origin}/`);
    const html = await page.text();
    assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(html, /Recorded run/);
    assert.match(html, /does not start the denial workbench/);
    assert.match(html, /Both analysts returned the same document/);
    assert.match(html, /Record the result/);
    assert.match(html, /id="reset"/);
    assert.match(html, /Confirm reset/);
    assert.equal(html.includes("innerHTML"), false);

    const created = await fetch(`${origin}/api/session`, { method: "POST" });
    assert.equal(created.status, 201);
    const view = (await created.json()) as { id: string; state: string; mode: string };
    assert.equal(view.state, "intake");
    assert.equal(view.mode, "recorded");

    const probed = await fetch(`${origin}/api/session/${view.id}/act`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "probe", brief: "Patient SSN 123-45-6789" }),
    });
    const afterProbe = (await probed.json()) as { state: string; banner: string };
    assert.equal(afterProbe.state, "intake");
    assert.match(afterProbe.banner, /ssn/);

    const begun = await fetch(`${origin}/api/session/${view.id}/act`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "begin" }),
    });
    const next = (await begun.json()) as { state: string; questions: unknown[] };
    assert.equal(next.state, "clarifying");
    assert.equal(next.questions.length, 5);

    const bad = await fetch(`${origin}/api/session/${view.id}/act`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(bad.status, 400);

    const missing = await fetch(`${origin}/api/session/missing`);
    assert.equal(missing.status, 404);

    const screen = await fetch(`${origin}/proposed/SCR-2`);
    const proposed = await screen.text();
    assert.equal(screen.status, 200);
    assert.match(proposed, /Proposed/);
    assert.match(proposed, /Clinical note reference: Missing/);
    assert.match(proposed, /<button type="button" disabled>Mark appeal ready<\/button>/);
  });
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return typeof address === "object" && address ? address.port : 0;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test("reset clears the factory session, its sandbox, and the workbench ready mark", async () => {
  const product = join(process.env.NORTHWIND_ROOT ?? "", "packages/domain/src/appealReady.ts");
  const before = readFileSync(product, "utf8");
  const sandboxRoot = await mkdtemp(join(tmpdir(), "northwind-reset-"));
  await writeFile(join(sandboxRoot, "sandbox.txt"), "stale");
  const workbench = createWorkbenchServer();
  const workbenchPort = await listen(workbench);
  const workbenchOrigin = `http://127.0.0.1:${workbenchPort}`;
  const factory = createFactoryServer({ workbench: workbenchOrigin, sandboxRoot });
  const port = await listen(factory);
  try {
    const origin = `http://127.0.0.1:${port}`;
    const created = (await (await fetch(`${origin}/api/session`, { method: "POST" })).json()) as { id: string };
    const open = buildSeed().denials.find((item) => item.carc === "CO-16");
    assert.ok(open);
    const marked = await (await fetch(`${workbenchOrigin}/denial/${open.id}/ready`, { method: "POST" })).text();
    assert.match(marked, /Marked appeal ready/);

    const reset = await fetch(`${origin}/api/reset`, { method: "POST" });
    const next = (await reset.json()) as { id: string; state: string; banner: string | null };
    assert.equal(reset.status, 200);
    assert.equal(next.state, "intake");
    assert.notEqual(next.id, created.id);
    assert.match(next.banner ?? "", /Workbench ready marks cleared/);
    assert.match(next.banner ?? "", /domain file was not changed/);

    const gone = await fetch(`${origin}/api/session/${created.id}`);
    assert.equal(gone.status, 404);
    assert.equal(existsSync(sandboxRoot), false);
    const again = await (await fetch(`${workbenchOrigin}/denial/${open.id}`)).text();
    assert.equal(again.includes("Marked appeal ready"), false);
    assert.equal(readFileSync(product, "utf8"), before);
  } finally {
    await close(factory);
    await close(workbench);
  }
});

test("reset still clears the factory when the workbench does not answer", async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "northwind-reset-down-"));
  const factory = createFactoryServer({ workbench: "http://127.0.0.1:9", sandboxRoot });
  const port = await listen(factory);
  try {
    const origin = `http://127.0.0.1:${port}`;
    const created = (await (await fetch(`${origin}/api/session`, { method: "POST" })).json()) as { id: string };
    const reset = await fetch(`${origin}/api/reset`, { method: "POST" });
    const next = (await reset.json()) as { state: string; banner: string | null };
    assert.equal(next.state, "intake");
    assert.match(next.banner ?? "", /Factory run cleared/);
    assert.match(next.banner ?? "", /did not answer/);
    assert.match(next.banner ?? "", /domain file was not changed/);
    const gone = await fetch(`${origin}/api/session/${created.id}`);
    assert.equal(gone.status, 404);
  } finally {
    await close(factory);
  }
});

test("a cross-site page cannot reset the factory", async () => {
  await withServer(async (port) => {
    const origin = `http://127.0.0.1:${port}`;
    const session = await (await fetch(`${origin}/api/session`, { method: "POST" })).json();
    const refused = await fetch(`${origin}/api/reset`, { method: "POST", headers: { origin: "https://evil.example" } });
    assert.equal(refused.status, 403);
    assert.equal((await fetch(`${origin}/api/session/${session.id}`)).status, 200);
  });
});
