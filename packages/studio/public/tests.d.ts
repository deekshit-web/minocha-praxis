export interface TestResult {
  name: string;
  pass: boolean;
  message: string | null;
  ms: number;
}
export const LIVE_TESTS: string[];
export function runTests(id: string, version?: "first" | "fixed", suite?: "acceptance" | "unit"): TestResult[];
export function report(results: TestResult[]): string;
export function sourceOf(id: string, version?: "first" | "fixed"): string;
export function fixDiff(id: string): string;
export interface MutantResult {
  operator: string;
  line: string;
  killed: boolean;
  by: string | null;
}
export function mutationTest(id: string): { total: number; killed: number; results: MutantResult[] };
