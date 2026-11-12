// `npm run live-dry-run`: runs the live end-to-end build on the briefs in evals/live-build/briefs.json, on real models.
//
// It starts five staging servers (ports 4331 to 4335, each with the full build switched on and its own passcode), gives
// each two briefs one after the other, and writes a record of every build plus a summary to runs/live-dry-run/<date>/.
// A build is one at a time per server, so five servers is what makes ten builds take about 35 minutes and not three hours.
//
// This spends real money: about $0.25 to $0.45 a build, $3.50 for the ten. Each build is limited to $0.75, and the script
// stops starting builds once the total reaches $6.50. It needs ANTHROPIC_API_KEY and XAI_API_KEY in the environment.
// Pass a different brief file as the first argument. Model-written code runs in the isolated sandbox (studio/src/isolate.ts).
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const briefs = JSON.parse(readFileSync(process.argv[2] ?? join(root, "evals/live-build/briefs.json"), "utf8"));
const outDir = join(root, "runs/live-dry-run", new Date().toISOString().slice(0, 10));
mkdirSync(outDir, { recursive: true });
const passcode = randomBytes(18).toString("base64url");
const HARD_STOP_USD = 6.5;
const ports = [4331, 4332, 4333, 4334, 4335];
const log = (line) => {
  console.log(line);
  appendFileSync(join(outDir, "progress.log"), `${new Date().toISOString().slice(11, 19)} ${line}\n`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!process.env.ANTHROPIC_API_KEY || !process.env.XAI_API_KEY) throw new Error("Set ANTHROPIC_API_KEY and XAI_API_KEY first.");
const built = spawnSync(process.execPath, [join(root, "scripts/studio.mjs"), "--build-only"], { cwd: root, stdio: "inherit" });
if (built.status !== 0) throw new Error("the studio did not build");

const servers = ports.map((port) =>
  spawn(process.execPath, ["runs/studio/server.mjs"], {
    cwd: root,
    stdio: "ignore",
    env: { ...process.env, PORT: String(port), NORTHWIND_ROOT: root, LIVE_PASSCODE: passcode, LIVE_BUILD: "1", LIVE_DAILY_CAP_USD: "2", LIVE_BUILD_CAP_USD: "0.75" },
  }),
);
await sleep(6000);
for (const port of ports) {
  const status = await (await fetch(`http://127.0.0.1:${port}/api/live`)).json();
  if (!status.fullBuild) throw new Error(`the server on ${port} has no full build`);
}

let spent = 0;
const results = [];
async function runOne(port, brief) {
  if (spent >= HARD_STOP_USD) {
    log(`${brief.id}: skipped, the total of $${spent.toFixed(2)} reached the stop`);
    return results.push({ id: brief.id, status: "skipped" });
  }
  const base = `http://127.0.0.1:${port}`;
  const started = Date.now();
  const response = await fetch(`${base}/api/live/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode, domain: brief.domain, kind: "fullbuild", brief: brief.brief, facts: brief.facts }) });
  const body = await response.json();
  if (!response.ok) {
    log(`${brief.id}: refused: ${body.error}`);
    return results.push({ id: brief.id, status: "refused", error: body.error });
  }
  log(`${brief.id}: started on ${port}`);
  let job;
  for (;;) {
    await sleep(15000);
    job = await (await fetch(`${base}/api/live/jobs/${body.jobId}`)).json();
    if (job.status !== "running" || Date.now() - started > 75 * 60 * 1000) break;
  }
  spent += job.costUsd ?? 0;
  if (job.status === "done") {
    const record = await fetch(`${base}/api/live/jobs/${body.jobId}/record`);
    if (record.ok) writeFileSync(join(outDir, `${brief.id}.json`), JSON.stringify(await record.json()));
  }
  const build = job.build;
  results.push({
    id: brief.id,
    note: brief.note,
    domain: brief.domain,
    status: job.status,
    error: job.error,
    costUsd: job.costUsd,
    wallSeconds: Math.round((Date.now() - started) / 1000),
    testRunFailures: build ? build.runs.map((run) => run.failing) : null,
    fixRounds: build ? build.fixes.length : null,
    diagram: build ? (build.diagram ? "drawn" : "none") : null,
    firstDrawingProblems: build?.diagramIssues ?? null,
    contractRevised: job.events.some((event) => event.role === "contractFinal"),
  });
  log(`${brief.id}: ${job.status} $${(job.costUsd ?? 0).toFixed(3)} (total $${spent.toFixed(2)})`);
}

await Promise.all(
  ports.map(async (port, server) => {
    for (const at of [server, server + ports.length]) {
      if (!briefs[at]) continue;
      try {
        await runOne(port, briefs[at]);
      } catch (error) {
        log(`${briefs[at].id}: error: ${error.message}`);
        results.push({ id: briefs[at].id, status: "error", error: error.message });
      }
    }
  }),
);
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ spent, results }, null, 1));
log(`done: $${spent.toFixed(3)}, records in ${outDir}`);
for (const server of servers) server.kill();
process.exit(0);
