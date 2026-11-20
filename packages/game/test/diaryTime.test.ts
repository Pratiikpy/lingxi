/** A94: a diary never narrates minutes the chain shows did not pass. */
import { describe, expect, it } from "vitest";
import { beatsOutrunChain, diaryText } from "../src/diary";

describe("a diary's time against the chain's (A94)", () => {
  it("a log of 33 beats saved 4 seconds after its hatching outruns the chain; one saved an hour later does not", () => {
    expect(beatsOutrunChain(33, 1_000, 1_004)).toBe(true);
    expect(beatsOutrunChain(33, 1_000, 1_000 + 3_600)).toBe(false);
    // a beat's worth of slack either way: a log saved the minute it was written is not called untimed
    expect(beatsOutrunChain(61, 0, 3_600)).toBe(false);
  });

  it("an untimed diary says how long in beats, never minutes, in both languages", () => {
    const wandered = { key: "wandered" as const, n: 33 };
    const sulked = { key: "sulked" as const, n: 5, why: "hungry" as const };
    expect(diaryText(wandered, "en")).toBe("I wandered off exploring for 33 minutes.");
    expect(diaryText(wandered, "en", { untimed: true })).toBe("I wandered off exploring for a while (33 beats of my log).");
    expect(diaryText(sulked, "en", { untimed: true })).toBe("I sulked for a while (5 beats of my log) because my tummy was rumbling.");
    expect(diaryText(wandered, "zh", { untimed: true })).toBe("我跑出去探险了一阵（日志里的 33 拍）。");
    for (const lang of ["en", "zh"] as const) {
      expect(diaryText(wandered, lang, { untimed: true })).not.toMatch(/minutes|分钟/);
      expect(diaryText(sulked, lang, { untimed: true })).not.toMatch(/minutes|分钟/);
    }
  });
});
