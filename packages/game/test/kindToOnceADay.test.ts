/**
 * G5: kind to a once-a-day player. One visit a day keeps a pet well; during a first long absence no need falls below its
 * floor (240, just inside the lowest band the brain reads, so a waiting pet still acts on its need); a pet falls ill only
 * after real neglect (days, not hours); an absence longer than the catch-up's three days of thought still counts in full;
 * and time spent with a need at zero does not count toward growing up. No death.
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
  it("keeps every need at its floor or above through a first absence of a long weekend", () => {
    const p = catchUp(fresh(), T0 + 90 * H, brain);
    for (const [k, v] of Object.entries(needs(p))) expect(v, k).toBeGreaterThanOrEqual(240);
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

  it("a care starts the four days again for the need it answers (D1: a meal, a bath, a pat)", () => {
    let p = catchUp(fresh(), T0 + 80 * H, brain);
    p = care(p, { kind: "feed", food: "mochi" }, T0 + 80 * H, brain).pet;
    p = care(p, { kind: "clean" }, T0 + 80 * H, brain).pet;
    p = care(p, { kind: "pet" }, T0 + 80 * H, brain).pet;
    p = catchUp(p, T0 + 160 * H, brain);
    for (const [k, v] of Object.entries(needs(p))) expect(v, k).toBeGreaterThanOrEqual(240);
  });

  it("a pet fed when hungry reads the hunger it had when the food came, and chooses to eat", () => {
    // a day after a meal the pet is hungry (food at the quarter floor); fed then, its own rule answers the meal
    for (const line of ["gentle", "bold", "curious"] as const) {
      const b = mindBrain({ line, lessons: [] });
      const p0 = createPet({ name: "Pip", line, now: T0, tzOffsetMin: 480, brain: b });
      const hungry = catchUp(p0, T0 + 24 * H, b);
      expect(visible(hungry.meters.food), line).toBeLessThan(250);
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

describe("neglect never pays (D1)", () => {
  it("a pet only ever patted or spoken to, never fed or cleaned, falls ill, makes mistakes and grows up slower", () => {
    for (const kind of ["pet", "talk"] as const) {
      let p = fresh();
      let ill = false;
      // the review's probe: a care every 93.6 hours, just inside the four days, for 62 days
      for (let t = 93.6 * H; t <= 62 * 24 * H; t += 93.6 * H) {
        p = care(p, { kind }, T0 + Math.round(t), brain).pet;
        if (p.sick) ill = true;
      }
      p = catchUp(p, T0 + 62 * 24 * H, brain);
      expect(ill || p.sick || p.hibernating, `${kind}: falls ill or into its long sleep`).toBe(true);
      expect(p.mistakes ?? 0, `${kind}: care mistakes`).toBeGreaterThan(0);
      expect(stageOf(p, T0 + 62 * 24 * H), `${kind}: not grown up at full speed`).not.toBe("elder");
    }
  });

  it("each need's floor is held only by the care that answers it", () => {
    // fed every three days and nothing else: food holds at the floor, cleanliness gives way after four days
    let p = fresh();
    for (let d = 3; d <= 9; d += 3) p = care(p, { kind: "feed", food: "mochi" }, T0 + d * 24 * H, brain).pet;
    p = catchUp(p, T0 + 9 * 24 * H + 1 * H, brain);
    expect(visible(p.meters.food)).toBeGreaterThanOrEqual(240);
    expect(visible(p.meters.clean)).toBeLessThan(240);
    const since = p.sinceCared!;
    expect(since[0]).toBeLessThan(2 * 60);
    expect(since[2]).toBeGreaterThan(9 * 24 * 60 - 60);
  });

  it("a save from before D1 keeps its one count for every need", async () => {
    const { sinceCaredOf } = await import("../src/pet");
    expect(sinceCaredOf({ uncaredBeats: 70 })).toEqual([70, 70, 70, 70]);
    expect(sinceCaredOf({})).toEqual([0, 0, 0, 0]);
  });
});

describe("what a returning player is told about the needs (G5)", () => {
  it("names the needs that waited at the floor, the illness of real neglect, and the long sleep", async () => {
    const { awayNeeds } = await import("../src/away");
    expect(awayNeeds(fresh())).toEqual({ kind: "fine", low: [] });
    const weekend = catchUp(fresh(), T0 + 60 * H, brain);
    const told = awayNeeds(weekend);
    expect(told.kind).toBe("waiting");
    expect(told.low).toContain("food");
    const month = catchUp(fresh(), T0 + 30 * 24 * H, brain);
    expect(awayNeeds(month).kind).toBe("hibernating");
    const ill = catchUp(fresh(), T0 + 175 * H, brain);
    expect(awayNeeds(ill).kind).toBe("sick");
  });
});
