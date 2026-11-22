import { describe, expect, it } from "vitest";
import { CHAIN_DECOR, DECOR, DECOR_BY_ID, GOALS, type WorldState, buyDecor, newWorld, placeDecor, syncChainDecor } from "../src";

const w0 = (): WorldState => ({ ...newWorld("d"), coins: 10_000 });

describe("on-chain decorations (plan 4.6)", () => {
  it("draws eight pieces: four for the shop, one keepsake for each community goal", () => {
    expect(CHAIN_DECOR.filter((p) => p.chain?.kind === "shop")).toHaveLength(4);
    const keepsakes = CHAIN_DECOR.filter((p) => p.chain?.kind === "keepsake").map((p) => (p.chain as { goal: string }).goal);
    // one for each goal of the first round; the monthly rounds after it (G4) pay coins and things for the bag
    expect(keepsakes.sort()).toEqual(GOALS.filter((g) => !g.id.includes("-")).map((g) => g.id).sort());
    for (const p of CHAIN_DECOR) {
      expect(DECOR.some((d) => d.id === p.id), p.id).toBe(false);
      expect(DECOR_BY_ID[p.id]).toBe(p);
      expect(p.name.en.length * p.name.zh.length).toBeGreaterThan(0);
      for (const row of p.rows) for (const ch of row) if (ch !== ".") expect(p.colors[ch], `${p.id} colour ${ch}`).toBeDefined();
      expect(Math.max(...p.rows.map((r) => r.length))).toBeLessThanOrEqual(16);
    }
  });

  it("cannot be bought with coins, and cannot be placed until a wallet holds it", () => {
    const w = w0();
    expect(buyDecor(w, "star-lamp")).toEqual({ ok: false, reason: "notSold" });
    expect(placeDecor(w, "star-lamp", 40, 60)).toEqual({ ok: false, reason: "notOwned" });
    const held = syncChainDecor(w, ["star-lamp", "goal-saves"]);
    expect(held.decor?.chainHeld).toEqual(["goal-saves", "star-lamp"]);
    const placed = placeDecor(held, "star-lamp", 40, 60);
    expect(placed.ok).toBe(true);
  });

  it("a piece sold or sent away leaves the home on the next reading; game pieces are untouched", () => {
    let w = w0();
    const bought = buyDecor(w, "fern");
    if (!bought.ok) throw new Error(bought.reason);
    w = syncChainDecor(bought.world, ["star-lamp"]);
    for (const [id, x] of [["fern", 30], ["star-lamp", 60]] as const) {
      const r = placeDecor(w, id, x, 60);
      if (!r.ok) throw new Error(r.reason);
      w = r.world;
    }
    const gone = syncChainDecor(w, []);
    expect(gone.decor?.placed.map((p) => p.id)).toEqual(["fern"]);
    expect(gone.decor?.owned).toEqual(["fern"]);
    // a list naming game pieces or unknown ids takes only the on-chain ones
    expect(syncChainDecor(w, ["fern", "nope", "moon-window"]).decor?.chainHeld).toEqual(["moon-window"]);
    // the same reading twice changes nothing
    expect(syncChainDecor(gone, [])).toBe(gone);
  });
});
