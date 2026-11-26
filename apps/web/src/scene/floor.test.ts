import { describe, expect, it } from "vitest";
import {
  FLOOR_ROOM,
  HALF,
  LANES,
  PET_FEET,
  ROOM,
  STRIP_ROOM,
  WANDER,
  floorSpot,
  laneOf,
  roomOrigin,
  stripRoomFrom,
  viewOf,
} from "./floor";

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
          expect(x - half, `lane ${lane}, half ${half}, view ${view.left}..${view.right}`).toBeGreaterThanOrEqual(
            view.left,
          );
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
    for (const lane of LANES)
      expect(Math.abs(floorSpot(lane, DESKTOP, HALF.adult) - lane)).toBeLessThanOrEqual(DESKTOP.left);
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

describe("where the room draws itself in its box (roomOrigin)", () => {
  it("crops evenly when the box is tall enough for the pet to stand clear of the thinking strip", () => {
    const o = roomOrigin(355, 560);
    expect(o.scale).toBe(5);
    expect(o.x).toBe(Math.round((355 - ROOM * 5) / 2));
    expect(o.y).toBe(Math.round((560 - ROOM * 5) / 2));
  });

  it("lifts the room on a short phone box so the pet's feet stay above the strip", () => {
    // the box the failing phone test measured: 354 wide, 354 tall
    const o = roomOrigin(354, 354);
    expect(o.scale).toBe(3);
    expect(o.y).toBe(354 - STRIP_ROOM - PET_FEET * 3);
    expect(o.y).toBeLessThan(Math.round((354 - ROOM * 3) / 2));
    expect(o.y + PET_FEET * o.scale, "the feet end above the strip").toBeLessThanOrEqual(354 - STRIP_ROOM);
  });

  // R21: on a short phone held upright and on a phone turned sideways the strip lies beside the room, not over it, so
  // the room keeps only a little floor under the pet's feet, and the pet stands lower, clear of the room's top row
  it("keeps only a floor's margin under the pet when no strip lies over the room's foot", () => {
    // a 320 x 568 phone's room: 288 wide, 180 tall, the strip beside it
    const o = roomOrigin(288, 180, FLOOR_ROOM);
    expect(o.scale).toBe(3);
    expect(o.y + PET_FEET * o.scale, "the feet a floor's margin above the foot").toBe(180 - FLOOR_ROOM);
    expect(o.y + PET_FEET * o.scale, "lower than with a strip to clear").toBeGreaterThan(
      roomOrigin(288, 180).y + PET_FEET * 3,
    );
  });

  it("still crops evenly, with no strip, where the pet already stands clear of the foot", () => {
    // a landscape phone's room, 310 square: cropped evenly leaves the feet well above the foot
    const o = roomOrigin(310, 310, FLOOR_ROOM);
    expect(o.y).toBe(Math.round((310 - ROOM * 3) / 2));
    expect(o.y + PET_FEET * o.scale).toBeLessThanOrEqual(310 - FLOOR_ROOM);
  });

  it("leaves the room as it was when the strip is over its foot (the default)", () => {
    expect(roomOrigin(354, 354, STRIP_ROOM)).toEqual(roomOrigin(354, 354));
  });
});

describe("how much of the room's foot a strip takes, as the page says (stripRoomFrom)", () => {
  it("reads the room's --strip-room in pixels", () => {
    expect(stripRoomFrom("12px")).toBe(12);
    expect(stripRoomFrom(" 76px ")).toBe(76);
  });

  it("falls back to a strip's room when the page says nothing it can read", () => {
    for (const v of ["", "auto", "-4px", "NaNpx"]) expect(stripRoomFrom(v)).toBe(STRIP_ROOM);
  });
});
