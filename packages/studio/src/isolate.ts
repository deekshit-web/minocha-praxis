import { repoRoot } from "@northwind/orchestrator";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Runs model-written code and a test script in a child process that has nothing to steal and little it may do.
 *
 * The browser safety scan (public/tests.js) is not a security boundary: it blanks out string literals before it
 * looks for names, so `[].filter["con" + "structor"]("return process")()` gets past it. What protects the server is
 * this process boundary:
 *  - an empty environment, so the API keys are not there to read;
 *  - Node's permission model with no grants: no file reads (except the one test module), no file writes, no child
 *    processes, no worker threads, no native addons;
 *  - a new network namespace (`unshare -rn`), because the permission model does not stop network calls. Where the
 *    host cannot make one, `networkIsolated()` says so, and a public host must not run this;
 *  - a time limit, a memory limit, and a cap on output.
 * The tests in isolate.test.ts attack each of these.
 */

export interface TestOutcome {
  results: Array<{ name: string; pass: boolean; message: string | null }>;
  error: string | null;
}

const RESULT_MARK = "@@RESULT@@";
const MAX_OUTPUT_BYTES = 256 * 1024;

// Runs inside the child. It reads the code and the script from stdin, so nothing reaches it through arguments.
const RUNNER = `
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const { code, script, testsUrl, mark } = JSON.parse(Buffer.concat(chunks).toString());
for (const name of ["fetch", "WebSocket", "EventSource", "XMLHttpRequest"]) delete globalThis[name];
const tests = await import(testsUrl);
let outcome;
try {
  outcome = { results: tests.runRecorded(code, script), error: null };
} catch (error) {
  outcome = { results: [], error: String((error && error.message) || error) };
}
process.stdout.write("\\n" + mark + JSON.stringify(outcome) + "\\n");
`;

let networkProbe: boolean | undefined;

/** Whether this host can run the child in a new network namespace. A public host needs this to be true. */
export function networkIsolated(): boolean {
  if (networkProbe === undefined) {
    const probe = spawnSync("unshare", ["-rn", "--", process.execPath, "-e", "process.exit(0)"], { env: {}, timeout: 5000, stdio: "ignore" });
    networkProbe = probe.status === 0;
  }
  return networkProbe;
}

export interface IsolationOptions {
  timeoutMs?: number;
  memoryMb?: number;
  /** Refuse to run, rather than run without a network namespace. */
  requireNetworkIsolation?: boolean;
}

export function runIsolated(code: string, script: string, options: IsolationOptions = {}): Promise<TestOutcome> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const testsPath = join(repoRoot(), "packages/studio/public/tests.js");
  const isolated = networkIsolated();
  if (options.requireNetworkIsolation && !isolated) return Promise.resolve({ results: [], error: "the sandbox cannot isolate the network on this host, so it did not run the code" });
  const nodeArgs = ["--permission", `--allow-fs-read=${testsPath}`, `--max-old-space-size=${options.memoryMb ?? 64}`, "--input-type=module", "-e", RUNNER];
  const [command, args] = isolated ? ["unshare", ["-rn", "--", process.execPath, ...nodeArgs]] : [process.execPath, nodeArgs];
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: {}, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    let bytes = 0;
    let reason: string | null = null;
    // The marker before the result is random for each run and reaches only the runner, so the code under test cannot print a result of its own.
    const mark = `${RESULT_MARK}${randomBytes(12).toString("hex")}:`;
    const stop = (why: string) => {
      reason ??= why;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => stop(`timed out after ${timeoutMs / 1000} s`), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) return stop("wrote too much output");
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errors.length < 4000) errors += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ results: [], error: `the sandbox could not start: ${error.message}` });
    });
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      const at = output.lastIndexOf(mark);
      if (at >= 0 && !reason) {
        try {
          return resolve(JSON.parse(output.slice(at + mark.length).split("\n")[0]!) as TestOutcome);
        } catch {
          return resolve({ results: [], error: "the sandbox returned a result that could not be read" });
        }
      }
      const memory = /heap out of memory|allocation failed|JavaScript heap/i.test(errors);
      const why = reason ?? (memory ? "ran out of memory" : signal ? `was stopped by ${signal}` : status === 0 ? "stopped before the tests finished" : `exited with code ${status}`);
      resolve({ results: [], error: `the sandbox ${why}` });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ code, script, testsUrl: pathToFileURL(testsPath).href, mark }));
  });
}
