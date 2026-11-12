import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider } from "@northwind/orchestrator";
import { type AskFn, type DesignText, DiagramDraft, type DiagramDraftValue, type UnplacedDiagram, expandPath, fenceFiles, arrowsThroughBoxes, generateDiagram, layoutDiagram, normalize, validateDiagram } from "./diagramGen.ts";
import { ARCH_DIAGRAMS, type ArchDiagram } from "./diagrams.ts";
import { loadSpecs } from "./workflows.ts";

const builds = loadSpecs().filter((spec) => spec.kind === "build");
const designOf = (id: string): DesignText => {
  const architecture = builds.find((spec) => spec.id === id)!.buildRecording!.architecture;
  return { draft: architecture.draft, review: architecture.review, final: architecture.final };
};
// A copy of everything, so a test that changes its copy cannot change the diagram that the other tests read.
const unplaced = (diagram: ArchDiagram): UnplacedDiagram => ({ summary: diagram.summary, nodes: diagram.nodes.map(({ col: _col, row: _row, ...node }) => ({ ...node })), edges: diagram.edges.map((edge) => ({ ...edge })) });
const asDraft = (diagram: UnplacedDiagram): DiagramDraftValue => ({
  summary: diagram.summary,
  nodes: diagram.nodes.map((node) => ({ draftSub: "", file: "", since: "", finding: "", fixedBy: "", ...node })) as DiagramDraftValue["nodes"],
  edges: diagram.edges.map((edge) => ({ both: false, since: "", ...edge })) as DiagramDraftValue["edges"],
});

test("The check accepts each hand-drawn diagram against its recorded design.", () => {
  for (const [id, diagram] of Object.entries(ARCH_DIAGRAMS)) assert.deepEqual(validateDiagram(unplaced(diagram), designOf(id)), [], id);
});

test("The check rejects a file that the design does not name.", () => {
  const diagram = unplaced(ARCH_DIAGRAMS["healthcare-build"]!);
  diagram.nodes.find((node) => node.id === "ready")!.file = "src/invented/appealReady.ts";
  assert.match(validateDiagram(diagram, designOf("healthcare-build")).join("\n"), /"src\/invented\/appealReady\.ts" of box ready is not written in the final design/);
});

test("The check rejects a diagram that leaves out a file of the file fence.", () => {
  const diagram = unplaced(ARCH_DIAGRAMS["healthcare-build"]!);
  delete diagram.nodes.find((node) => node.id === "handler")!.file;
  assert.match(validateDiagram(diagram, designOf("healthcare-build")).join("\n"), /file fence lists "src\/api\/denials\/markReady\.ts", but no box shows it/);
});

test("The check rejects a finding that the review did not raise.", () => {
  const diagram = unplaced(ARCH_DIAGRAMS["fmcg-build"]!);
  diagram.nodes.find((node) => node.id === "alerter")!.finding = "AR-9";
  assert.match(validateDiagram(diagram, designOf("fmcg-build")).join("\n"), /names AR-9, which the review did not raise/);
});

test("The check rejects a change from a review when the review found nothing.", () => {
  const diagram = unplaced(ARCH_DIAGRAMS["healthcare-build"]!);
  diagram.nodes.find((node) => node.id === "ready")!.fixedBy = "AR-1";
  const text = validateDiagram(diagram, designOf("healthcare-build")).join("\n");
  assert.match(text, /names AR-1, which the review did not raise/);
  assert.match(text, /claims a change from a review, but the review raised no finding/);
});

test("The check rejects an edge that joins a box that does not exist, and a diagram with too many boxes.", () => {
  const diagram = unplaced(ARCH_DIAGRAMS["healthcare-build"]!);
  diagram.edges.push({ from: "ready", to: "ghost", label: "data" });
  assert.match(validateDiagram(diagram, designOf("healthcare-build")).join("\n"), /joins a box that does not exist/);
  const big = unplaced(ARCH_DIAGRAMS["education-build"]!);
  big.nodes.push({ id: "extra", kind: "process", area: "new", label: "Extra", sub: "one more box" });
  assert.match(validateDiagram(big, designOf("education-build")).join("\n"), /Use between 4 and 8 boxes. You used 9./);
});

test("The check needs one box that changes and one box that stays as it is.", () => {
  const diagram = unplaced(ARCH_DIAGRAMS["logistics-build"]!);
  for (const node of diagram.nodes) node.area = "context";
  for (const node of diagram.nodes) delete node.file;
  const text = validateDiagram(diagram, designOf("logistics-build")).join("\n");
  assert.match(text, /At least one box must change/);
});

test("A design can write several files as one path. The check counts each file.", () => {
  assert.deepEqual(expandPath("src/delay/{time,notifier,format}.js"), ["src/delay/time.js", "src/delay/notifier.js", "src/delay/format.js"]);
  assert.deepEqual(expandPath("src/screens/PreQualification.(tsx|jsx)"), ["src/screens/PreQualification.tsx", "src/screens/PreQualification.jsx"]);
  const groups = fenceFiles("File fence: src/delay/{time,notifier}.js and test/delay/{time,notifier}.test.js.");
  assert.deepEqual(groups, [["src/delay/time.js", "src/delay/notifier.js"]]);
});

