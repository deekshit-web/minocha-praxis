import { repoRoot } from "@northwind/orchestrator";
import { foreignRequest } from "@northwind/rcm";
import { readFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { catalog, expand, loadSpecs } from "./workflows.ts";

/** A summary of a real, metered run of the requirements panel, so viewers can see the replays are not invented. */
const EVIDENCE = "packages/studio/evidence/live-prd-2026-11-09.json";

function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8"): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

export interface StudioOptions {
  /**
   * Hosted on the open internet rather than on this machine. The loopback Host check is dropped, since a
   * public host name is expected, and anything but GET is refused. The studio has no writes, so nothing else changes.
   */
  hosted?: boolean;
}

/** Serves the studio page and its simulated workflows. Nothing here calls a model. */
export function createStudioServer(options: StudioOptions = {}): Server {
  return createServer((req, res) => {
    if (options.hosted ? req.method !== "GET" && req.method !== "HEAD" : foreignRequest(req)) {
      send(res, options.hosted ? 405 : 403, { error: options.hosted ? "read-only" : "foreign-origin" });
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/") {
        send(res, 200, readFileSync(join(repoRoot(), "packages/studio/public/index.html"), "utf8"), "text/html; charset=utf-8");
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/evidence") {
        const body = readFileSync(join(repoRoot(), EVIDENCE), "utf8");
        if (url.searchParams.has("download")) {
          res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="kodiflex-live-run-2026-11-09.json"', "x-content-type-options": "nosniff" });
          res.end(body);
          return;
        }
        send(res, 200, body);
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
      send(res, 500, { error: !options.hosted && error instanceof Error ? error.message : "error" });
    }
  });
}

export function listenStudio(port = 4320, options: StudioOptions = {}): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createStudioServer(options);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, options.hosted ? "0.0.0.0" : "127.0.0.1", () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      resolve({ port: actual, close: () => new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))) });
    });
  });
}
