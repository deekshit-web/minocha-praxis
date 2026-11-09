import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { loadLiveShowcase, readLiveRuns, type LiveShowcase } from "@northwind/harness";
import { repoRoot } from "@northwind/orchestrator";
import { foreignRequest, renderProposedScreen, type ProposedScreenId } from "@northwind/rcm";
import { DEFAULT_WORKBENCH, FactorySession, type FactoryAct } from "./session.ts";
import type { FactoryView } from "./view.ts";

export interface FactoryServerOptions {
  workbench?: string;
  sandboxRoot?: string;
}

function pagePath(): string {
  return join(repoRoot(), "packages/factory/public/index.html");
}

/** Reset deletes this directory. It has to stay under runs/ or the temp dir. */
function sandboxDir(root: string): string {
  const resolved = resolve(root);
  const allowed = [resolve(repoRoot(), "runs"), resolve(tmpdir())];
  const inside = allowed.some((prefix) => resolved === prefix || resolved.startsWith(prefix + sep));
  if (!inside) throw new Error("sandbox-root");
  return resolved;
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8"): void {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseAct(raw: string): FactoryAct {
  const value: unknown = raw ? JSON.parse(raw) : {};
  if (!value || typeof value !== "object" || !("type" in value)) throw new SyntaxError("Action needs a type.");
  const action = value as { type?: unknown; choices?: unknown; comment?: unknown; brief?: unknown };
  switch (action.type) {
    case "begin":
    case "approve":
    case "accept-suggestion":
    case "reject-suggestion":
    case "repair":
    case "record":
      return { type: action.type };
    case "answers":
      return { type: "answers", choices: recordOfStrings(action.choices) };
    case "changes":
      return { type: "changes", comment: typeof action.comment === "string" ? action.comment : undefined };
    case "probe":
      if (typeof action.brief !== "string") throw new SyntaxError("probe needs a brief.");
      return { type: "probe", brief: action.brief };
    default:
      throw new SyntaxError("Unknown action.");
  }
}

function recordOfStrings(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyntaxError("choices must be an object.");
  const choices: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") throw new SyntaxError("choice values must be strings.");
    choices[key] = item;
  }
  return choices;
}

/** The latest live run that passed, read fresh for each new session so a new run shows up without a restart. */
function showcase(): LiveShowcase | null {
  try {
    return loadLiveShowcase();
  } catch {
    return null;
  }
}

async function resetFactory(sessions: Map<string, FactorySession>, sandboxRoot: string, workbench: string): Promise<FactoryView> {
  sessions.clear();
  await rm(sandboxDir(sandboxRoot), { recursive: true, force: true });
  let workbenchCleared = false;
  try {
    const response = await fetch(`${workbench.replace(/\/$/, "")}/reset`, { method: "POST", signal: AbortSignal.timeout(1500) });
    workbenchCleared = response.ok;
  } catch {
    workbenchCleared = false;
  }
  const session = new FactorySession(undefined, workbench, showcase());
  sessions.set(session.id, session);
  session.banner = workbenchCleared
    ? "Factory run cleared. Workbench ready marks cleared. The domain file was not changed."
    : "Factory run cleared. The workbench did not answer. The domain file was not changed.";
  session.log.push(session.banner);
  return session.view();
}

export function createFactoryServer(options: FactoryServerOptions = {}): Server {
  const sessions = new Map<string, FactorySession>();
  const workbench = options.workbench ?? DEFAULT_WORKBENCH;
  const sandboxRoot = options.sandboxRoot ?? join(repoRoot(), "runs/implementer");
  return createServer((req, res) => {
    void handle(req, res, sessions, workbench, sandboxRoot);
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: Map<string, FactorySession>,
  workbench: string,
  sandboxRoot: string,
): Promise<void> {
  if (foreignRequest(req)) {
    send(res, 403, { error: "foreign-origin" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/") {
      send(res, 200, readFileSync(pagePath(), "utf8"), "text/html; charset=utf-8");
      return;
    }
    const proposed = url.pathname.match(/^\/proposed\/(SCR-[123])$/);
    if (req.method === "GET" && proposed) {
      send(res, 200, renderProposedScreen(proposed[1] as ProposedScreenId), "text/html; charset=utf-8");
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/live-runs") {
      send(res, 200, readLiveRuns());
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/session") {
      const session = new FactorySession(undefined, workbench, showcase());
      sessions.set(session.id, session);
      send(res, 201, session.view());
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/reset") {
      await readBody(req);
      send(res, 200, await resetFactory(sessions, sandboxRoot, workbench));
      return;
    }
    const match = url.pathname.match(/^\/api\/session\/([^/]+)$/);
    const actMatch = url.pathname.match(/^\/api\/session\/([^/]+)\/act$/);
    const id = decodeURIComponent((actMatch ?? match)?.[1] ?? "");
    if (!id) {
      send(res, 404, { error: "not-found" });
      return;
    }
    const session = sessions.get(id);
    if (!session) {
      send(res, 404, { error: "unknown-session" });
      return;
    }
    if (req.method === "GET" && match) {
      send(res, 200, session.view());
      return;
    }
    if (req.method === "POST" && actMatch) {
      send(res, 200, await session.act(parseAct(await readBody(req))));
      return;
    }
    send(res, 405, { error: "method" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "bad-request";
    send(res, error instanceof SyntaxError ? 400 : 500, { error: message });
  }
}

export function listen(port = 4317, options: FactoryServerOptions = {}): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createFactoryServer(options);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      resolve({
        port: actual,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
