/** D19: the room's weather follows the world's season the home screen names, not the calendar. */
import { describe, expect, it } from "vitest";
import { worldSeasonAt } from "@lingxi/game";
import { weatherFor } from "./weather";

describe("the room's weather (D19)", () => {
  it("is drawn from the world's season: petals only in Blossom Weeks, snow only in Frost Weeks, leaves only at Harvest", () => {
    const seen: Record<string, Set<string>> = {};
    for (let d = 0; d < 224; d++) {
      const at = Date.UTC(2026, 10, 16, 12) + d * 86_400_000;
      const season = worldSeasonAt(at).id;
      (seen[season] ??= new Set()).add(weatherFor(new Date(at)));
    }
    expect([...seen.blossom!].every((w) => ["petals", "rain", "clear"].includes(w))).toBe(true);
    expect(seen.blossom!.has("petals")).toBe(true);
    expect([...seen.frost!].every((w) => ["snow", "clear"].includes(w))).toBe(true);
    expect([...seen.harvest!].every((w) => ["leaves", "rain", "clear"].includes(w))).toBe(true);
    expect([...seen.lantern!].every((w) => ["rain", "clear"].includes(w))).toBe(true);
  });
});