test("The layout puts each box in its own place on the grid, with data flowing from left to right.", () => {
  for (const [id, diagram] of Object.entries(ARCH_DIAGRAMS)) {
    const placed = layoutDiagram(unplaced(diagram));
    const places = placed.nodes.map((node) => `${node.col},${node.row}`);
    assert.equal(new Set(places).size, places.length, `${id}: two boxes share a place`);
    for (const node of placed.nodes) assert.ok(node.col >= 0 && node.col <= 3 && node.row >= 0 && node.row <= 2, `${id}: ${node.id} is off the grid`);
    const at = new Map(placed.nodes.map((node) => [node.id, node]));
    // An edge may run backward only when it closes a loop: the data can get from its end back to its start.
    const reaches = (from: string, to: string, seen = new Set<string>()): boolean => from === to || (!seen.has(from) && (seen.add(from), placed.edges.some((edge) => edge.from === from && reaches(edge.to, to, seen))));
    for (const edge of placed.edges) assert.ok(at.get(edge.from)!.col <= at.get(edge.to)!.col || reaches(edge.to, edge.from), `${id}: ${edge.from} to ${edge.to} runs backward without closing a loop`);
  }
});

test("The layout draws no arrow through a box.", () => {
  for (const [id, diagram] of Object.entries(ARCH_DIAGRAMS)) assert.deepEqual(arrowsThroughBoxes(layoutDiagram(unplaced(diagram))), [], id);
});

test("The layout puts a box with no edge in the last column. It handles a loop in the data flow.", () => {
  const node = (id: string) => ({ id, kind: "process" as const, area: "new" as const, label: id, sub: "x" });
  const placed = layoutDiagram({ summary: "s", nodes: ["a", "b", "c", "lonely"].map(node), edges: [{ from: "a", to: "b", label: "x" }, { from: "b", to: "c", label: "x" }, { from: "c", to: "a", label: "loop" }] });
  assert.equal(placed.nodes.find((item) => item.id === "lonely")!.col, 2);
  assert.deepEqual(placed.nodes.filter((item) => item.id !== "lonely").map((item) => item.col), [0, 1, 2]);
});

test("The layout spreads a long chain over four columns. It moves extra boxes out of a full column.", () => {
  const node = (id: string) => ({ id, kind: "process" as const, area: "new" as const, label: id, sub: "x" });
  const chain = layoutDiagram({ summary: "s", nodes: ["a", "b", "c", "d", "e", "f"].map(node), edges: ["ab", "bc", "cd", "de", "ef"].map((pair) => ({ from: pair[0]!, to: pair[1]!, label: "x" })) });
  assert.ok(chain.nodes.every((item) => item.col <= 3));
  const fan = layoutDiagram({ summary: "s", nodes: ["s", "a", "b", "c", "d", "e"].map(node), edges: ["a", "b", "c", "d", "e"].map((to) => ({ from: "s", to, label: "x" })) });
  const perColumn = [0, 1, 2, 3].map((col) => fan.nodes.filter((item) => item.col === col).length);
  assert.ok(perColumn.every((count) => count <= 3), `a column has more than 3 boxes: ${perColumn}`);
});

/** An ask that answers from a list, and records the roles it was asked. */
function scriptedAsk(answers: DiagramDraftValue[]): { ask: AskFn; roles: string[] } {
  const roles: string[] = [];
  const ask: AskFn = async (_seat, role, _prompt, schema) => {
    roles.push(role);
    const next = answers.shift();
    if (!next) throw new Error("no scripted answer");
    return schema.parse(next);
  };
  return { ask, roles };
}
const noSeat = () => ({}) as ModelProvider;

test("A good drawing passes the check the first time. The boxes are placed.", async () => {
  const good = asDraft(unplaced(ARCH_DIAGRAMS["fmcg-build"]!));
  const { ask, roles } = scriptedAsk([good]);
  const result = await generateDiagram(ask, noSeat, designOf("fmcg-build"), "claude-opus-5-5");
  assert.deepEqual(roles, ["diagram"]);
  assert.deepEqual(result.issues, []);
  assert.equal(result.diagram?.nodes.length, 6);
  assert.ok(result.diagram!.nodes.every((node) => Number.isInteger(node.col) && Number.isInteger(node.row)));
});

test("A drawing with a wrong file gets one correction. The correction passes.", async () => {
  const bad = asDraft(unplaced(ARCH_DIAGRAMS["healthcare-build"]!));
  bad.nodes.find((node) => node.id === "ready")!.file = "src/invented/appealReady.ts";
  const good = asDraft(unplaced(ARCH_DIAGRAMS["healthcare-build"]!));
  const { ask, roles } = scriptedAsk([bad, good]);
  const result = await generateDiagram(ask, noSeat, designOf("healthcare-build"), "claude-opus-5-5");
  assert.deepEqual(roles, ["diagram", "diagramFix"]);
  assert.ok(result.diagram, result.issues.join(" | "));
  assert.match(result.issues.join("\n"), /is not written in the final design/);
});

test("A drawing that fails the check twice is dropped. The reasons are kept.", async () => {
  const bad = asDraft(unplaced(ARCH_DIAGRAMS["healthcare-build"]!));
  bad.nodes.find((node) => node.id === "ready")!.file = "src/invented/appealReady.ts";
  const { ask, roles } = scriptedAsk([bad, bad]);
  const result = await generateDiagram(ask, noSeat, designOf("healthcare-build"), "claude-opus-5-5");
  assert.deepEqual(roles, ["diagram", "diagramFix"]);
  assert.equal(result.diagram, null);
  assert.match(result.issues.join("\n"), /is not written in the final design/);
});

test("The normal form drops empty strings.", () => {
  const draft = DiagramDraft.parse(asDraft(unplaced(ARCH_DIAGRAMS["healthcare-build"]!)));
  const result = normalize(draft);
  assert.equal("draftSub" in result.nodes[0]!, false);
  assert.equal(result.nodes.find((node) => node.id === "ready")!.file, "src/denials/appealReady.ts");
});
