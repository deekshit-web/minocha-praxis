import type { ModelProvider } from "@northwind/orchestrator";
import * as z from "zod/v4";
import type { ArchDiagram, DiagramEdge, DiagramNode } from "./diagrams.ts";

/**
 * The architecture diagram for a build that has no hand-drawn one: Model A draws the final design as a data-flow
 * diagram, this module places the boxes, and a check refuses anything the design text does not support. A diagram
 * that still fails after one correction is dropped. A wrong picture is worse than none.
 */

const Kind = z.enum(["entity", "process", "store"]);
const Area = z.enum(["new", "modify", "context"]);

// Every field is required, with an empty string for "none", so a strict structured-output grammar accepts it.
export const DiagramDraft = z.object({
  summary: z.string(),
  nodes: z.array(
    z.object({
      id: z.string(),
      kind: Kind,
      area: Area,
      label: z.string(),
      sub: z.string(),
      draftSub: z.string(),
      file: z.string(),
      since: z.enum(["", "review"]),
      finding: z.string(),
      fixedBy: z.string(),
    }),
  ),
  edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string(), both: z.boolean(), since: z.enum(["", "review"]) })),
});
export type DiagramDraftValue = z.infer<typeof DiagramDraft>;

/** The diagram as it is stored with a recording: boxes already placed on the grid. */
export const ArchDiagramSchema = z.object({
  summary: z.string(),
  nodes: z.array(
    z.object({
      id: z.string(),
      kind: Kind,
      area: Area,
      col: z.number(),
      row: z.number(),
      label: z.string(),
      sub: z.string(),
      draftSub: z.string().optional(),
      file: z.string().optional(),
      since: z.literal("review").optional(),
      finding: z.string().optional(),
      fixedBy: z.string().optional(),
    }),
  ),
  edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string(), both: z.boolean().optional(), since: z.literal("review").optional() })),
});

export const DIAGRAM_LIMITS = { minNodes: 4, maxNodes: 8, label: 27, sub: 31, edge: 30, columns: 4, rows: 3 };

export const DIAGRAM_INSTRUCTIONS =
  "Draw this architecture as a data-flow diagram for a person who must approve it. Use between 4 and 8 boxes. " +
  "kind: entity is a person or an outside system, process is code, store is stored data. " +
  "area: new is a file that is created, modify is an existing file that changes, context stays as it is (people, systems and code that the change only reads or calls). " +
  "Give a file only for a new or modify box. Copy it exactly from the file fence in the final design, and use an empty string when the design names no path. Do not draw test files. " +
  "Every file in the final design's file fence must appear on a box. " +
  `label: ${DIAGRAM_LIMITS.label} characters or fewer. sub: ${DIAGRAM_LIMITS.sub} characters or fewer, one plain phrase. Each edge label says what data moves, in ${DIAGRAM_LIMITS.edge} characters or fewer. both is true when data moves both ways. ` +
  "since is 'review' only for a box or an edge that exists only because a review finding was applied. " +
  "finding: the id of a review finding that points at this box in the draft (for example AR-1), else an empty string. fixedBy: the id of the finding that the final design resolves with this box, else an empty string. " +
  "Use finding ids exactly as they appear in the review. draftSub: when the final design changed what a box does, the draft's wording, else an empty string. summary: one sentence that describes the diagram for a person who cannot see it.";

export interface DesignText {
  draft: string;
  review: string;
  final: string;
}

type RawNode = Omit<DiagramNode, "col" | "row">;
export type UnplacedDiagram = { summary: string; nodes: RawNode[]; edges: DiagramEdge[] };

const clean = (value: string) => (value.trim() === "" ? undefined : value.trim());

