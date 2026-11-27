/**
 * P10: the room keeps a bounded budget of pets' cards; one it could not keep is answered as unavailable. The game reads
 * that answer as such and says so, in both languages, and never as a damaged card or one that cannot spar.
 */
import { describe, expect, it } from "vitest";
import { answerCardOf, friendCardOf } from "./live";
import { cannotSparText, noFamilyText } from "./liveCardWords";

const about = { t: "card", id: "p1", name: "Mochi", line: "gentle", stage: "child" };

describe("a friend's card the room could not keep is unavailable, and said so (P10)", () => {
  it("reads an unavailable card as unavailable, a whole one as it came, an unchanged one from what it kept", () => {
    const kept = new Map([["p1", '{"lessons":[]}']]);
    expect(friendCardOf({ ...about, unavailable: true }, kept, 5)).toEqual({
      id: "p1",
      name: "Mochi",
      line: "gentle",
      stage: "child",
      lessons: "",
      unavailable: true,
      at: 5,
    });
    expect(friendCardOf({ ...about, lessons: "[1]" }, kept, 5)?.lessons).toBe("[1]");
    expect(friendCardOf({ ...about, unchanged: true }, kept, 5)?.lessons).toBe('{"lessons":[]}');
    expect(friendCardOf({ ...about, unchanged: true }, new Map(), 5)).toBeNull();
  });

  it("reads an answer's card the same way", () => {
    const kept = new Map([["p1", "[2]"]]);
    expect(answerCardOf({ from: "p1", cardUnavailable: true }, kept)).toEqual({ cardUnavailable: true });
    expect(answerCardOf({ from: "p1", card: "[3]" }, kept)).toEqual({ card: "[3]" });
    expect(answerCardOf({ from: "p1", cardUnchanged: true }, kept)).toEqual({ card: "[2]" });
    expect(answerCardOf({ from: "p9", cardUnchanged: true }, kept)).toEqual({});
  });

  it("says an unavailable card is unavailable, in English and Chinese, never that it is damaged", () => {
    for (const lang of ["en", "zh"]) {
      const spar = cannotSparText({ unavailable: true }, lang);
      const family = noFamilyText({ name: "Mochi", yes: true, cardUnavailable: true }, false, lang);
      for (const text of [spar, family]) {
        expect(text).not.toMatch(/damaged|损坏|坏了/i);
        expect(text).toMatch(lang === "zh" ? /取不到/ : /isn't available right now/);
      }
      expect(cannotSparText({}, lang)).not.toBe(spar);
    }
    expect(noFamilyText({ name: "Mochi", yes: false }, false, "en")).toBe("Mochi's owner said not now.");
    expect(noFamilyText({ name: "Mochi", yes: true }, true, "en")).toMatch(/born of two parents/);
    expect(noFamilyText({ name: "Mochi", yes: true }, false, "en")).toBe("Their minds could not be put together.");
  });
});
