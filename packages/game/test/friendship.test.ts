import { describe, expect, it } from "vitest";
import { BOND_DAILY_CAP, BOND_LEVELS, FAMILY_BOND_LEVEL, addBond, bondLevel, bondProgress, canStartFamily, friendsByCloseness, type Bonds } from "../src/friendship";

const DAY = 86_400_000;
const who = { name: "Rex", line: "bold" };

describe("pet friendships", () => {
  it("levels start at their thresholds", () => {
    expect(BOND_LEVELS.map(bondLevel)).toEqual([0, 1, 2, 3, 4]);
    expect(bondLevel(BOND_LEVELS[1]! - 1)).toBe(0);
    expect(bondProgress(5)).toBeCloseTo(0.5);
    expect(bondProgress(1000)).toBe(1);
  });

  it("a day's points are capped, and the cap resets the next day", () => {
    let b: Bonds = {};
    for (let i = 0; i < 20; i++) b = addBond(b, "p1", who, "spar", 10 * DAY + i * 1000).bonds;
    expect(b.p1!.points).toBe(BOND_DAILY_CAP);
    const r = addBond(b, "p1", who, "heart", 11 * DAY);
    expect(r.gained).toBe(2);
    expect(r.bonds.p1!.points).toBe(BOND_DAILY_CAP + 2);
  });

  it("reports a level reached, once", () => {
    let b: Bonds = {};
    const ups: number[] = [];
    for (let d = 0; d < 10; d++)
      for (let i = 0; i < 6; i++) {
        const r = addBond(b, "p1", who, "heart", d * DAY + i);
        b = r.bonds;
        if (r.levelUp !== null) ups.push(r.levelUp);
      }
    expect(ups).toEqual([1, 2, 3, 4]);
  });

  it("a family needs best friends, which takes several days of play", () => {
    let b: Bonds = {};
    let days = 0;
    while (!canStartFamily(b, "p1")) {
      for (let i = 0; i < 10; i++) b = addBond(b, "p1", who, "spar", days * DAY + i).bonds;
      days++;
    }
    expect(bondLevel(b.p1!.points)).toBe(FAMILY_BOND_LEVEL);
    expect(days).toBe(Math.ceil(BOND_LEVELS[FAMILY_BOND_LEVEL]! / BOND_DAILY_CAP));
    expect(canStartFamily(b, "stranger")).toBe(false);
  });

  it("keeps the first meeting, updates the name, and sorts closest first", () => {
    let b = addBond({}, "p1", who, "wave", 100).bonds;
    b = addBond(b, "p1", { name: "Rexy", line: "bold" }, "wave", 200).bonds;
    b = addBond(b, "p2", { name: "Mo", line: "gentle" }, "stay", 300).bonds;
    expect(b.p1).toMatchObject({ name: "Rexy", first: 100, last: 200, points: 2 });
    expect(friendsByCloseness(b).map(([id]) => id)).toEqual(["p2", "p1"]);
    expect(addBond(b, "", who, "wave", 1).bonds).toBe(b);
  });
});