/** Turns the model's answer into the stored shape: empty strings become absent, and boxes are not yet placed. */
export function normalize(draft: DiagramDraftValue): UnplacedDiagram {
  return {
    summary: draft.summary.trim(),
    nodes: draft.nodes.map((node) => ({
      id: node.id.trim(),
      kind: node.kind,
      area: node.area,
      label: node.label.trim(),
      sub: node.sub.trim(),
      ...(clean(node.draftSub) ? { draftSub: clean(node.draftSub)! } : {}),
      ...(clean(node.file) ? { file: clean(node.file)! } : {}),
      ...(node.since ? { since: node.since } : {}),
      ...(clean(node.finding) ? { finding: clean(node.finding)! } : {}),
      ...(clean(node.fixedBy) ? { fixedBy: clean(node.fixedBy)! } : {}),
    })),
    edges: draft.edges.map((edge) => ({ from: edge.from.trim(), to: edge.to.trim(), label: edge.label.trim(), ...(edge.both ? { both: true } : {}), ...(edge.since ? { since: edge.since } : {}) })),
  };
}

const isTestFile = (path: string) => /(^|\/)(tests?|__tests__)\/|\.(test|spec)\./i.test(path);
const PATH = /[\w@.-]+(?:\/[\w@.()|{},-]+)+\.[\w()|]+|[\w-]+\.(?:ts|tsx|js|jsx|mjs|py|java|go|rb|sql|json)\b/g;
const SOURCE = /\.(ts|tsx|js|jsx|mjs|py|java|go|rb|sql|json|\(.+\))$/i;

/** A design may write src/a/{x,y}.js or app.(tsx|jsx) for several files. This gives each one. */
export function expandPath(token: string): string[] {
  const brace = token.match(/\{([^{}]+)\}/);
  if (brace) return brace[1]!.split(",").flatMap((part) => expandPath(token.replace(brace[0], part.trim())));
  const alt = token.match(/\(([^()|]+(?:\|[^()|]+)+)\)/);
  if (alt) return alt[1]!.split("|").flatMap((part) => expandPath(token.replace(alt[0], part)));
  return [token];
}

/** The path groups a design names, one group per mention, test files left out. A group is every file one mention stands for. */
export function fenceFiles(text: string): string[][] {
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const match of text.match(PATH) ?? []) {
    if (seen.has(match) || isTestFile(match) || !SOURCE.test(match)) continue;
    seen.add(match);
    groups.push(expandPath(match));
  }
  return groups;
}

const namedInDesign = (text: string, file: string) => text.includes(file) || (text.match(PATH) ?? []).some((token) => expandPath(token).includes(file));

/** What is wrong with the diagram, in plain words for the model. Empty when the diagram is acceptable. */
export function validateDiagram(diagram: UnplacedDiagram, design: DesignText): string[] {
  const issues: string[] = [];
  const { nodes, edges } = diagram;
  const L = DIAGRAM_LIMITS;
  if (nodes.length < L.minNodes || nodes.length > L.maxNodes) issues.push(`Use between ${L.minNodes} and ${L.maxNodes} boxes. You used ${nodes.length}.`);
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length || nodes.some((node) => !node.id)) issues.push("Each box needs its own non-empty id.");
  for (const node of nodes) {
    if (!node.label || node.label.length > L.label) issues.push(`The label of box ${node.id} must be 1 to ${L.label} characters.`);
    if (!node.sub || node.sub.length > L.sub) issues.push(`The sub text of box ${node.id} must be 1 to ${L.sub} characters.`);
    if (node.file && node.area === "context") issues.push(`Box ${node.id} stays as it is, so it has no file.`);
    if (node.file && isTestFile(node.file)) issues.push(`Box ${node.id} is a test file. Do not draw test files.`);
    if (node.file && !namedInDesign(design.final, node.file)) issues.push(`The file "${node.file}" of box ${node.id} is not written in the final design. Copy it exactly, or leave it empty.`);
  }
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) issues.push(`The edge "${edge.from}" to "${edge.to}" joins a box that does not exist.`);
    else if (edge.from === edge.to) issues.push(`The edge "${edge.label}" joins box ${edge.from} to itself.`);
    if (!edge.label || edge.label.length > L.edge) issues.push(`The edge from ${edge.from} to ${edge.to} needs a label of 1 to ${L.edge} characters.`);
  }
  if (!nodes.some((node) => node.area !== "context")) issues.push("At least one box must change (new or modify).");
  if (!nodes.some((node) => node.area === "context")) issues.push("At least one box must stay as it is (context): the people, systems or code around the change.");
  // A design may name a file by its bare name in one place and its full path in another, so a name matches the end of a path.
  const shown = nodes.flatMap((node) => (node.file ? expandPath(node.file) : []));
  const same = (a: string, b: string) => a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
  for (const group of fenceFiles(design.final)) if (!group.some((path) => shown.some((file) => same(file, path)))) issues.push(`The final design's file fence lists "${group.join(" or ")}", but no box shows it.`);
  const raised: string[] = design.review.match(/^(?:AR|CR|K)-\d+/gm) ?? [];
  for (const node of nodes) {
    for (const id of [node.finding, node.fixedBy].filter(Boolean) as string[]) if (!raised.includes(id)) issues.push(`Box ${node.id} names ${id}, which the review did not raise.`);
    if ((node.since || node.fixedBy || node.draftSub) && !raised.length) issues.push(`Box ${node.id} claims a change from a review, but the review raised no finding.`);
  }
  for (const edge of edges) if (edge.since && !raised.length) issues.push(`The edge from ${edge.from} to ${edge.to} claims a change from a review, but the review raised no finding.`);
  const late = new Set(nodes.filter((node) => node.since).map((node) => node.id));
  for (const edge of edges) if ((late.has(edge.from) || late.has(edge.to)) && !edge.since) issues.push(`The edge from ${edge.from} to ${edge.to} touches a box that exists only after the review, so mark it since: review.`);
  return issues;
}

