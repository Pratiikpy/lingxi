import { describe, expect, it } from "vitest";
import { PET_SCHOOL } from "../src/lessons";
import { EGG_LESSONS, decodeGift, eggOf, encodeGift, newGiftId } from "../src/gift";

const rules = [...PET_SCHOOL.map((l) => l.rule), { label: "eat when hungry", when: { hunger: [3] }, then: { want: 1, mood: 1 } }, { label: "nap when tired", when: { energy: [2] }, then: { want: 3 } }];
const giftWith = (egg: ReturnType<typeof eggOf>) => encodeGift({ id: newGiftId(), from: { name: "Mochi", line: "gentle", stage: "elder" }, letter: "", egg, at: 0 });

describe("a gift's egg (plan 4.4 lets a grown pet hold more than eight lessons)", () => {
  it("an egg from a pet with few lessons carries all of them", () => {
    const egg = eggOf("gentle", rules.slice(0, 3) as never);
    expect(egg.lessons).toHaveLength(3);
    expect(decodeGift(giftWith(egg)).egg?.lessons).toHaveLength(3);
  });

  it("an egg from a pet that knows more than an egg holds still opens, carrying its first lessons", () => {
    expect(rules.length).toBeGreaterThan(EGG_LESSONS);
    const egg = eggOf("curious", rules as never);
    expect(egg.lessons.length).toBeGreaterThan(0);
    expect(egg.lessons.length).toBeLessThanOrEqual(EGG_LESSONS);
    expect(egg.lessons).toEqual(rules.slice(0, egg.lessons.length));
    expect(() => decodeGift(giftWith(egg))).not.toThrow();
  });

  it("every egg it makes opens, for every line and any number of lessons", () => {
    for (const line of ["gentle", "bold", "curious"] as const)
      for (let n = 0; n <= rules.length; n++) expect(() => decodeGift(giftWith(eggOf(line, rules.slice(0, n) as never)))).not.toThrow();
  });
});
