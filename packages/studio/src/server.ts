import { repoRoot } from "@northwind/orchestrator";
import { foreignRequest } from "@northwind/rcm";
import { readFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { catalog, expand, loadSpecs } from "./workflows.ts";

function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8"): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

/** Serves the studio page and its simulated workflows. Nothing here calls a model. */
export function createStudioServer(): Server {
  return createServer((req, res) => {
    if (foreignRequest(req)) {
      send(res, 403, { error: "foreign-origin" });
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/") {
        send(res, 200, readFileSync(join(repoRoot(), "packages/studio/public/index.html"), "utf8"), "text/html; charset=utf-8");
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/catalog") {
        send(res, 200, catalog());
        return;
      }
      const match = url.pathname.match(/^\/api\/workflows\/([a-z0-9-]+)$/);
      if (req.method === "GET" && match) {
        const spec = loadSpecs().find((item) => item.id === match[1]);
        if (!spec) {
          send(res, 404, { error: "unknown-workflow" });
          return;
        }
        send(res, 200, expand(spec));
        return;
      }
      send(res, 404, { error: "not-found" });
    } catch (error) {
      send(res, 500, { error: error instanceof Error ? error.message : "error" });
    }
  });
}

export function listenStudio(port = 4320): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createStudioServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      resolve({ port: actual, close: () => new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))) });
    });
  });
}
