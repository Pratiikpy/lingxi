import { describe, expect, it } from "vitest";
import { FAILS_TO_ACT, QUIET_MS, decide, initialWatch } from "../../../deploy/watchdog-rules.mjs";

const run = (beats: Array<[local: boolean, pub: boolean]>, start = 0, step = 60_000) => {
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
    expect(run([[true, true], [true, false], [true, true], [false, true], [true, true]])).toEqual([null, null, null, null, null]);
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
    const later = run(Array.from({ length: n + FAILS_TO_ACT + 1 }, () => [true, false] as [boolean, boolean])).filter(Boolean);
    expect(later).toEqual(["restart-tunnel", "restart-tunnel"]);
  });
});
