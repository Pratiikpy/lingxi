/**
 * The claims checker checks what each row claims (A56), held by tests now (A87): a test row runs its test and fails
 * when the test does, not when the file merely exists; a judge row passes only on the step it names, and a judge run
 * that stopped fails every judge row.
 */
import { describe, expect, it } from "vitest";
import { type RunDeps, judgeVerdict, runTest } from "./lib/claimsRun.mts";

const deps = (over: Partial<RunDeps> = {}): RunDeps => ({
  root: "/repo",
  exists: () => true,
  read: () => "",
  spawn: () => ({ status: 0, stdout: "Tests  3 passed (3)" }),
  hasPackage: (dir) => dir === "/repo/apps/web",
  ...over,
});

describe("a test row runs its test (A56)", () => {
  it("fails when the test fails, though the file exists", () => {
    const failing = deps({ spawn: () => ({ status: 1, stdout: "Tests  1 failed | 2 passed (3)" }) });
    expect(runTest("apps/web/src/game/x.test.ts", failing)).toEqual({ ok: false, why: "Tests  1 failed | 2 passed (3)" });
  });

  it("passes when the test passes, run in the package that owns it", () => {
    let ranIn = "";
    const passing = deps({ spawn: (_cmd, _args, cwd) => ((ranIn = cwd), { status: 0, stdout: "Tests  3 passed (3)" }) });
    expect(runTest("apps/web/src/game/x.test.ts", passing)).toEqual({ ok: true, why: "Tests  3 passed (3)" });
    expect(ranIn).toBe("/repo/apps/web");
  });

  it("fails a row whose test file is not there", () => {
    expect(runTest("apps/web/src/game/gone.test.ts", deps({ exists: () => false }))).toEqual({ ok: false, why: "does not exist" });
  });
});

describe("a judge row passes only on its own step (A56)", () => {
  const steps = [
    { ok: true, what: "pet #1's saved memory replays" },
    { ok: false, what: "holder gift snapshot block" },
  ];
  it("passes on its named step, fails on a failed one, and fails when no step names it", () => {
    expect(judgeVerdict(steps, "pet #1").ok).toBe(true);
    expect(judgeVerdict(steps, "holder gift").ok).toBe(false);
    expect(judgeVerdict(steps, "nothing like this").ok).toBe(false);
    expect(judgeVerdict(steps, "").ok, "a judge row must name its step").toBe(false);
  });

  it("fails every row when the judge run stopped, however its own step went", () => {
    const stopped = [...steps, { ok: false, what: "judge-check stopped: socket hang up (every step)" }];
    expect(judgeVerdict(stopped, "pet #1").ok).toBe(false);
  });
});
