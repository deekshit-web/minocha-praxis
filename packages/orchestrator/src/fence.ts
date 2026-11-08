function globToRegExp(pattern: string): RegExp {
  let source = "^";
  let index = 0;
  while (index < pattern.length) {
    if (pattern.startsWith("**/", index)) {
      source += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (pattern.startsWith("**", index)) {
      source += ".*";
      index += 2;
      continue;
    }
    const char = pattern[index]!;
    if (char === "*") {
      source += "[^/]*";
      index += 1;
      continue;
    }
    source += /[\\^$+?.()|{}[\]]/.test(char) ? `\\${char}` : char;
    index += 1;
  }
  return new RegExp(`${source}$`);
}

export function matchGlob(file: string, pattern: string): boolean {
  return globToRegExp(pattern).test(file);
}

export function isForbiddenPath(file: string): boolean {
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
  return (
    normalized === "apps/factory" ||
    normalized.startsWith("apps/factory/") ||
    normalized === ".env" ||
    normalized.includes("/.env") ||
    normalized.startsWith(".env") ||
    normalized.includes("/secrets/") ||
    normalized.startsWith("secrets/")
  );
}

export interface FenceViolation {
  file: string;
  reason: "forbidden" | "outside";
}

export function fenceViolations(files: string[], fence: string[]): FenceViolation[] {
  const violations: FenceViolation[] = [];
  for (const file of files) {
    if (isForbiddenPath(file)) {
      violations.push({ file, reason: "forbidden" });
      continue;
    }
    if (!fence.some((pattern) => matchGlob(file, pattern))) violations.push({ file, reason: "outside" });
  }
  return violations;
}

const FENCE_PROBES = ["apps/factory/src/page.tsx", ".env"];

/**
 * A pattern is illegal when it is a secret path, names the factory app, or matches those probes.
 * A product glob such as apps/rcm/** stays legal; the diff check still rejects secret files inside it.
 */
export function fencePatternIssues(fence: string[]): string[] {
  const issues: string[] = [];
  for (const pattern of fence) {
    const namesFactory = pattern === "apps/factory" || pattern.startsWith("apps/factory/");
    const admitsProbe = FENCE_PROBES.some((probe) => matchGlob(probe, pattern));
    if (namesFactory || isForbiddenPath(pattern) || admitsProbe) issues.push(`fence-admits:${pattern}`);
  }
  return issues;
}
