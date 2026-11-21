/** B4: what brings each Pet School lesson about, so the pet can be seen doing it right after it is taught. */
import { describe, expect, it } from "vitest";
import { LIGHT_BULB_BEATS, lessonTrigger, momentFor, momentsFor, stagedEvent } from "../src/lightBulb";
import { PET_SCHOOL } from "../src/lessons";
import { EVENT } from "../src/sim";

const kind = (id: string) => lessonTrigger(PET_SCHOOL.find((l) => l.id === id)!.rule);

describe("the light-bulb moment (B4)", () => {
  it("knows what brings each school lesson about", () => {
    expect(kind("share")).toEqual({ kind: "event", event: EVENT.friend });
    expect(kind("brave")).toEqual({ kind: "event", event: EVENT.scary });
    expect(kind("thanks")).toEqual({ kind: "care", care: "feed" });
    expect(kind("greet")).toEqual({ kind: "watched" });
    for (const id of ["nap", "patient", "tidy", "explore"]) expect(kind(id), id).toEqual({ kind: "moment" });
  });

  it("stages the event for the beats right after the teaching beat, and no longer", () => {
    const staged = { event: EVENT.friend, from: 100 };
    expect(stagedEvent(staged, 100)).toBeNull();
    for (let b = 101; b <= 100 + LIGHT_BULB_BEATS; b++) expect(stagedEvent(staged, b)).toBe(EVENT.friend);
    expect(stagedEvent(staged, 101 + LIGHT_BULB_BEATS)).toBeNull();
    expect(stagedEvent(null, 101)).toBeNull();
  });

  it("lists every situation a moment lesson names, the first being its moment", () => {
    const nap = PET_SCHOOL.find((l) => l.id === "nap")!.rule;
    const all = momentsFor(nap);
    expect(all[0]).toEqual(momentFor(nap));
    expect(new Set(all.map((s) => s.energy))).toEqual(new Set(nap.when.energy));
    expect(all.every((s) => s.time === 2 && s.owner === 1)).toBe(true);
  });

  it("names a moment lesson's situation with its own senses and calm for the rest", () => {
    const nap = momentFor(PET_SCHOOL.find((l) => l.id === "nap")!.rule);
    expect(nap.time).toBe(2);
    expect([0, 1]).toContain(nap.energy);
    expect(nap.owner).toBe(1);
  });
});
