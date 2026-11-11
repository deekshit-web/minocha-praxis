export interface TestResult {
  name: string;
  pass: boolean;
  message: string | null;
  ms: number;
}
export const LIVE_TESTS: string[];
export function runTests(id: string, version?: "first" | "fixed"): TestResult[];
export function report(results: TestResult[]): string;
