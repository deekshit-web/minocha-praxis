import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface Chunk {
  id: string;
  path: string;
  tags: string[];
  status: string;
  text: string;
  score: number;
}

export function parseFrontMatter(raw: string): { meta: Record<string, string>; tags: string[]; body: string } {
  if (!raw.startsWith("---\n")) return { meta: {}, tags: [], body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return { meta: {}, tags: [], body: raw };
  const meta: Record<string, string> = {};
  let tags: string[] = [];
  for (const line of raw.slice(4, end).split("\n")) {
    const splitAt = line.indexOf(":");
    if (splitAt === -1) continue;
    const key = line.slice(0, splitAt).trim();
    const value = line.slice(splitAt + 1).trim();
    if (key === "tags") {
      tags = value
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
    } else {
      meta[key] = value;
    }
  }
  return { meta, tags, body: raw.slice(end + 5).trim() };
}

function walk(dir: string, root: string, into: Chunk[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, root, into);
      continue;
    }
    if (!name.endsWith(".md")) continue;
    const raw = readFileSync(full, "utf8");
    const parsed = parseFrontMatter(raw);
    into.push({
      id: parsed.meta.id ?? name,
      path: relative(root, full).split("\\").join("/"),
      tags: parsed.tags,
      status: parsed.meta.status ?? "",
      text: parsed.body,
      score: 0,
    });
  }
}

export function loadPack(root: string): Chunk[] {
  const chunks: Chunk[] = [];
  walk(root, root, chunks);
  chunks.sort((a, b) => a.path.localeCompare(b.path));
  return chunks;
}

export function scoreChunk(chunk: Chunk, nouns: string[]): number {
  const wanted = new Set(nouns.map((noun) => noun.toLowerCase()));
  let score = 0;
  for (const tag of chunk.tags) {
    if (wanted.has(tag.toLowerCase())) score += 2;
  }
  if (chunk.id && wanted.has(chunk.id.toLowerCase())) score += 2;
  return score;
}

/** Tag overlap only. Returns at most `limit` chunks, highest score first, path as the tie break. */
export function retrieve(chunks: Chunk[], nouns: string[], limit = 6): Chunk[] {
  return chunks
    .map((chunk) => ({ ...chunk, score: scoreChunk(chunk, nouns) }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
}

export function citationPaths(chunks: Chunk[]): Set<string> {
  return new Set(chunks.map((chunk) => `pack/${chunk.path}`));
}
