/**
 * Reading vitest's JSON report: which tests failed, by file and name, each with the first line of its failure, so a
 * suite that fails says which test and why before its report is cleared away.
 */

interface Assertion {
  fullName: string;
  status: string;
  failureMessages?: string[];
}

export interface TestReport {
  numPassedTests?: number;
  numFailedTests?: number;
  testResults?: Array<{ name: string; assertionResults?: Assertion[] }>;
}

export function failuresOf(report: TestReport): string[] {
  const out: string[] = [];
  for (const file of report.testResults ?? []) {
    const base = file.name.split(/[\\/]/).pop() ?? file.name;
    for (const a of file.assertionResults ?? []) {
      if (a.status !== "failed") continue;
      const why = (a.failureMessages ?? []).join("\n").split("\n")[0]?.trim() || "(no message)";
      out.push(`${base} › ${a.fullName}: ${why}`);
    }
  }
  return out;
}
