import { describe, expect, it } from "vitest";
import {
  FAILS_TO_ACT,
  QUIET_MS,
  SLOW_FAILS_TO_ACT,
  decide,
  describeBeat,
  initialWatch,
} from "../../../deploy/watchdog-rules.mjs";

const run = (beats: Array<[local: boolean | "slow", pub: boolean]>, start = 0, step = 60_000) => {
  let w = initialWatch();
  const actions: Array<string | null> = [];
  beats.forEach(([local, pub], i) => {
    const r = decide(w, { local, public: pub }, start + i * step);
    w = r.watch;
    actions.push(r.action);
  });
  return actions;
};

describe("the watchdog", () => {
  it("does nothing while both answer, and forgives a single missed beat", () => {
    expect(
      run([
        [true, true],
        [true, false],
        [true, true],
        [false, true],
        [true, true],
      ]),
    ).toEqual([null, null, null, null, null]);
  });

  it("restarts the tunnel when the server answers here but the site does not answer outside", () => {
    const beats: Array<[boolean, boolean]> = Array.from({ length: FAILS_TO_ACT }, () => [true, false]);
    expect(run(beats).at(-1)).toBe("restart-tunnel");
  });

  it("restarts the server when it stops answering even here (a hung process pm2 cannot see)", () => {
    const beats: Array<[boolean, boolean]> = Array.from({ length: FAILS_TO_ACT }, () => [false, false]);
    expect(run(beats).at(-1)).toBe("restart-server");
  });

  it("waits quietly after acting, so a slow start is not restarted again and again", () => {
    const n = FAILS_TO_ACT + Math.ceil(QUIET_MS / 60_000) - 1;
    const acts = run(Array.from({ length: n }, () => [true, false] as [boolean, boolean])).filter(Boolean);
    expect(acts).toEqual(["restart-tunnel"]);
    // once the quiet time is over and it is still down, it acts again
    const later = run(Array.from({ length: n + FAILS_TO_ACT + 1 }, () => [true, false] as [boolean, boolean])).filter(
      Boolean,
    );
    expect(later).toEqual(["restart-tunnel", "restart-tunnel"]);
  });

  // P3b: a server that answers slowly is alive; on a machine short of memory a restart takes minutes, so it is given
  // longer than one that refuses connections
  it("restarts a server that refuses connections after three beats, one that is only slow after six", () => {
    expect(SLOW_FAILS_TO_ACT).toBeGreaterThan(FAILS_TO_ACT);
    const slow = run(Array.from({ length: SLOW_FAILS_TO_ACT }, () => ["slow", false] as ["slow", boolean]));
    expect(slow.slice(0, SLOW_FAILS_TO_ACT - 1).filter(Boolean), "not before its time").toEqual([]);
    expect(slow.at(-1)).toBe("restart-server");
    const refused = run(Array.from({ length: FAILS_TO_ACT }, () => [false, false] as [boolean, boolean]));
    expect(refused.at(-1)).toBe("restart-server");
  });

  it("a slow streak that turns into refusals is acted on by the refusals' count, and an answer clears both", () => {
    const acts = run([
      ["slow", false],
      ["slow", false],
      [false, false],
    ]);
    expect(acts.at(-1), "three missed beats, not all of them merely slow").toBe("restart-server");
    expect(
      run([
        ["slow", false],
        ["slow", false],
        [true, true],
        ["slow", false],
        ["slow", false],
      ]).filter(Boolean),
    ).toEqual([]);
  });

  it("never restarts the tunnel while the server here is only slow", () => {
    expect(
      run(Array.from({ length: FAILS_TO_ACT + 1 }, () => ["slow", false] as ["slow", boolean])).filter(Boolean),
    ).toEqual([]);
  });

  it("says why a beat missed, for the log", () => {
    expect(describeBeat({ local: "refused", public: "530" })).toBe("here refused, outside 530");
    expect(describeBeat({ local: "ok", public: "timed out" })).toBe("here ok, outside timed out");
  });
});
