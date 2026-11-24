import { describe, expect, it } from "vitest";
import {
  DESTINATIONS,
  ITEM,
  MAX_WALK_FINDS,
  STEPS_PER_FIND,
  TRAVEL_RECIPES,
  WALKS_WITH_FINDS,
  WALK_MINUTES,
  craft,
  endTrip,
  endWalk,
  knownTravelRecipes,
  newWorld,
  startTrip,
  startWalk,
  stepWalk,
  tripBack,
  walkSteps,
  type WorldState,
} from "../src";

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 16, 9);
const w0 = (): WorldState => ({ ...newWorld("seedseedseedseed"), visited: [65, 1, 2, 3] });
const ok = <T>(r: ({ ok: true; world: WorldState } & T) | { ok: false; reason: string }) => {
  if (!r.ok) throw new Error(r.reason);
  return r;
};

describe("walks", () => {
  it("with a step sensor, every 400 steps turns up a find, capped at six", () => {
    const w = ok(startWalk(w0(), T0, true)).world;
    let r = ok(stepWalk(w, STEPS_PER_FIND - 1, T0 + 5 * MIN));
    expect(r.found).toHaveLength(0);
    r = ok(stepWalk(r.world, 1, T0 + 5 * MIN));
    expect(r.found.reduce((t, f) => t + f.n, 0)).toBe(1);
    r = ok(stepWalk(r.world, 99_999, T0 + WALK_MINUTES * MIN));
    expect(r.world.walk!.finds.reduce((t, f) => t + f.n, 0)).toBe(MAX_WALK_FINDS);
    for (const f of r.world.walk!.finds) expect(ITEM[f.item]).toBeTruthy();
  });

  it("a sensor cannot claim more than three steps a second", () => {
    const w = ok(startWalk(w0(), T0, true)).world;
    const r = ok(stepWalk(w, 50_000, T0 + 10_000));
    expect(r.world.walk!.steps).toBe(30);
  });

  it("without a sensor, minutes count instead, up to the walk's length", () => {
    const w = ok(startWalk(w0(), T0, false)).world;
    expect(walkSteps(w.walk!, T0 + 8 * MIN)).toBe(800);
    expect(walkSteps(w.walk!, T0 + 60 * MIN)).toBe(WALK_MINUTES * 100);
    const r = ok(stepWalk(w, 10_000, T0 + 8 * MIN));
    expect(r.world.walk!.steps).toBe(0);
    expect(r.world.walk!.finds.reduce((t, f) => t + f.n, 0)).toBe(2);
  });

  it("ending a walk puts the finds in the bag; finds are the same on a reload", () => {
    const a = ok(endWalk(ok(startWalk(w0(), T0, false)).world, T0 + WALK_MINUTES * MIN));
    const b = ok(endWalk(ok(startWalk(w0(), T0, false)).world, T0 + WALK_MINUTES * MIN));
    expect(a.finds).toEqual(b.finds);
    expect(a.minutes).toBe(WALK_MINUTES);
    for (const f of a.finds) expect(a.world.bag[f.item]).toBeGreaterThanOrEqual(f.n);
    expect(a.world.walk).toBeUndefined();
  });

  it("only the first two walks of a day bring finds", () => {
    let w = w0();
    for (let i = 0; i < WALKS_WITH_FINDS; i++)
      w = ok(endWalk(ok(startWalk(w, T0 + i * 30 * MIN, false)).world, T0 + i * 30 * MIN + WALK_MINUTES * MIN)).world;
    const third = ok(endWalk(ok(startWalk(w, T0 + 3 * 30 * MIN, false)).world, T0 + 3 * 30 * MIN + WALK_MINUTES * MIN));
    expect(third.finds).toHaveLength(0);
    const tomorrow = ok(
      endWalk(ok(startWalk(third.world, T0 + 86_400_000, false)).world, T0 + 86_400_000 + WALK_MINUTES * MIN),
    );
    expect(tomorrow.finds.length).toBeGreaterThan(0);
  });

  it("a walk ended at once does not use up one of the day's walks, and says why it found nothing", () => {
    let w = w0();
    const quick = ok(endWalk(ok(startWalk(w, T0, false)).world, T0 + MIN));
    expect(quick.finds).toHaveLength(0);
    expect(quick.capped).toBe(false);
    w = quick.world;
    for (let i = 0; i < WALKS_WITH_FINDS; i++) {
      const r = ok(
        endWalk(ok(startWalk(w, T0 + (i + 1) * 30 * MIN, false)).world, T0 + (i + 1) * 30 * MIN + WALK_MINUTES * MIN),
      );
      expect(r.finds.length).toBeGreaterThan(0);
      w = r.world;
    }
    expect(
      ok(endWalk(ok(startWalk(w, T0 + 5 * 30 * MIN, false)).world, T0 + 5 * 30 * MIN + WALK_MINUTES * MIN)).capped,
    ).toBe(true);
    expect(walkSteps({ startedAt: T0, steps: 0, sensor: false, finds: [] }, T0 - 5000)).toBe(0);
  });

  it("refuses a second walk, or a walk while the pet is away", () => {
    const w = ok(startWalk(w0(), T0, true)).world;
    expect(startWalk(w, T0, true)).toEqual({ ok: false, reason: "walking" });
    const away = ok(startTrip(w0(), "seaside", T0)).world;
    expect(startWalk(away, T0, true)).toEqual({ ok: false, reason: "travelling" });
  });
});

describe("trips", () => {
  it("the pet comes back after the trip's hours with three or four finds and a recipe the first time", () => {
    const d = DESTINATIONS[0]!;
    const w = ok(startTrip(w0(), d.id, T0)).world;
    expect(tripBack(w.trip!, T0 + d.hours * 3_600_000 - 1)).toBe(false);
    expect(endTrip(w, T0 + 60 * MIN)).toEqual({ ok: false, reason: "notBack" });
    const r = ok(endTrip(w, T0 + d.hours * 3_600_000));
    const n = r.found.reduce((t, f) => t + f.n, 0);
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(4);
    for (const f of r.found) expect(d.drops.map((x) => x.item)).toContain(f.item);
    expect(r.learned).toBe(d.teaches);
    expect(r.world.trip).toBeUndefined();
    const again = ok(
      endTrip(ok(startTrip(r.world, d.id, T0 + 86_400_000)).world, T0 + 86_400_000 + d.hours * 3_600_000),
    );
    expect(again.learned).toBeNull();
  });

  it("a travel recipe works at the workbench only once a trip has brought it home", () => {
    const recipe = TRAVEL_RECIPES[0]!;
    const stocked: WorldState = { ...w0(), bag: { 7201: 4, 11312: 2 } };
    expect(craft(stocked, recipe.index)).toEqual({ ok: false, reason: "noRecipe" });
    const learned: WorldState = { ...stocked, recipes: [recipe.index] };
    expect(knownTravelRecipes(learned).map((r) => r.index)).toEqual([recipe.index]);
    const made = ok(craft(learned, recipe.index));
    expect(made.world.bag[recipe.out]).toBe(recipe.outAmount);
  });

  it("every destination's finds and recipe exist", () => {
    for (const d of DESTINATIONS) {
      for (const x of d.drops) expect(ITEM[x.item]).toBeTruthy();
      expect(TRAVEL_RECIPES.find((r) => r.index === d.teaches)).toBeTruthy();
    }
    for (const r of TRAVEL_RECIPES) for (const x of [...r.ins, { item: r.out }]) expect(ITEM[x.item]).toBeTruthy();
  });
});
