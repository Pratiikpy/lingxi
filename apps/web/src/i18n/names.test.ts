import { describe, expect, it } from "vitest";
import { translate } from "./index";

describe("names a player tells apart (H5)", () => {
  it("no instinct shares its name with an egg line, in either language", () => {
    for (const lang of ["en", "zh"] as const) {
      const lines = ["gentle", "bold", "curious"].map((l) => translate(lang, `line.${l}` as never));
      const instincts = ["brave", "greedy", "curious", "calm"].map((k) => translate(lang, `instinct.${k}` as never));
      expect(
        instincts.filter((n) => lines.includes(n)),
        lang,
      ).toEqual([]);
    }
  });
  it('one day is a day, not "1 days"', () => {
    expect(translate("en", "me.day1" as never)).toBe("1 day");
    expect(translate("en", "sit.day1" as never)).toBe("1 day");
  });
});
