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

/** The factory, its gates, and the tooling that runs them. The implementer never writes here. */
export const PROTECTED_ROOTS = [
  "packages/factory",
  "packages/orchestrator",
  "packages/implementer",
  "packages/harness",
  "scripts",
  "tools",
] as const;

function namesProtectedRoot(path: string): boolean {
  return PROTECTED_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

export function isForbiddenPath(file: string): boolean {
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
  return (
    namesProtectedRoot(normalized) ||
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

const FENCE_PROBES = [...PROTECTED_ROOTS.map((root) => `${root}/src/index.ts`), ".env"];

/**
 * A pattern is illegal when it is a secret path, names a protected root, or matches those probes.
 * A product glob such as packages/rcm/** stays legal; the diff check still rejects secret files inside it.
 */
export function fencePatternIssues(fence: string[]): string[] {
  const issues: string[] = [];
  for (const pattern of fence) {
    const admitsProbe = FENCE_PROBES.some((probe) => matchGlob(probe, pattern));
    if (isForbiddenPath(pattern) || admitsProbe) issues.push(`fence-admits:${pattern}`);
  }
  return issues;
}
