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

  it("an adult pet and an adult resident on a phone both stand whole, overlapping only as much as they must (P7b)", () => {
    // two adults side by side need 2 * 18 + 2 * 18 + 6 = 78 pixels; a phone shows 71
    for (const x of [104, 20]) {
      const at = placeResident({ id: "r", stage: "adult", x }, "adult", phone);
      const r = at.spot!.x;
      // both whole, two pixels clear of each edge
      for (const c of [at.petX, r]) {
        expect(c - HALF.adult, "inside the left edge").toBeGreaterThanOrEqual(phone.left + 2);
        expect(c + HALF.adult, "inside the right edge").toBeLessThanOrEqual(phone.right - 2);
      }
      // the resident on the side it lives on
      expect(x > PET_HOME ? r > at.petX : r < at.petX).toBe(true);
      // overlapping by no more than they must, and never by more than half the resident
      const overlap = 2 * HALF.adult - Math.abs(r - at.petX);
      expect(overlap, "no more than the room they lack").toBeLessThanOrEqual(
        2 * HALF.adult + 2 * HALF.adult - (71 - 4) + 1,
      );
      expect(overlap, "never more than half the resident").toBeLessThanOrEqual(HALF.adult);
      expect(Number.isInteger(at.petX) && Number.isInteger(r)).toBe(true);
    }
  });

  it("every pair that fitted side by side on a phone stands exactly where it did (P7b)", () => {
    const stages = ["baby", "child", "teen"] as const;
    const was = {
      // the rule before P7b, for pairs whose two widths and gap fit in what shows
      place: (hp: number, hr: number, onRight: boolean) => {
        const total = 2 * hp + 2 * hr + 6;
        const start = phone.left + Math.max(2, (phone.right - phone.left - total) / 2);
        return {
          petX: Math.round(onRight ? start + hp : start + 2 * hr + 6 + hp),
          spot: Math.round(onRight ? start + 2 * hp + 6 + hr : start + hr),
        };
      },
    };
    for (const pet of [...stages, "adult"] as const)
      for (const res of [...stages, "adult"] as const) {
        if (2 * HALF[pet] + 2 * HALF[res] + 6 > phone.right - phone.left - 4) continue;
        for (const x of [104, 20]) {
          const at = placeResident({ id: "r", stage: res, x }, pet, phone);
          if (at.petX === PET_HOME) continue;
          const old = was.place(HALF[pet], HALF[res], x >= PET_HOME);
          expect({ petX: at.petX, spot: at.spot!.x }, `${pet} with ${res}`).toEqual({ petX: old.petX, spot: old.spot });
        }
      }
  });

  it("a stage the room does not draw stands as an adult", () => {
    const elder = placeResident({ id: "r", stage: "elder", x: 104 }, "adult", phone);
    const adult = placeResident({ id: "r", stage: "adult", x: 104 }, "adult", phone);
    expect(elder).toEqual(adult);
  });
});
