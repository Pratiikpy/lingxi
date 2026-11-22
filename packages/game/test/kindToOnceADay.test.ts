/**
 * G5: kind to a once-a-day player. One visit a day keeps a pet well; during a first long absence no need falls below a
 * quarter; a pet falls ill only after real neglect (days, not hours); an absence longer than the catch-up's three days of
 * thought still counts in full; and time spent with a need at zero does not count toward growing up. No death.
 */
import { describe, expect, it } from "vitest";
import { WANTS } from "@lingxi/brain";
import { catchUp, care, createPet } from "../src/sim";
import { mindBrain } from "../src/family";
import { stageOf } from "../src/pet";

const T0 = Date.UTC(2026, 10, 23, 11, 0);
const H = 3_600_000;
const brain = mindBrain({ line: "gentle", lessons: [] });
const visible = (v: number) => Math.floor(v / 60);
const needs = (p: ReturnType<typeof createPet>) => ({ food: visible(p.meters.food), joy: visible(p.meters.joy), energy: visible(p.meters.energy), clean: visible(p.meters.clean) });
const fresh = () => createPet({ name: "Pip", line: "gentle", now: T0, tzOffsetMin: 480, brain });

describe("kind to a once-a-day player (G5)", () => {
  it("keeps every need at a quarter or more through a first absence of three days", () => {
    const p = catchUp(fresh(), T0 + 72 * H, brain);
    for (const [k, v] of Object.entries(needs(p))) expect(v, k).toBeGreaterThanOrEqual(250);
    expect(p.sick ?? false).toBe(false);
    expect(p.mistakes ?? 0).toBe(0);
  });

  it("falls ill only after real neglect: days without any care, never hours", () => {
    let p = fresh();
    let sickAt: number | null = null;
    for (let h = 1; h <= 10 * 24 && sickAt === null; h++) {
      p = catchUp(p, T0 + h * H, brain);
      if (p.sick) sickAt = h;
    }
    expect(sickAt, "a pet left alone does fall ill in the end").not.toBeNull();
    expect(sickAt!).toBeGreaterThanOrEqual(96);
  });

  it("counts an absence longer than three days in full, though the brain thinks only through its last three", () => {
    const p = catchUp(fresh(), T0 + 10 * 24 * H, brain);
    expect(p.sick, "ten days alone is real neglect").toBe(true);
    expect(needs(p).food).toBeLessThan(250);
  });

  it("a care starts the three days again", () => {
    let p = catchUp(fresh(), T0 + 60 * H, brain);
    p = care(p, { kind: "pet" }, T0 + 60 * H, brain).pet;
    p = catchUp(p, T0 + 120 * H, brain);
    for (const [k, v] of Object.entries(needs(p))) expect(v, k).toBeGreaterThanOrEqual(250);
  });

  it("a pet fed when hungry reads the hunger it had when the food came, and chooses to eat", () => {
    // a day after a meal the pet is hungry (food at the quarter floor); fed then, its own rule answers the meal
    for (const line of ["gentle", "bold", "curious"] as const) {
      const b = mindBrain({ line, lessons: [] });
      const p0 = createPet({ name: "Pip", line, now: T0, tzOffsetMin: 480, brain: b });
      const hungry = catchUp(p0, T0 + 24 * H, b);
      expect(visible(hungry.meters.food), line).toBeLessThan(500);
      const fed = care(hungry, { kind: "feed", food: "mochi" }, T0 + 24 * H, b).pet;
      expect(visible(fed.meters.food), "the meal still counts").toBeGreaterThan(visible(hungry.meters.food));
      expect(WANTS[fed.last.want], line).toBe("eat");
    }
  });

  it("growth waits while a need is at zero: a neglected pet stays younger than its age", () => {
    const born = fresh();
    const neglected = catchUp(born, T0 + 9 * 24 * H, brain);
    const now = T0 + 9 * 24 * H;
    // by the calendar a pet is an adult on day 8; the neglected one has lost the days its needs were empty
    expect((neglected.stalledBeats ?? 0) / 60, "hours spent with a need at zero").toBeGreaterThan(48);
    expect(stageOf({ bornAt: born.bornAt }, now)).toBe("adult");
    expect(stageOf(neglected, now)).toBe("teen");
  });
});

describe("what a returning player is told about the needs (G5)", () => {
  it("names the needs that waited at a quarter, the illness of real neglect, and the long sleep", async () => {
    const { awayNeeds } = await import("../src/away");
    expect(awayNeeds(fresh())).toEqual({ kind: "fine", low: [] });
    const weekend = catchUp(fresh(), T0 + 60 * H, brain);
    const told = awayNeeds(weekend);
    expect(told.kind).toBe("waiting");
    expect(told.low).toContain("food");
    const month = catchUp(fresh(), T0 + 30 * 24 * H, brain);
    expect(awayNeeds(month).kind).toBe("hibernating");
    const ill = catchUp(fresh(), T0 + 150 * H, brain);
    expect(awayNeeds(ill).kind).toBe("sick");
  });
});
