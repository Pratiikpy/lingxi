import { describe, expect, it } from "vitest";
import {
  COMPOST,
  CROPS,
  GARDEN_ROOM,
  ITEM,
  PLOTS,
  buy,
  compostFromClean,
  gardenOf,
  harvest,
  newWorld,
  plant,
  plotStage,
} from "../src";

const H = 3_600_000;
const inGarden = (bag: Record<number, number> = {}) => ({
  ...newWorld("seed0001seed0001"),
  room: GARDEN_ROOM,
  bag,
  coins: 200,
});

describe("the garden", () => {
  it("every crop, seed and compost has a name, a picture and a price where it is sold", () => {
    for (const c of CROPS) {
      expect(ITEM[c.seed]?.art).toMatch(/\.png$/);
      expect(ITEM[c.seed]?.price).toBeGreaterThan(0);
      expect(ITEM[c.yields]?.use?.diet).toBeTruthy();
    }
    expect(ITEM[COMPOST]?.name.zh).toBe("堆肥");
  });

  it("seeds are bought at the market", () => {
    const w = { ...newWorld("seed0001seed0001"), room: 13, coins: 50 };
    const r = buy(w, 7102);
    expect(r.ok && r.world.bag[7102]).toBe(1);
  });

  it("plants only in the garden, in a free plot, with a seed in the bag", () => {
    const w = inGarden({ 7102: 1 });
    expect(plant({ ...w, room: 65 }, 0, "rice", false, 0)).toEqual({ ok: false, reason: "notHere" });
    expect(plant(w, PLOTS, "rice", false, 0)).toEqual({ ok: false, reason: "noPlot" });
    expect(plant(w, 0, "apple", false, 0)).toEqual({ ok: false, reason: "noSeed" });
    expect(plant(w, 0, "rice", true, 0)).toEqual({ ok: false, reason: "noCompost" });
    const r = plant(w, 0, "rice", false, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.world.bag[7102]).toBeUndefined();
    expect(plant({ ...r.world, bag: { 7102: 1 } }, 0, "rice", false, 0)).toEqual({ ok: false, reason: "taken" });
  });

  it("grows on the clock: sprout, leafy, ripe; harvest only when ripe, then the plot is free", () => {
    const r = plant(inGarden({ 7102: 1 }), 1, "rice", false, 0);
    if (!r.ok) throw new Error();
    const p = gardenOf(r.world)[1];
    expect(plotStage(p!, 1 * H).stage).toBe(1);
    expect(plotStage(p!, 3 * H).stage).toBe(2);
    expect(plotStage(p!, 6 * H).stage).toBe(3);
    expect(harvest(r.world, 1, 5 * H)).toEqual({ ok: false, reason: "notRipe" });
    const h = harvest(r.world, 1, 6 * H);
    expect(h.ok && [h.item, h.n]).toEqual([7201, 3]);
    if (h.ok) expect(gardenOf(h.world)[1]).toBeNull();
    expect(harvest(r.world, 2, 6 * H)).toEqual({ ok: false, reason: "empty" });
  });

  it("compost halves the wait and adds one to the harvest", () => {
    const r = plant(inGarden({ 7101: 1, [COMPOST]: 1 }), 0, "apple", true, 0);
    if (!r.ok) throw new Error();
    expect(r.world.bag[COMPOST]).toBeUndefined();
    expect(plotStage(gardenOf(r.world)[0]!, 4 * H).stage).toBe(3);
    const h = harvest(r.world, 0, 4 * H);
    expect(h.ok && h.n).toBe(3);
  });

  it("cleaning a messy pet makes compost; a clean one does not", () => {
    const w = newWorld("seed0001seed0001");
    expect(compostFromClean(w, 300).world.bag[COMPOST]).toBe(1);
    expect(compostFromClean(w, 800).made).toBe(false);
  });
});
