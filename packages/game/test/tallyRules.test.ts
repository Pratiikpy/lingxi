/**
 * G11: what each thing a player does counts toward, pinned. The web client and the 90-day simulator both count by these
 * rules, so a change here is a change to what every quest, daily and badge reads.
 */
import { describe, expect, it } from "vitest";
import { HOME, newWorld } from "@lingxi/world";
import { awayTally, careTally, fedTally, GIVER_ROOM, meetTally, minuteTally, questView, talkTally } from "../src/tallyRules";
import { mindBrain } from "../src/family";
import { type Pet, createPet } from "../src/sim";

const T = Date.UTC(2026, 10, 23, 10, 0);
const pet = (o: Partial<Pet> = {}): Pet => ({ ...createPet({ name: "Kiri", line: "gentle", now: T, tzOffsetMin: 0, brain: mindBrain({ line: "gentle", lessons: [] }) }), ...o });

describe("what a player's actions count toward (G11)", () => {
  it("a care counts as what it did, by the pet's time of day; waking an awake pet counts nothing", () => {
    const p = pet();
    const [all, byTime] = careTally("feed", false, { pet: p, note: "ate" });
    expect(all).toEqual(["CARE", "feed", 1, true]);
    expect(byTime![0]).toBe("CARE");
    expect(byTime![1]).toMatch(/^feed-(night|morning|day|evening)$/);
    expect(byTime![3]).toBe(false);
    expect(careTally("pet", false, { pet: p, note: "petted" })[0]).toEqual(["CARE", "pet", 1, true]);
    expect(careTally("wake", false, { pet: p, note: "awake" })).toEqual([]);
    expect(careTally("wake", true, { pet: p, note: "awake" })[0]).toEqual(["CARE", "wake", 1, true]);
    expect(careTally("feed", false, { pet: p, note: "full" as never })).toEqual([]);
  });

  it("a food counts by item, and by its group on the player's day", () => {
    expect(fedTally(10001, "grain", 0, T)).toEqual([
      ["FED", "10001", 1, true],
      ["FED_GROUP", "2026-11-23-grain", 1, false],
    ]);
    expect(fedTally(10001, undefined, 0, T)).toEqual([["FED", "10001", 1, true]]);
  });

  it("a watched minute counts time together, by time and place, and what the pet chose; an absent pet counts nothing", () => {
    const p = pet();
    const out = minuteTally(HOME, p, T, 2);
    expect(out[0]).toEqual(["TOGETHER", HOME, 2, true]);
    expect(out.some(([type, index]) => type === "TOGETHER_WHEN" && String(index).endsWith("-inside"))).toBe(true);
    for (const o of [{ asleep: true }, { away: true }, { hibernating: true }]) expect(minuteTally(HOME, pet(o as Partial<Pet>), T)).toEqual([]);
  });

  it("the pet's choices while away, a talk and a look at a builder's pet", () => {
    expect(awayTally(13, { explore: 2 })).toEqual([
      ["CHOOSE", "explore", 2, true],
      ["CHOOSE", "explore-13", 2, false],
    ]);
    expect(talkTally("wick")).toEqual([["TALK", "wick", 1, true]]);
    expect(meetTally("tapboy", T, 0)).toEqual([
      ["MEET", "tapboy", 1, true],
      ["MEET_DAY", "tapboy-2026-11-23", 1, false],
    ]);
    expect(GIVER_ROOM.praline).toBe(13);
  });

  it("the quest view reads the pet, or none before the first egg", () => {
    const world = newWorld("tally");
    const v = questView({ world, pet: pet(), pets: 1, onChain: false, bondLevel: 0, goalsDone: [], now: T, tzOffsetMin: 0 });
    expect(v.pet).toMatchObject({ level: 1, stage: "baby", onChain: false });
    expect(v.day).toBe("2026-11-23");
    const none = questView({ world, pet: null, pets: 0, onChain: false, bondLevel: 2, goalsDone: [], now: T, tzOffsetMin: 480 });
    expect(none.pet).toBeNull();
    expect(none.timeOfDay).toBe(2);
    expect(none.day).toBe("2026-11-23");
    expect(none.bondLevel).toBe(2);
  });
});
