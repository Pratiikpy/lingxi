/**
 * The README's counts come from vitest's JSON reports. A suite that fails is never counted, and the failure must name
 * the tests that failed: one chain fork test failed once on 2026-11-25, passed on its rerun, and the report that would
 * have named it had already been deleted.
 */
import { describe, expect, it } from "vitest";
import { failuresOf } from "./testReport.mts";

const report = {
  numPassedTests: 2,
  numFailedTests: 2,
  testResults: [
    {
      name: "/repo/packages/chain/test/fork.test.ts",
      assertionResults: [
        { fullName: "hatches a pet", status: "passed", failureMessages: [] },
        {
          fullName: "breeds two adults",
          status: "failed",
          failureMessages: ["Error: Test timed out in 120000ms.\n    at a stack line\n    at another"],
        },
      ],
    },
    {
      name: "C:\\repo\\packages\\chain\\test\\relay.test.ts",
      assertionResults: [
        { fullName: "relays a brain", status: "failed", failureMessages: ["AssertionError: expected 1 to be 2"] },
        { fullName: "skips on mainnet", status: "skipped", failureMessages: [] },
      ],
    },
  ],
};

describe("failuresOf (P7)", () => {
  it("names each failed test with its file and the first line of why", () => {
    expect(failuresOf(report)).toEqual([
      "fork.test.ts › breeds two adults: Error: Test timed out in 120000ms.",
      "relay.test.ts › relays a brain: AssertionError: expected 1 to be 2",
    ]);
  });

  it("is empty for a passing report, and for a report without per-test results", () => {
    expect(
      failuresOf({
        ...report,
        testResults: [report.testResults[0]!].map((f) => ({ ...f, assertionResults: [f.assertionResults[0]!] })),
      }),
    ).toEqual([]);
    expect(failuresOf({ numPassedTests: 3, numFailedTests: 0 })).toEqual([]);
  });

  it("a failure with no message is still named", () => {
    expect(
      failuresOf({ testResults: [{ name: "a/b.test.ts", assertionResults: [{ fullName: "x", status: "failed" }] }] }),
    ).toEqual(["b.test.ts › x: (no message)"]);
  });
});
