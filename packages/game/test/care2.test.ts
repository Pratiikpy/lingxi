import { describe, expect, it } from "vitest";
import { STARTERS, compileProgram, fastBrain, stateBits } from "@lingxi/brain";
import { care, catchUp, createPet, kinshipNow, levelOf, packState, unpackState } from "../src/index";

const p0 = STARTERS.gentle;
const brain = { fast: fastBrain(compileProgram(p0)), nState: stateBits(p0), program: p0 };
const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 15, 8);

describe("care: sickness, mistakes, kinship, levels", () => {
  it("falls ill after six hours of neglect, can't play while ill, and medicine cures it", () => {
    let pet = createPet({ name: "M", line: "gentle", now: T0, tzOffsetMin: 0, brain });
    pet = catchUp(pet, T0 + 30 * H, brain);
    expect(pet.sick).toBe(true);
    expect(pet.missed?.some((m) => m.kind === "sick")).toBe(true);
    expect(care(pet, { kind: "play" }, T0 + 30 * H, brain).note).toBe("tooSick");
    const healed = care(pet, { kind: "medicine" }, T0 + 30 * H, brain);
    expect(healed.note).toBe("healed");
    expect(healed.pet.sick).toBe(false);
    expect(care(healed.pet, { kind: "medicine" }, T0 + 30 * H + 60_000, brain).note).toBe("notSick");
  });

  it("counts a care mistake when a meter runs out, once per running out", () => {
    let pet = createPet({ name: "M", line: "gentle", now: T0, tzOffsetMin: 0, brain });
    pet = catchUp(pet, T0 + 30 * H, brain);
    const kinds = pet.missed?.map((m) => m.kind) ?? [];
    expect(pet.mistakes).toBe(kinds.length);
    expect(new Set(kinds.filter((k) => k !== "sick")).size).toBe(kinds.filter((k) => k !== "sick").length);
  });

  it("kinship: +1 at most every 12 hours, fades one per full day unpetted", () => {
    let pet = createPet({ name: "M", line: "gentle", now: T0, tzOffsetMin: 0, brain });
    pet = care(pet, { kind: "pet" }, T0, brain).pet;
    pet = care(pet, { kind: "pet" }, T0 + 1 * H, brain).pet;
    expect(kinshipNow(pet, pet.beat)).toBe(1);
    pet = care(pet, { kind: "pet" }, T0 + 13 * H, brain).pet;
    expect(kinshipNow(pet, pet.beat)).toBe(2);
    // two and a half days later
    const later = catchUp(pet, T0 + 13 * H + 60 * H, brain);
    expect(kinshipNow(later, later.beat)).toBe(0);
  });

  it("levels get harder and everything survives the on-chain word", () => {
    expect(levelOf(0)).toEqual({ level: 1, into: 0, need: 25 });
    expect(levelOf(25).level).toBe(2);
    expect(levelOf(74).level).toBe(2);
    expect(levelOf(75).level).toBe(3);
    let pet = createPet({ name: "M", line: "gentle", now: T0, tzOffsetMin: 0, brain });
    pet = care(pet, { kind: "pet" }, T0, brain).pet;
    pet = catchUp(pet, T0 + 30 * H, brain);
    const u = unpackState(packState(pet, "baby"), brain.nState);
    expect(u.sick).toBe(true);
    expect(u.mistakes).toBe(pet.mistakes);
    expect(u.kinship).toBe(kinshipNow(pet, pet.beat));
  });
});
