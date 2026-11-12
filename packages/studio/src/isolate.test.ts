import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { unsafeNames } from "../public/tests.js";
import { sandboxRun } from "./build.ts";
import { networkIsolated, runIsolated } from "./isolate.ts";

/**
 * Hostile code. Each attack reaches `process` through `[].filter["con" + "structor"]`, a way past the browser scan, so
 * the tests show that the process boundary stops it and not the scan.
 */
const attack = (body: string) => `({ attack() { const F = [].filter["con" + "structor"]; return F(${JSON.stringify(body)})(); } })`;
const expects = (value: unknown) => `test("attack", () => assert.equal(code.attack(), ${JSON.stringify(value)}));`;
const builtin = (name: string) => `process.getBuiltinModule('${name}')`;

async function passes(body: string, value: unknown) {
  const outcome = await sandboxRun(attack(body), expects(value));
  assert.equal(outcome.error, null, outcome.error ?? "");
  assert.equal(outcome.results[0]?.pass, true, outcome.results[0]?.message ?? "the attack code did not return the expected value");
}

test("The browser scan does not stop the attack code. The sandbox does.", () => {
  assert.deepEqual(unsafeNames(attack("return process.env")), []);
});

test("The sandbox runs good code and reports a failing test.", async () => {
  const good = await sandboxRun("({ add(a, b) { return a + b; } })", 'test("adds", () => assert.equal(code.add(2, 2), 4));');
  assert.deepEqual(good.results.map((result) => result.pass), [true]);
  const bad = await sandboxRun("({ add(a, b) { return a - b; } })", 'test("adds", () => assert.equal(code.add(2, 2), 4));');
  assert.deepEqual(bad.results.map((result) => result.pass), [false]);
  assert.match(bad.results[0]?.message ?? "", /expected 4, received 0/);
});

test("The code cannot read the environment of the server.", async () => {
  process.env.SANDBOX_TEST_SECRET = "do-not-leak";
  try {
    await passes("return JSON.stringify(Object.keys(process.env))", "[]");
  } finally {
    delete process.env.SANDBOX_TEST_SECRET;
  }
});

test("The code cannot read a file.", async () => {
  await passes(`try { return ${builtin("fs")}.readFileSync('/etc/passwd', 'utf8').slice(0, 4); } catch (error) { return error.code; }`, "ERR_ACCESS_DENIED");
});

test("The code cannot write a file.", async () => {
  await passes(`try { ${builtin("fs")}.writeFileSync('/tmp/sandbox-test-should-not-exist', 'x'); return 'WROTE'; } catch (error) { return error.code; }`, "ERR_ACCESS_DENIED");
});

test("The code cannot start a process.", async () => {
  await passes(`try { ${builtin("child_process")}.execSync('id'); return 'RAN'; } catch (error) { return error.code; }`, "ERR_ACCESS_DENIED");
});

test("The code cannot start a worker thread.", async () => {
  await passes(`try { new (${builtin("worker_threads")}.Worker)('1', { eval: true }); return 'STARTED'; } catch (error) { return error.code; }`, "ERR_ACCESS_DENIED");
});

test("The code cannot load a native addon.", async () => {
  await passes(`try { process.dlopen({ exports: {} }, '/lib/x86_64-linux-gnu/libc.so.6'); return 'LOADED'; } catch (error) { return error.code; }`, "ERR_DLOPEN_DISABLED");
});

test("The code cannot reach a server on the host network. This needs a host that can make a network namespace.", { skip: !networkIsolated() && "this host cannot isolate the network" }, async () => {
  let reached = false;
  const server = createServer((socket) => {
    reached = true;
    socket.end("hello");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const code = `({ attack() { const F = [].filter["con" + "structor"]; const net = F("return process.getBuiltinModule('net')")(); net.connect(${port}, "127.0.0.1").on("error", () => {}); return "tried"; } })`;
    const outcome = await sandboxRun(code, expects("tried"));
    assert.equal(outcome.results[0]?.pass, true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(reached, false, "the sandbox reached a server on the host");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("A loop that does not end stops at the time limit.", async () => {
  const outcome = await sandboxRun("({ spin() { for (;;) {} } })", 'test("spins", () => code.spin());', 500);
  assert.match(outcome.error ?? "", /timed out after 0\.5 s/);
});

test("Code that uses all the memory stops. The server stays up.", async () => {
  const outcome = await sandboxRun("({ bomb() { const items = []; for (;;) items.push(new Array(1e6).fill(1)); } })", 'test("bomb", () => code.bomb());', 20_000);
  assert.match(outcome.error ?? "", /ran out of memory|stopped by SIG/);
  assert.equal(outcome.results.length, 0);
});

test("Code that writes too much output stops, and its output is not kept.", async () => {
  const outcome = await sandboxRun(attack("for (let i = 0; i < 100; i += 1) process.stdout.write('x'.repeat(1e6)); return 1"), expects(1), 20_000);
  assert.match(outcome.error ?? "", /wrote too much output/);
  assert.equal(outcome.results.length, 0);
});

test("Code that ends the process early does not pass its tests.", async () => {
  const outcome = await sandboxRun(attack("process.exit(0)"), expects(1));
  assert.match(outcome.error ?? "", /stopped before the tests finished/);
  assert.equal(outcome.results.length, 0);
});

test("Code that prints a result of its own does not pass its tests.", async () => {
  const forged = JSON.stringify({ results: [{ name: "forged", pass: true, message: null }], error: null });
  const outcome = await sandboxRun(attack(`process.stdout.write('\\n@@RESULT@@' + ${JSON.stringify(forged)} + '\\n'); process.exit(0)`), expects(1));
  assert.equal(outcome.results.length, 0);
  assert.match(outcome.error ?? "", /stopped before the tests finished/);
});

test("Code that is refused by the scan reports why. It never runs.", async () => {
  const outcome = await sandboxRun('({ steal() { return fetch("https://example.com"); } })', 'test("x", () => assert.ok(true));');
  assert.match(outcome.error ?? "", /refused to run: uses fetch/);
});

test("The sandbox refuses to run when it must isolate the network and cannot.", async () => {
  if (networkIsolated()) return;
  const outcome = await runIsolated("({})", 'test("x", () => {});', { requireNetworkIsolation: true });
  assert.match(outcome.error ?? "", /cannot isolate the network/);
});

test("After the attacks, the sandbox still runs good code.", async () => {
  const outcome = await sandboxRun("({ one() { return 1; } })", 'test("one", () => assert.equal(code.one(), 1));');
  assert.deepEqual(outcome.results.map((result) => result.pass), [true]);
});
