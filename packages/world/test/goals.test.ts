import { describe, expect, it } from "vitest";
import {
  GOALS,
  type GoalDef,
  canClaimEveryone,
  claimGoalEveryone,
  claimGoalTiers,
  claimableTiers,
  goalErrors,
  goalProgress,
  goalState,
  goalsDoneOf,
  newWorld,
  nextTier,
  tierAt,
  tiersReached,
} from "../src";

const goal: GoalDef = {
  ...GOALS[0]!,
  id: "g9",
  target: 10,
  start: 1_000,
  end: 2_000,
  tiers: { 25: [{ kind: "coins", n: 1 }], 50: [{ kind: "coins", n: 2 }], 75: [{ kind: "coins", n: 4 }], 100: [{ kind: "item", item: 1103, n: 1 }] },
  everyone: { text: { en: "for all", zh: "给大家" }, rewards: [{ kind: "item", item: 11004, n: 1 }] },
};
const fresh = () => newWorld("goals");

describe("community goals", () => {
  it("rounds each tier up, so a quarter of 10 needs 3", () => {
    expect([25, 50, 75, 100].map((p) => tierAt(goal, p as 25))).toEqual([3, 5, 8, 10]);
    expect(tiersReached(goal, 2)).toEqual([]);
    expect(tiersReached(goal, 3)).toEqual([25]);
    expect(tiersReached(goal, 8)).toEqual([25, 50, 75]);
    expect(nextTier(goal, 8)).toBe(100);
    expect(nextTier(goal, 10)).toBeNull();
  });

  it("stops progress at the target, as the source caps the pot", () => {
    expect(goalProgress(goal, 25)).toBe(1);
    expect(goalProgress(goal, -3)).toBe(0);
    expect(tiersReached(goal, 25)).toEqual([25, 50, 75, 100]);
  });

  it("has a window and a deadline (the source's goals had neither)", () => {
    expect(goalState(goal, 0, 999)).toBe("upcoming");
    expect(goalState(goal, 4, 1_500)).toBe("open");
    expect(goalState(goal, 4, 2_000)).toBe("ended");
    expect(goalState(goal, 10, 1_500)).toBe("complete");
    expect(goalState(goal, 10, 5_000)).toBe("complete");
  });

  it("pays a goal that ended short for the tiers it reached", () => {
    const r = claimGoalTiers(fresh(), goal, { total: 6, mine: 1 });
    expect(r.ok && r.tiers).toEqual([25, 50]);
    expect(r.ok && r.world.coins - fresh().coins).toBe(3);
  });

  it("stacks tiers: reaching 75% pays 25, 50 and 75 at once, and each only once", () => {
    const w0 = fresh();
    const r = claimGoalTiers(w0, goal, { total: 8, mine: 2 });
    if (!r.ok) throw new Error(r.reason);
    expect(r.tiers).toEqual([25, 50, 75]);
    expect(r.world.coins - w0.coins).toBe(7);
    expect(claimGoalTiers(r.world, goal, { total: 8, mine: 2 })).toEqual({ ok: false, reason: "claimed" });
    // the last tier, reached later, is paid on its own
    const r2 = claimGoalTiers(r.world, goal, { total: 10, mine: 2 });
    expect(r2.ok && r2.tiers).toEqual([100]);
    expect(r2.ok && r2.world.bag[1103]).toBe((w0.bag[1103] ?? 0) + 1);
  });

  it("pays a fixed amount, not one multiplied by what the player gave", () => {
    const small = claimGoalTiers(fresh(), goal, { total: 10, mine: 1 });
    const big = claimGoalTiers(fresh(), goal, { total: 10, mine: 9 });
    expect(small.ok && big.ok && small.world.coins).toBe(big.ok ? big.world.coins : -1);
  });

  it("never pays a tier to someone who gave nothing (the source let a 0 contribution claim)", () => {
    expect(claimableTiers(fresh(), goal, { total: 10, mine: 0 })).toEqual([]);
    expect(claimGoalTiers(fresh(), goal, { total: 10, mine: 0 })).toEqual({ ok: false, reason: "notContributed" });
    expect(claimGoalTiers(fresh(), goal, { total: 1, mine: 1 })).toEqual({ ok: false, reason: "noTier" });
  });

  it("gives everyone their reward once the goal is complete, with or without a wallet", () => {
    expect(canClaimEveryone(fresh(), goal, { total: 9, mine: 0 })).toBe(false);
    expect(claimGoalEveryone(fresh(), goal, { total: 9, mine: 0 })).toEqual({ ok: false, reason: "notComplete" });
    const r = claimGoalEveryone(fresh(), goal, { total: 10, mine: 0 });
    if (!r.ok) throw new Error(r.reason);
    expect(r.world.bag[11004]).toBe((fresh().bag[11004] ?? 0) + 1);
    expect(canClaimEveryone(r.world, goal, { total: 10, mine: 0 })).toBe(false);
    expect(claimGoalEveryone(r.world, goal, { total: 10, mine: 0 })).toEqual({ ok: false, reason: "claimed" });
  });

  it("names the goals that are complete, for the GOAL_DONE condition", () => {
    expect(goalsDoneOf(GOALS, { g1: 150, g2: 39 })).toEqual(["g1"]);
  });

  it("keeps the shipped goals honest", () => {
    expect(goalErrors(GOALS)).toEqual([]);
    expect(GOALS.map((g) => g.metric)).toEqual(["saves", "hatched", "children", "burned"]);
    // rewards are game things, never BEM: no reward kind carries a token
    for (const g of GOALS) for (const r of [...Object.values(g.tiers).flat(), ...g.everyone.rewards]) expect(["coins", "item", "decor", "piece"]).toContain(r.kind);
  });

  it("refuses a goal with no deadline, a tier with nothing, a stranger for a giver, or a line that does not fit", () => {
    const bad: GoalDef = { ...goal, giver: "nobody", end: goal.start, target: 2, tiers: { ...goal.tiers, 50: [] }, story: [{ face: "x.png", en: "a".repeat(141), zh: "好" }] };
    const errs = goalErrors([bad, bad]).join("\n");
    for (const want of ["used twice", "no resident nobody", "start and a later deadline", "at least 4", "tier 50% gives nothing", "English is 141"]) expect(errs).toContain(want);
  });
});
