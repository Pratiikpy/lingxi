import { describe, expect, it } from "vitest";
import { DECOR, MAX_PLACED, buyDecor, decorOf, newWorld, placeDecor, removeDecor } from "../src/index";

const rich = () => ({ ...newWorld("seed"), coins: 5000 });

describe("decorating the home", () => {
  it("buying spends coins once; it can't be bought twice or without the coins", () => {
    const w = rich();
    const r = buyDecor(w, "fern");
    expect(r.ok && r.world.coins).toBe(5000 - 40);
    expect(r.ok && buyDecor(r.world, "fern")).toEqual({ ok: false, reason: "owned" });
    expect(buyDecor({ ...w, coins: 10 }, "globe")).toEqual({ ok: false, reason: "coins" });
    expect(buyDecor(w, "nope")).toEqual({ ok: false, reason: "notSold" });
  });

  it("places owned pieces inside the room, moves a placed piece, removes it, and caps the count", () => {
    let w = rich();
    for (const d of DECOR) w = (buyDecor(w, d.id) as { world: typeof w }).world;
    expect(placeDecor(newWorld("s"), "fern", 10, 10)).toEqual({ ok: false, reason: "notOwned" });
    w = (placeDecor(w, "fern", -50, 500) as { world: typeof w }).world;
    expect(decorOf(w).placed).toEqual([{ id: "fern", x: 6, y: 124 }]);
    w = (placeDecor(w, "fern", 60, 100) as { world: typeof w }).world;
    expect(decorOf(w).placed).toEqual([{ id: "fern", x: 60, y: 100 }]);
    w = (removeDecor(w, "fern") as { world: typeof w }).world;
    expect(decorOf(w).placed).toHaveLength(0);
    for (const d of DECOR.slice(0, MAX_PLACED)) w = (placeDecor(w, d.id, 50, 100) as { world: typeof w }).world;
    expect(decorOf(w).placed).toHaveLength(Math.min(MAX_PLACED, DECOR.length));
  });

  it("every piece is drawn with known colours and a fair price", () => {
    for (const d of DECOR) {
      for (const row of d.rows) for (const ch of row) if (ch !== ".") expect(d.colors[ch], `${d.id} ${ch}`).toBeTruthy();
      expect(d.price).toBeGreaterThan(0);
      expect(d.name.en && d.name.zh).toBeTruthy();
    }
  });
});
