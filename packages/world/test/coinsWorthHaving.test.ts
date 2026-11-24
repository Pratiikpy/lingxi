/**
 * G6: coins worth having. Spars cost no energy, so a pet watched fighting for an hour used to earn about 1,000 coins;
 * the day's paid spars are now capped and the rest are free practice.
 */
import { describe, expect, it } from "vitest";
import { PAID_SPARS_PER_DAY, type WorldState, newWorld, paidSparsLeft, paySpar } from "../src/world";

const DAY = 24 * 3_600_000;
const T0 = Date.UTC(2026, 10, 23, 3, 0);

describe("paid spars are capped per day (G6)", () => {
  it("pays the day's first paid spars, then none until the next day", () => {
    let w = newWorld("purse");
    const coins0 = w.coins;
    expect(paidSparsLeft(w, T0)).toBe(PAID_SPARS_PER_DAY);
    const paid: number[] = [];
    for (let i = 0; i < PAID_SPARS_PER_DAY + 2; i++) {
      const r = paySpar(w, T0 + i * 60_000, 30);
      paid.push(r.paid);
      w = r.world;
    }
    expect(paid).toEqual([...Array(PAID_SPARS_PER_DAY).fill(30), 0, 0]);
    expect(w.coins - coins0).toBe(30 * PAID_SPARS_PER_DAY);
    expect(paidSparsLeft(w, T0 + 3_600_000)).toBe(0);
    expect(paidSparsLeft(w, T0 + DAY)).toBe(PAID_SPARS_PER_DAY);
    const next = paySpar(w, T0 + DAY, 5);
    expect(next.paid).toBe(5);
  });

  it("resets on the player's own day, not at UTC midnight (D10)", () => {
    // a UTC+8 player: 07:00 and 09:00 local are one day, though UTC midnight (08:00 local) falls between them
    let w: WorldState = { ...newWorld("purse"), tz: 480 };
    const at7 = Date.UTC(2026, 10, 23, 23, 0); // 24 Nov 07:00 in UTC+8
    const at9 = Date.UTC(2026, 10, 24, 1, 0); // 24 Nov 09:00 in UTC+8
    for (let i = 0; i < PAID_SPARS_PER_DAY; i++) w = paySpar(w, at7 + i * 60_000, 30).world;
    expect(paidSparsLeft(w, at9)).toBe(0);
    expect(paySpar(w, at9, 30).paid).toBe(0);
    // its own midnight (16:00 UTC) brings the next three
    expect(paidSparsLeft(w, Date.UTC(2026, 10, 24, 16, 0))).toBe(PAID_SPARS_PER_DAY);
    // and a UTC-5 player's day ends at 05:00 UTC
    let v: WorldState = { ...newWorld("purse"), tz: -300 };
    for (let i = 0; i < PAID_SPARS_PER_DAY; i++) v = paySpar(v, Date.UTC(2026, 10, 24, 3, i), 30).world;
    expect(paidSparsLeft(v, Date.UTC(2026, 10, 24, 4, 59))).toBe(0);
    expect(paidSparsLeft(v, Date.UTC(2026, 10, 24, 5, 0))).toBe(PAID_SPARS_PER_DAY);
  });

  it("a spar that pays nothing does not use up a paid spar", () => {
    const w = newWorld("purse");
    const r = paySpar(w, T0, 0);
    expect(r.world).toBe(w);
    expect(paidSparsLeft(r.world, T0)).toBe(PAID_SPARS_PER_DAY);
  });
});

