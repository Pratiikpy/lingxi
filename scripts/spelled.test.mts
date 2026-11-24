/** A110: spelled-out counts, so the landing's "Seventy places" is held to the number of rooms. */
import { describe, expect, it } from "vitest";
import { chineseCount, englishCount } from "./lib/spelled.mts";

describe("counts as the landing spells them (A110)", () => {
  it("spells English counts", () => {
    expect([1, 12, 19, 20, 25, 70, 99].map(englishCount)).toEqual([
      "one",
      "twelve",
      "nineteen",
      "twenty",
      "twenty-five",
      "seventy",
      "ninety-nine",
    ]);
  });

  it("spells Chinese counts", () => {
    expect([1, 10, 12, 20, 25, 70, 99].map(chineseCount)).toEqual([
      "一",
      "十",
      "十二",
      "二十",
      "二十五",
      "七十",
      "九十九",
    ]);
  });

  it("refuses a count it cannot spell rather than guess", () => {
    expect(() => englishCount(0)).toThrow(RangeError);
    expect(() => chineseCount(100)).toThrow(RangeError);
    expect(() => englishCount(2.5)).toThrow(RangeError);
  });
});
