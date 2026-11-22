/**
 * D6: a resting pet shows its strongest habit now and then, timed by the clock; never asleep, ill, cared for or with
 * reduced motion (the caller passes `resting` false then), and the same at the same moment every time.
 */
import { describe, expect, it } from "vitest";
import { TRAITS } from "@lingxi/game";
import { HABIT_EVERY_MS, HABIT_FOR_MS, habitPose } from "./habitPose";

describe("small habits on the stage (D6)", () => {
  it("every habit has its own pose, shown for a moment in every seven seconds", () => {
    const poses = TRAITS.map((h) => JSON.stringify(habitPose(h, 100, true)));
    expect(new Set(poses).size).toBe(TRAITS.length);
    for (const h of TRAITS) {
      expect(habitPose(h, HABIT_FOR_MS + 10, true), h).toBeNull();
      expect(habitPose(h, HABIT_EVERY_MS + 100, true), h).toEqual(habitPose(h, 100, true));
    }
  });

  it("is not shown without a habit or while the pet is not resting", () => {
    expect(habitPose(null, 100, true)).toBeNull();
    expect(habitPose("shy", 100, false)).toBeNull();
  });
});
