/**
 * P7: where the pet and a resident stand, out of RoomScene's frame loop so it can be checked on its own. With floor to
 * spare the resident keeps its own spot and the pet stays home; with too little (a phone crops the room), the two stand
 * side by side, centred in what shows, the resident on the side it lives on.
 */
import { describe, expect, it } from "vitest";
import { HALF, PET_HOME, ROOM } from "./floor";
import { placeResident } from "./residentSpot";

const whole = { left: 0, right: ROOM };
// a phone shows about 71 of the room's 128 pixels (A69)
const phone = { left: 28, right: 99 };

describe("placeResident (P7)", () => {
  it("with no resident, the pet stands home and nobody has a spot", () => {
    const at = placeResident(null, "adult", whole);
    expect(at.petX).toBe(PET_HOME);
    expect(at.spot).toBeNull();
  });

  it("with floor to spare, the resident keeps its own spot and the pet stays home", () => {
    const at = placeResident({ id: "r", stage: "adult", x: 104 }, "baby", whole);
    expect(at.petX).toBe(PET_HOME);
    expect(at.spot).toEqual({ id: "r", x: 104 });
  });

  it("a spot beyond what shows is pulled inside the view, by the resident's half width and two pixels", () => {
    const view = { left: 0, right: 110 };
    const at = placeResident({ id: "r", stage: "baby", x: 120 }, "baby", view);
    expect(at.spot?.x).toBe(view.right - HALF.baby - 2);
    expect(at.petX).toBe(PET_HOME);
  });

  it("with too little floor, the two stand side by side within what shows, the resident on its own side", () => {
    // a baby beside an adult resident: 62 pixels, inside a phone's 71
    const right = placeResident({ id: "r", stage: "adult", x: 104 }, "baby", phone);
    expect(right.spot!.x).toBeGreaterThan(right.petX);
    const left = placeResident({ id: "r", stage: "adult", x: 20 }, "baby", phone);
    expect(left.spot!.x).toBeLessThan(left.petX);
    for (const at of [right, left]) {
      // neither stands outside what shows, and they never overlap
      expect(Math.min(at.petX - HALF.baby, at.spot!.x - HALF.adult)).toBeGreaterThanOrEqual(phone.left);
      expect(Math.max(at.petX + HALF.baby, at.spot!.x + HALF.adult)).toBeLessThanOrEqual(phone.right);
      expect(Math.abs(at.petX - at.spot!.x)).toBeGreaterThanOrEqual(HALF.baby + HALF.adult);
      expect(Number.isInteger(at.petX) && Number.isInteger(at.spot!.x)).toBe(true);
    }
  });

  it("a stage the room does not draw stands as an adult", () => {
    const elder = placeResident({ id: "r", stage: "elder", x: 104 }, "adult", phone);
    const adult = placeResident({ id: "r", stage: "adult", x: 104 }, "adult", phone);
    expect(elder).toEqual(adult);
  });
});
