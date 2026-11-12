import assert from "node:assert/strict";
import test from "node:test";
import { ARCH_DIAGRAMS } from "./diagrams.ts";
import { expand, loadSpecs } from "./workflows.ts";

const builds = loadSpecs().filter((spec) => spec.kind === "build");

test("Each build workflow has an architecture diagram. A document workflow has none.", () => {
  assert.equal(builds.length, 5);
  for (const spec of loadSpecs()) {
    const flow = expand(spec);
    if (spec.kind === "build") assert.ok(flow.diagram && flow.diagram.nodes.length >= 5, spec.id);
    else assert.equal(flow.diagram, null, spec.id);
  }
});

test("Each edge joins two nodes that exist. Each node has its own place on the grid.", () => {
  for (const [id, diagram] of Object.entries(ARCH_DIAGRAMS)) {
    const ids = new Set(diagram.nodes.map((node) => node.id));
    assert.equal(ids.size, diagram.nodes.length, `${id}: node IDs are not unique`);
    for (const edge of diagram.edges) {
      assert.ok(ids.has(edge.from) && ids.has(edge.to), `${id}: edge ${edge.from} to ${edge.to}`);
      assert.notEqual(edge.from, edge.to, id);
    }
    const places = diagram.nodes.map((node) => `${node.col},${node.row}`);
    assert.equal(new Set(places).size, places.length, `${id}: two nodes share a place`);
    for (const node of diagram.nodes) {
      assert.ok(node.col >= 0 && node.col <= 3 && node.row >= 0 && node.row <= 2, `${id}: ${node.id} is off the grid`);
      assert.ok(node.label.length <= 27 && node.sub.length <= 31, `${id}: ${node.id} text is too long for its box`);
    }
  }
});

test("Each file in a diagram is in the file fence of the recorded design.", () => {
  for (const spec of builds) {
    const flow = expand(spec);
    const design = flow.steps.find((step) => step.id === "archFinal")!.output;
    for (const node of flow.diagram!.nodes.filter((item) => item.file)) {
      const stem = node.file!.split("/").pop()!.split(".")[0]!;
      const folder = node.file!.slice(0, node.file!.lastIndexOf("/") + 1);
      assert.ok(design.includes(stem), `${spec.id}: ${node.file} is not in the design (name)`);
      assert.ok(design.includes(folder.slice(0, folder.lastIndexOf("/", folder.length - 2) + 1)), `${spec.id}: ${node.file} is not in the design (folder)`);
    }
  }
});

test("Each diagram marks an area that changes and an area that stays as it is.", () => {
  for (const [id, diagram] of Object.entries(ARCH_DIAGRAMS)) {
    assert.ok(diagram.nodes.some((node) => node.area !== "context"), `${id}: nothing changes`);
    assert.ok(diagram.nodes.some((node) => node.area === "context"), `${id}: nothing stays`);
  }
});

test("A finding in a diagram names a review finding that the recorded review raised.", () => {
  for (const spec of builds) {
    const flow = expand(spec);
    const review = flow.steps.find((step) => step.id === "archReview")!.output;
    for (const node of flow.diagram!.nodes) {
      for (const finding of [node.finding, node.fixedBy].filter(Boolean) as string[]) assert.ok(review.includes(finding), `${spec.id}: ${finding} is not in the review`);
    }
  }
});
