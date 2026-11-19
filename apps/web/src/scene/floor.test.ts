import { describe, expect, it } from "vitest";
import { HALF, LANES, ROOM, WANDER, floorSpot, laneOf, viewOf } from "./floor";

// the room's box on the phone the e2e tests use (390 wide) and on a desktop; a phone crops the sides (A69)
const PHONE = viewOf(355, 560);
const DESKTOP = viewOf(580, 560);

describe("where a visiting pet stands (A69)", () => {
  it("a phone shows only the middle of the room, a desktop nearly all of it, a box of whole pixels all of it", () => {
    expect(PHONE.left).toBeGreaterThan(20);
    expect(PHONE.right).toBeLessThan(108);
    expect(DESKTOP.left).toBeLessThanOrEqual(6);
    expect(DESKTOP.right).toBeGreaterThanOrEqual(ROOM - 6);
    expect(viewOf(512, 512)).toEqual({ left: 0, right: ROOM });
  });

  it("keeps a pet's whole body inside what shows, at every lane and both ends of its wandering, for every stage", () => {
    for (const view of [PHONE, DESKTOP, viewOf(320, 480), viewOf(355, 700)])
      for (const half of Object.values(HALF))
        for (const lane of [...LANES, WANDER.min, WANDER.max]) {
          const x = floorSpot(lane, view, half);
          expect(x - half, `lane ${lane}, half ${half}, view ${view.left}..${view.right}`).toBeGreaterThanOrEqual(view.left);
          expect(x + half).toBeLessThanOrEqual(view.right);
        }
  });

  it("keeps the lanes in their order and apart on a phone", () => {
    const xs = [...LANES].sort((a, b) => a - b).map((lane) => floorSpot(lane, PHONE, HALF.adult));
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
  });

  it("leaves a room that shows whole as it was, and moves a desktop's lanes only a few pixels", () => {
    for (const lane of LANES) expect(floorSpot(lane, { left: 0, right: ROOM }, HALF.adult)).toBe(lane);
    // moved at most by the crop (6 room pixels a side here)
    for (const lane of LANES) expect(Math.abs(floorSpot(lane, DESKTOP, HALF.adult) - lane)).toBeLessThanOrEqual(DESKTOP.left);
  });

  it("stands a pet in the middle when what shows is narrower than its body", () => {
    const narrow = { left: 50, right: 80 };
    expect(floorSpot(18, narrow, HALF.adult)).toBe(65);
  });

  it("gives every visitor one of the eight lanes, the same one each time", () => {
    for (const id of ["p-1", "p-2", "0x20a0", "kin:1700000000000"]) {
      expect(LANES).toContain(laneOf(id));
      expect(laneOf(id)).toBe(laneOf(id));
    }
  });
});
