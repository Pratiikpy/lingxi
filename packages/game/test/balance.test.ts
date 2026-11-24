/**
 * The balance targets as permanent tests (plan row G0): the 90-day simulator runs once, through the game's own rules,
 * and every target recorded as met in balanceMeasured.generated.ts must still hold. Open targets are listed by the
 * row that owns them, so the suite shows what is still to be made true; when a row meets one, `sim90.ts --write`
 * records it and from then on it is guarded here.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { BALANCE_MEASURED, BALANCE_TARGETS, type SimNumbers, balanceTargets } from "../src";
import { playType } from "../scripts/sim90/players";
import { DEFAULT_DAYS, DEFAULT_SEED, runSimYielding } from "../scripts/sim90/run";
import { slow } from "./slow";

let n: SimNumbers;
// the whole 90 days for all five players, the spar field and the lesson watch: about 40 seconds on one core
beforeAll(async () => {
  n = await runSimYielding({ seed: DEFAULT_SEED, days: DEFAULT_DAYS });
}, slow(480_000));

describe("the balance targets (38-PLAN-GAME-DESIGN.md section 2)", () => {
  for (const t of balanceTargets()) {
    const name = `${t.owner} ${t.id}: ${t.target}`;
    if (t.status === "met") it(name, () => expect(t.met(n), t.value(n)).toBe(true));
    else it.todo(`${name} (open, owned by ${t.owner})`);
  }

  it("records each target as the simulator measures it now: a target met by a change is recorded met, and so guarded", () => {
    const drift = BALANCE_TARGETS.filter((t) => BALANCE_MEASURED.targets[t.id]?.status !== (t.met(n) ? "met" : "open")).map((t) => `${t.id} is now ${t.met(n) ? "met" : "open"}`);
    expect(drift, "run `pnpm --filter @lingxi/game exec tsx scripts/sim90.ts --write`").toEqual([]);
  });

  it("records every target, from this seed and length", () => {
    expect(BALANCE_MEASURED.seed).toBe(DEFAULT_SEED);
    expect(BALANCE_MEASURED.days).toBe(DEFAULT_DAYS);
    expect(Object.keys(BALANCE_MEASURED.targets).sort()).toEqual(BALANCE_TARGETS.map((t) => t.id).sort());
  });
});

describe("level-not-by-tapping tries every tapping path (B8)", () => {
  const target = BALANCE_TARGETS.find((t) => t.id === "level-not-by-tapping")!;
  it("measures each path, and fails when any one of them levels too fast", () => {
    expect(Object.keys(n.tapPaths ?? {}).sort()).toEqual(["clean", "feed", "petTalk", "play3"]);
    expect(target.met(n)).toBe(true);
    const fast = { ...n, tapPaths: { ...n.tapPaths, feed: { level99Day: null, day30Level: 999 } } };
    expect(target.met(fast), "one path far ahead of the three-visit player").toBe(false);
    const ninetyNine = { ...n, tapPaths: { ...n.tapPaths, play3: { level99Day: 80, day30Level: 1 } } };
    expect(target.met(ninetyNine), "one path reaching level 99").toBe(false);
  });
});

describe("the simulator", () => {
  it("is deterministic from its seed", () => {
    expect(playType("three", 7, 3)).toEqual(playType("three", 7, 3));
  });

  it("plays every day of every player type", () => {
    for (const p of Object.values(n.players)) expect(p.days.map((d) => d.day)).toEqual(Array.from({ length: DEFAULT_DAYS }, (_, i) => i + 1));
  });
});
