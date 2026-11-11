import { repoRoot } from "@northwind/orchestrator";
import { foreignRequest } from "@northwind/rcm";
import { readFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { createDecider } from "./jev.ts";
import { gatedFor } from "./record.ts";
import { createLiveService, liveRunners } from "./live.ts";
import { catalog, expand, loadSpecs } from "./workflows.ts";

/** A summary of a real, metered run of the requirements panel, so viewers can see the replays are not invented. */
const EVIDENCE = "packages/studio/evidence/live-prd-2026-11-09.json";
/** That run's full transcript: drafts, reviews, merge and gate verdicts. */
const TRANSCRIPT = "packages/studio/evidence/live-prd-2026-11-09-transcript.json";

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
  /** Answers Model C's decisions, live when a key is set. Defaults to one reading JEV_API_KEY. */
  decider?: ReturnType<typeof createDecider>;
  /** Live runs on a visitor's brief. Defaults to one switched on by LIVE_PASSCODE, with the real models. */
  live?: ReturnType<typeof createLiveService>;
}

/** Serves the studio page and its simulated workflows. Nothing here calls a model. */
export function createStudioServer(options: StudioOptions = {}): Server {
  const decider = options.decider ?? createDecider();
  const live =
    options.live ??
    createLiveService({
      passcode: process.env.LIVE_PASSCODE && process.env.ANTHROPIC_API_KEY && process.env.XAI_API_KEY ? process.env.LIVE_PASSCODE : "",
      dailyCapUsd: Number(process.env.LIVE_DAILY_CAP_USD ?? 2),
      runners: liveRunners(),
    });
  return createServer((req, res) => {
    const liveRun = req.method === "POST" && (req.url ?? "").split("?")[0] === "/api/live/run";
    if (options.hosted ? req.method !== "GET" && req.method !== "HEAD" && !liveRun : foreignRequest(req)) {
      send(res, options.hosted ? 405 : 403, { error: options.hosted ? "read-only" : "foreign-origin" });
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/") {
        send(res, 200, readFileSync(join(repoRoot(), "packages/studio/public/index.html"), "utf8"), "text/html; charset=utf-8");
        return;
      }
      if (req.method === "GET" && (url.pathname === "/checks.js" || url.pathname === "/tests.js")) {
        send(res, 200, readFileSync(join(repoRoot(), "packages/studio/public", url.pathname.slice(1)), "utf8"), "text/javascript; charset=utf-8");
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/evidence/transcript") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="kodiflex-live-run-2026-11-09-transcript.json"', "x-content-type-options": "nosniff" });
        res.end(readFileSync(join(repoRoot(), TRANSCRIPT), "utf8"));
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
      if (liveRun) {
        // The one write the studio accepts: same-origin JSON, small, and passcode-checked by the live service.
        const origin = req.headers.origin;
        if (origin && origin !== `https://${req.headers.host}` && origin !== `http://${req.headers.host}`) {
          send(res, 403, { error: "foreign-origin" });
          return;
        }
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
          send(res, 415, { error: "Send JSON." });
          return;
        }
        let body = "";
        let tooBig = false;
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
          if (body.length > 10_000) tooBig = true;
        });
        req.on("end", () => {
          if (tooBig) return send(res, 413, { error: "Too long." });
          let input: unknown;
          try {
            input = JSON.parse(body);
          } catch {
            return send(res, 400, { error: "Send JSON." });
          }
          const result = live.submit((input ?? {}) as Parameters<typeof live.submit>[0]);
          if ("error" in result) send(res, result.status, { error: result.error });
          else send(res, 202, result);
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/live") {
        send(res, 200, live.status());
        return;
      }
      const liveJob = url.pathname.match(/^\/api\/live\/jobs\/([a-f0-9-]+)$/);
      if (req.method === "GET" && liveJob) {
        const job = live.job(liveJob[1] ?? "");
        send(res, job ? 200 : 404, job ?? { error: "unknown-job" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/status") {
        const recorded = loadSpecs().flatMap((spec) => (spec.recording ? [spec.recording] : []));
        send(res, 200, {
          decisionsLive: decider.live,
          recordings: {
            count: recorded.length,
            calls: recorded.reduce((total, recording) => total + recording.calls.length, 0),
            costUsd: recorded.reduce((total, recording) => total + recording.calls.reduce((sum, call) => sum + call.costUsd, 0), 0),
          },
        });
        return;
      }
      const gated = url.pathname.match(/^\/api\/gated\/([a-z0-9-]+)$/);
      if (req.method === "GET" && gated) {
        const result = gatedFor(gated[1] ?? "");
        send(res, result ? 200 : 404, result ?? { error: "not-compared" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/gated") {
        send(res, 200, loadSpecs().flatMap((spec) => {
          const result = gatedFor(spec.id);
          return result ? [result] : [];
        }));
        return;
      }
      const decide = url.pathname.match(/^\/api\/decide\/([a-z0-9-]+)\/([a-zA-Z]+)$/);
      if (req.method === "GET" && decide) {
        const spec = loadSpecs().find((item) => item.id === decide[1]);
        if (!spec) {
          send(res, 404, { error: "unknown-workflow" });
          return;
        }
        decider
          .decide(spec, decide[2] ?? "")
          .then((result) => (result ? send(res, 200, result) : send(res, 404, { error: "not-a-decision" })))
          .catch(() => send(res, 500, { error: "error" }));
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
