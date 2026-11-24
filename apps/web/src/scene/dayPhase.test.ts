/** P6: one day phase for the whole world, from the brain's own time-of-day buckets. */
import { timeOfDay } from "@lingxi/brain";
import { describe, expect, it } from "vitest";
import { phaseAt } from "./dayPhase";

describe("the world's day phase (P6)", () => {
  it("follows the brain's time of day for every hour", () => {
    for (let h = 0; h < 24; h++) {
      const t = timeOfDay(h);
      expect(phaseAt(h), `hour ${h}`).toBe(t === 0 ? "night" : t === 3 ? "evening" : "day");
    }
  });

  it("has a night, an evening and a day", () => {
    const seen = new Set(Array.from({ length: 24 }, (_, h) => phaseAt(h)));
    expect([...seen].sort()).toEqual(["day", "evening", "night"]);
  });
});
