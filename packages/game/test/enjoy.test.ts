/**
 * G3: progress that means something. Care gives experience only when it answers a need, through an enjoyment bar that
 * fills with each rewarded care and empties slowly; taps inside one beat are one thought; evolution counts real care.
 */
import { describe, expect, it } from "vitest";
import { ENJOY_MAX, ENJOY_PER_CARE, SUB, care, catchUp, createPet, mindBrain, type Pet } from "../src";

const T0 = Date.UTC(2026, 10, 18, 9);
const MIN = 60_000;
const brain = mindBrain({ line: "gentle", lessons: [] });
const fresh = () => createPet({ name: "Pip", line: "gentle", now: T0, tzOffsetMin: 0, brain });
/** a pet whose food meter reads `food` of 1000 */
const withFood = (p: Pet, food: number): Pet => ({ ...p, meters: { ...p.meters, food: food * SUB } });

describe("experience for care that answers a need (G3)", () => {
  it("feeding a hungry pet teaches it something; feeding a full one does not", () => {
    const hungry = care(withFood(fresh(), 200), { kind: "feed", food: "mochi" }, T0 + MIN, brain).pet;
    const full = care(withFood(fresh(), 950), { kind: "feed", food: "mochi" }, T0 + MIN, brain).pet;
    expect(hungry.xp).toBeGreaterThan(0);
    expect(full.xp).toBe(0);
  });

  it("rewarded care fills the enjoyment bar; a full bar gives nothing more until time empties it", () => {
    let p = fresh();
    let t = T0;
    let gained = 0;
    for (let i = 0; i < 20; i++) {
      t += MIN;
      p = withFood(p, 200);
      const before = p.xp;
      p = care(p, { kind: "feed", food: "mochi" }, t, brain).pet;
      if (p.xp > before) gained++;
    }
    expect(gained).toBeLessThan(8);
    // too full to take another rewarded care
    expect(p.enjoy! + ENJOY_PER_CARE).toBeGreaterThan(ENJOY_MAX);
    // an hour later there is room again
    p = withFood(catchUp(p, t + 60 * MIN, brain), 200);
    const before = p.xp;
    p = care(p, { kind: "feed", food: "mochi" }, t + 60 * MIN, brain).pet;
    expect(p.xp).toBeGreaterThan(before);
  });

  it("many taps inside one beat are one thought: one word in the log", () => {
    let p = withFood(fresh(), 200);
    const at = T0 + MIN + 1_000;
    p = care(p, { kind: "pet" }, at, brain).pet;
    const words = p.pendingLog.length;
    for (let i = 0; i < 5; i++) p = care(p, { kind: "pet" }, at + i * 1_000, brain).pet;
    expect(p.pendingLog.length).toBe(words);
  });

  it("only care that answers a need counts toward evolution's care quality; goals still count every care", () => {
    let p = withFood(fresh(), 950);
    for (let i = 0; i < 5; i++) p = care(withFood(p, 950), { kind: "feed", food: "mochi" }, T0 + (i + 1) * MIN, brain).pet;
    expect(p.needs?.feed ?? 0).toBe(0);
    expect(p.counts.feed).toBe(5);
    p = care(withFood(p, 200), { kind: "feed", food: "mochi" }, T0 + 10 * MIN, brain).pet;
    expect(p.needs?.feed).toBe(1);
    expect(p.counts.feed).toBe(6);
  });
});