describe("no recipe or trust branch is strictly worse than its alternative (G6)", () => {
  it("every building material has a small batch, and a bulk batch beats it per piece", async () => {
    const { RECIPES, BULK_YIELD } = await import("../src/world");
    for (const out of [1301, 1302, 1303]) {
      const small = RECIPES.filter((r) => r.out === out && r.index >= 30001);
      const bulk = RECIPES.filter((r) => r.out === out && r.ins.some((x) => x.amount === 100));
      expect(small.length, `small batches for ${out}`).toBeGreaterThanOrEqual(2);
      expect(bulk.length).toBeGreaterThanOrEqual(2);
      for (const b of bulk) {
        expect(b.outAmount).toBe(BULK_YIELD);
        const per = b.ins[0]!.amount / b.outAmount;
        for (const s of small) expect(per, b.name.en).toBeLessThan(s.ins[0]!.amount / s.outAmount);
      }
    }
  });

  it("finds nothing strictly worse: no dominated recipe, none dearer than the shop, no branch worse than its shelf", async () => {
    const { worthFindings } = await import("../src");
    expect(worthFindings()).toEqual([]);
  });

  it("Wick's recipe branch hands over two Glow Roots, enough for twelve tonics", async () => {
    const { FRIEND_BY_ID } = await import("../src");
    const { takeStep } = await import("../src");
    const wick = FRIEND_BY_ID.wick!;
    const step = wick.steps.find((s) => s.unlock.kind === "recipe")!;
    // a friend of long standing who has taken every step before this one
    const before = wick.steps.filter((s) => s.level < step.level).map((s) => s.id);
    const w0 = {
      ...newWorld("wick"),
      trust: { wick: 100 },
      friends: { steps: { wick: before }, gifted: {}, known: {}, visits: [] },
    };
    const r = takeStep(w0, wick, step.id);
    if (!r.ok) throw new Error(r.reason);
    expect(r.world.bag[1021]).toBe(2);
  });
});

describe("long-lived things to save for at every stage (G6)", () => {
  it("the Builder's commissions: one or more per stage from child to elder, never on the shelf, made for coins and materials", async () => {
    const { COMMISSIONS, buyDecor, commissionDecor } = await import("../src");
    const stages = new Set(COMMISSIONS.map((d) => d.commission!.stage));
    expect([...stages].sort()).toEqual(["adult", "child", "elder", "teen"]);
    const bench = COMMISSIONS.find((d) => d.id === "bench")!;
    const rich = { ...newWorld("builder"), coins: 5000, bag: { 1302: 10 } };
    expect(buyDecor(rich, "bench")).toEqual({ ok: false, reason: "notSold" });
    expect(commissionDecor(rich, "bench", "baby")).toEqual({ ok: false, reason: "stage" });
    expect(commissionDecor({ ...rich, bag: {} }, "bench", "child")).toEqual({ ok: false, reason: "missing" });
    expect(commissionDecor({ ...rich, coins: 10 }, "bench", "child")).toEqual({ ok: false, reason: "coins" });
    const r = commissionDecor(rich, "bench", "adult");
    if (!r.ok) throw new Error(r.reason);
    expect(r.world.coins).toBe(5000 - bench.price);
    expect(r.world.bag[1302]).toBe(10 - 4);
    expect(r.world.decor!.owned).toContain("bench");
    expect(commissionDecor(r.world, "bench", "adult")).toEqual({ ok: false, reason: "owned" });
  });

  it("extra garden plots are dug for coins, one stage at a time, and can be planted", async () => {
    const { GARDEN_ROOM, MAX_PLOTS, PLOTS, PLOT_SALE, digPlot, gardenOf, plant, plotCount } = await import("../src");
    let w: WorldState = { ...newWorld("dig"), room: GARDEN_ROOM, coins: 2000, bag: { 7104: 1 } };
    expect(plotCount(w)).toBe(PLOTS);
    expect(digPlot(w, "baby")).toEqual({ ok: false, reason: "stage" });
    const spent: number[] = [];
    for (const sale of PLOT_SALE) {
      const r = digPlot(w, sale.stage);
      if (!r.ok) throw new Error(r.reason);
      spent.push(w.coins - r.world.coins);
      w = r.world;
    }
    expect(spent).toEqual(PLOT_SALE.map((s) => s.price));
    expect(plotCount(w)).toBe(MAX_PLOTS);
    expect(gardenOf(w)).toHaveLength(MAX_PLOTS);
    expect(digPlot(w, "elder")).toEqual({ ok: false, reason: "allDug" });
    const planted = plant(w, MAX_PLOTS - 1, "clover", false, T0);
    expect(planted.ok).toBe(true);
  });
});
