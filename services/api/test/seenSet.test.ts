import { describe, expect, it } from "vitest";
import { EXACT_MAX, addSeen, emptySeen, hasSeen } from "../src/seenSet";

const id = (i: number) => i.toString(16).padStart(16, "0").split("").reverse().join("");

describe("a set of who has been seen, in a fixed size", () => {
  it("is exact while small, and never forgets anyone it saw", () => {
    let s = emptySeen();
    for (let i = 0; i < EXACT_MAX; i++) s = addSeen(s, id(i));
    expect(s.bloom).toBeNull();
    for (let i = 0; i < EXACT_MAX; i++) expect(hasSeen(s, id(i))).toBe(true);
    expect(hasSeen(s, id(EXACT_MAX + 1))).toBe(false);
  });

  it("past that, it holds any number in the same few kilobytes, still never forgetting anyone", () => {
    let s = emptySeen();
    for (let i = 0; i < 20_000; i++) s = addSeen(s, id(i));
    expect(s.ids).toEqual([]);
    expect(JSON.stringify(s).length).toBeLessThan(6_000);
    for (let i = 0; i < 20_000; i += 97) expect(hasSeen(s, id(i))).toBe(true);
  });

  it("rarely mistakes a newcomer for someone seen, at the size a popular lesson reaches", () => {
    let s = emptySeen();
    for (let i = 0; i < 2_000; i++) s = addSeen(s, id(i));
    let wrong = 0;
    for (let i = 100_000; i < 110_000; i++) if (hasSeen(s, id(i))) wrong++;
    expect(wrong / 10_000).toBeLessThan(0.01);
  });
});