/** The size of a box and the spacing of the grid, as the page draws them (DIAGRAM in public/index.html). */
const GEOMETRY = { nodeW: 200, nodeH: 78, colX: 290, rowY: 116 };
type Point = { x: number; y: number };
type Box = { x0: number; y0: number; x1: number; y1: number };

/** Whether the segment p to q passes through the box (Liang and Barsky). */
function segmentHitsBox(p: Point, q: Point, box: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  for (const [pk, qk] of [[-dx, p.x - box.x0], [dx, box.x1 - p.x], [-dy, p.y - box.y0], [dy, box.y1 - p.y]] as Array<[number, number]>) {
    if (pk === 0) {
      if (qk < 0) return false;
    } else {
      const r = qk / pk;
      if (pk < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const side = (a: Point, b: Point, c: Point) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return side(p1, p2, p3) !== side(p1, p2, p4) && side(p3, p4, p1) !== side(p3, p4, p2);
}

/**
 * Places the boxes on the grid the page draws: 4 columns by 3 rows. Boxes go left to right in the direction of the
 * data, with the first sources on the left. A box that nothing connects to goes in the last column.
 */
export function layoutDiagram(diagram: UnplacedDiagram): ArchDiagram {
  const { nodes, edges } = diagram;
  const L = DIAGRAM_LIMITS;
  const index = new Map(nodes.map((node, at) => [node.id, at]));
  const out: number[][] = nodes.map(() => []);
  const into: number[][] = nodes.map(() => []);
  for (const edge of edges) {
    const a = index.get(edge.from);
    const b = index.get(edge.to);
    if (a === undefined || b === undefined || a === b) continue;
    out[a]!.push(b);
    into[b]!.push(a);
  }
  // Data often goes round a loop (a screen reads a record, then writes it back). To order the boxes, one edge of each loop
  // is left out of the ordering. It is the edge that feeds a person, a system or stored data that also sends data on, so
  // that kind of box stays on the left, where the data starts.
  const pairs: Array<[number, number]> = [];
  nodes.forEach((_, a) => new Set(out[a]).forEach((b) => pairs.push([a, b])));
  const feedsSource = ([, b]: [number, number]) => (nodes[b]!.kind !== "process" && out[b]!.length > 0 ? 2 : 1);
  const findLoop = (active: Array<[number, number]>): number[] | null => {
    const stack: number[] = [];
    const onStack = new Set<number>();
    const done = new Set<number>();
    let found: number[] | null = null;
    const walk = (at: number) => {
      if (found) return;
      stack.push(at);
      onStack.add(at);
      for (const [, next] of active.filter(([from]) => from === at)) {
        if (found) break;
        if (onStack.has(next)) {
          const loop = stack.slice(stack.indexOf(next));
          found = loop.map((from, place) => active.findIndex(([a, b]) => a === from && b === loop[(place + 1) % loop.length]));
        } else if (!done.has(next)) walk(next);
      }
      stack.pop();
      onStack.delete(at);
      done.add(at);
    };
    nodes.forEach((_, at) => !done.has(at) && walk(at));
    return found;
  };
  const active = pairs.slice();
  for (let loop = findLoop(active); loop; loop = findLoop(active)) {
    // On a tie the edge that closes the loop goes, because it is the last one on the path.
    const worst = loop.reduce((best, edge) => (feedsSource(active[edge]!) >= feedsSource(active[best]!) ? edge : best));
    active.splice(worst, 1);
  }
  const forward: number[][] = nodes.map(() => []);
  for (const [a, b] of active) forward[a]!.push(b);
  const layer = nodes.map(() => 0);
  const order: number[] = [];
  const seen = nodes.map(() => false);
  const sort = (at: number) => {
    seen[at] = true;
    for (const next of forward[at]!) if (!seen[next]) sort(next);
    order.unshift(at);
  };
  nodes.forEach((_, at) => !seen[at] && sort(at));
  for (const at of order) for (const next of forward[at]!) layer[next] = Math.max(layer[next]!, layer[at]! + 1);
  const connected = nodes.map((_, at) => out[at]!.length + into[at]!.length > 0);
  let deepest = Math.max(0, ...layer.filter((_, at) => connected[at]));
  if (deepest >= L.columns) {
    const scale = (L.columns - 1) / deepest;
    layer.forEach((value, at) => (layer[at] = Math.min(L.columns - 1, Math.floor(value * scale))));
    deepest = L.columns - 1;
  }
  const column = nodes.map((_, at) => (connected[at] ? layer[at]! : Math.max(deepest, nodes.some((__, other) => connected[other]) ? deepest : 0)));
  const members: number[][] = Array.from({ length: L.columns }, () => []);
  nodes.forEach((_, at) => members[column[at]!]!.push(at));
  // A column holds 3 boxes. The extra ones move to the nearest column with room.
  for (let c = 0; c < L.columns; c += 1) {
    while (members[c]!.length > L.rows) {
      const moved = members[c]!.pop()!;
      const target = [...Array(L.columns).keys()].filter((other) => members[other]!.length < L.rows).sort((a, b) => Math.abs(a - c) - Math.abs(b - c))[0];
      if (target === undefined) throw new Error("the diagram has more boxes than the grid holds");
      members[target]!.push(moved);
      column[moved] = target;
    }
  }
  // Choose the row of each box. Each column has few boxes, so every way to place them is tried, and the best one is kept:
  // first no arrow through a box, then fewest crossing arrows, then the shortest vertical runs.
  const centre = (col: number, rowAt: number) => ({ x: GEOMETRY.colX * col + GEOMETRY.nodeW / 2, y: GEOMETRY.rowY * rowAt + GEOMETRY.nodeH / 2 });
  const arrows = [...new Set(pairs.map(([a, b]) => `${a}>${b}`))].map((key) => key.split(">").map(Number) as [number, number]);
  const rowsFor = (size: number): number[][] => {
    const all: number[][] = [];
    const pick = (chosen: number[]) => {
      if (chosen.length === size) return void all.push(chosen);
      for (let rowAt = 0; rowAt < L.rows; rowAt += 1) if (!chosen.includes(rowAt)) pick([...chosen, rowAt]);
    };
    pick([]);
    return all;
  };
  const options = members.map((list) => rowsFor(list.length));
  const row = nodes.map(() => 0);
  const costOf = () => {
    let through = 0;
    let crossings = 0;
    let vertical = 0;
    const lines = arrows.map(([a, b]) => ({ a, b, p: centre(column[a]!, row[a]!), q: centre(column[b]!, row[b]!) }));
    for (const line of lines) {
      vertical += Math.abs(row[line.a]! - row[line.b]!);
      nodes.forEach((_, other) => {
        if (other === line.a || other === line.b) return;
        const at = centre(column[other]!, row[other]!);
        if (segmentHitsBox(line.p, line.q, { x0: at.x - GEOMETRY.nodeW / 2 - 6, y0: at.y - GEOMETRY.nodeH / 2 - 6, x1: at.x + GEOMETRY.nodeW / 2 + 6, y1: at.y + GEOMETRY.nodeH / 2 + 6 })) through += 1;
      });
    }
    for (let i = 0; i < lines.length; i += 1)
      for (let j = i + 1; j < lines.length; j += 1) {
        const [x, y] = [lines[i]!, lines[j]!];
        if (x.a !== y.a && x.a !== y.b && x.b !== y.a && x.b !== y.b && segmentsCross(x.p, x.q, y.p, y.q)) crossings += 1;
      }
    return through * 10_000 + crossings * 100 + vertical;
  };
  let best = Number.POSITIVE_INFINITY;
  let bestRows = row.slice();
  const search = (c: number) => {
    if (c === L.columns) {
      const cost = costOf();
      if (cost < best) {
        best = cost;
        bestRows = row.slice();
      }
      return;
    }
    for (const choice of options[c]!) {
      members[c]!.forEach((at, place) => (row[at] = choice[place]!));
      search(c + 1);
    }
  };
  search(0);
  bestRows.forEach((value, at) => (row[at] = value));
  return {
    summary: diagram.summary,
    nodes: nodes.map((node, at) => ({ ...node, col: column[at]!, row: row[at]! })),
    edges,
  };
}

/** The arrows that pass through a box other than their own two, for a placed diagram. A good layout has none. */
export function arrowsThroughBoxes(diagram: ArchDiagram): string[] {
  const at = new Map(diagram.nodes.map((node) => [node.id, node]));
  const centre = (node: DiagramNode) => ({ x: GEOMETRY.colX * node.col + GEOMETRY.nodeW / 2, y: GEOMETRY.rowY * node.row + GEOMETRY.nodeH / 2 });
  const found: string[] = [];
  for (const edge of diagram.edges) {
    const from = at.get(edge.from);
    const to = at.get(edge.to);
    if (!from || !to) continue;
    for (const other of diagram.nodes) {
      if (other === from || other === to) continue;
      const c = centre(other);
      if (segmentHitsBox(centre(from), centre(to), { x0: c.x - GEOMETRY.nodeW / 2, y0: c.y - GEOMETRY.nodeH / 2, x1: c.x + GEOMETRY.nodeW / 2, y1: c.y + GEOMETRY.nodeH / 2 })) found.push(`${edge.from} to ${edge.to} through ${other.id}`);
    }
  }
  return found;
}

export type AskFn = <T>(seat: ModelProvider, role: string, prompt: string, schema: z.ZodType<T>, model: string) => Promise<T>;

export interface GeneratedDiagram {
  diagram: ArchDiagram | null;
  /** Why there is no diagram, or what the first attempt got wrong and the correction fixed. */
  issues: string[];
}

/** Model A draws the design. One correction is allowed, then the diagram is dropped. */
export async function generateDiagram(ask: AskFn, seat: (instructions: string, schema: z.ZodType<unknown>) => ModelProvider, design: DesignText, model: string): Promise<GeneratedDiagram> {
  const prompt = `Architecture draft:\n${design.draft}\n\nReview of the draft:\n${design.review}\n\nFinal design:\n${design.final}`;
  const first = await ask(seat(DIAGRAM_INSTRUCTIONS, DiagramDraft), "diagram", prompt, DiagramDraft, model);
  let diagram = normalize(first);
  let issues = validateDiagram(diagram, design);
  if (!issues.length) return { diagram: layoutDiagram(diagram), issues: [] };
  const second = await ask(seat(DIAGRAM_INSTRUCTIONS, DiagramDraft), "diagramFix", `${prompt}\n\nYour diagram:\n${JSON.stringify(first)}\n\nFix these problems and return the whole diagram again:\n- ${issues.join("\n- ")}`, DiagramDraft, model);
  diagram = normalize(second);
  const remaining = validateDiagram(diagram, design);
  if (remaining.length) return { diagram: null, issues: remaining };
  return { diagram: layoutDiagram(diagram), issues };
}
