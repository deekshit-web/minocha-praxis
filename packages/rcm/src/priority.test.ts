import assert from "node:assert/strict";
import test from "node:test";
import { runPriorityChecks } from "./priority.ts";

test("The priority cases pass on a new denial workbench.", async () => {
  const results = await runPriorityChecks(["TC-1", "TC-2", "TC-3", "TC-4", "TC-5"]);
  assert.deepEqual(
    results.map((item) => item.passed),
    [true, true, true, true, true],
  );
  assert.match(results.map((item) => item.detail).join("\n"), /clinical note/);
  assert.match(results.map((item) => item.detail).join("\n"), /filing deadline/);
  assert.match(results.map((item) => item.detail).join("\n"), /DOC-003/);
  assert.match(results.map((item) => item.detail).join("\n"), /CO-16|marks ready/);
  assert.match(results.map((item) => item.detail).join("\n"), /no appeal/);
});

test("A priority case without a workbench check fails.", async () => {
  const results = await runPriorityChecks(["TC-9"]);
  assert.equal(results[0]?.passed, false);
  assert.match(results[0]?.detail ?? "", /no workbench check/);
});
