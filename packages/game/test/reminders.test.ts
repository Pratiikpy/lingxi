import { describe, expect, it } from "vitest";
import { STARTERS, compileProgram, fastBrain, stateBits } from "@lingxi/brain";
import { HORIZON_MS, care, catchUp, createPet, toVisible, upcomingNeeds } from "../src/index";

const p0 = STARTERS.gentle;
const brain = { fast: fastBrain(compileProgram(p0)), nState: stateBits(p0), program: p0 };
const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 15, 8);

describe("reminders: when the pet will next need you", () => {
  it("a fresh pet has no needs now, and hunger comes first and within the horizon", () => {
    const pet = createPet({ name: "M", line: "gentle", now: T0, tzOffsetMin: 0, brain });
    const needs = upcomingNeeds(pet, T0, brain);
    expect(needs.length).toBeGreaterThan(0);
    expect(needs[0]!.at).toBeGreaterThan(T0);
    expect(needs[0]!.kind).toBe("hungry");
    expect(needs.every((n) => n.at <= T0 + HORIZON_MS)).toBe(true);
    expect(needs.map((n) => n.at)).toEqual([...needs.map((n) => n.at)].sort((a, b) => a - b));
  });

  it("the predicted moment matches what the game itself shows then (to within one step)", () => {
    const pet = createPet({ name: "M", line: "gentle", now: T0, tzOffsetMin: 0, brain });
    const hungry = upcomingNeeds(pet, T0, brain).find((n) => n.kind === "hungry")!;
    expect(toVisible(catchUp(pet, hungry.at, brain).meters.food)).toBeLessThan(200);
    expect(toVisible(catchUp(pet, hungry.at - 20 * 60_000, brain).meters.food)).toBeGreaterThanOrEqual(200);
  });

  it("feeding pushes the hunger reminder later", () => {
    const pet = createPet({ name: "M", line: "gentle", now: T0, tzOffsetMin: 0, brain });
    const before = upcomingNeeds(pet, T0 + 5 * H, brain).find((n) => n.kind === "hungry")!.at;
    const fed = care(catchUp(pet, T0 + 5 * H, brain), { kind: "feed", food: "apple" }, T0 + 5 * H, brain).pet;
    const after = upcomingNeeds(fed, T0 + 5 * H, brain).find((n) => n.kind === "hungry")!.at;
    expect(after).toBeGreaterThan(before);
  });

  it("a long-neglected pet reports its needs right away, sickness included", () => {
    const pet = catchUp(createPet({ name: "M", line: "gentle", now: T0, tzOffsetMin: 0, brain }), T0 + 30 * H, brain);
    const needs = upcomingNeeds(pet, T0 + 30 * H, brain);
    expect(needs.filter((n) => n.at === T0 + 30 * H).map((n) => n.kind)).toEqual(expect.arrayContaining(["hungry", "sick"]));
  });
});

describe("reminders: stable plans", () => {
  it("asking again a few minutes later gives the same times (so the game doesn't resend)", () => {
    const pet = createPet({ name: "M", line: "gentle", now: T0, tzOffsetMin: 0, brain });
    const a = upcomingNeeds(pet, T0 + 61_000, brain);
    const b = upcomingNeeds(pet, T0 + 47 * 60_000, brain);
    // only the far edge of the window may add a need; everything inside it is identical
    expect(b.filter((n) => n.at <= T0 + 61_000 + HORIZON_MS)).toEqual(a);
    expect(a.every((n) => n.at % (20 * 60_000) === 0)).toBe(true);
  });
});
