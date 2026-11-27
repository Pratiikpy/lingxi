import { describe, expect, it } from "vitest";
import { EXACT_MAX, SeenBits, addSeen, emptySeen, hasSeen } from "../src/seenSet";
import { bytesEach } from "./heap";

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

describe("the same set in memory, compact (P10)", () => {
  it("answers as the set it is made from, and writes the same JSON, exact or a filter", () => {
    for (const count of [0, 1, 100, EXACT_MAX, EXACT_MAX + 1, 3_000]) {
      let s = emptySeen();
      const bits = SeenBits.from(emptySeen());
      for (let i = 0; i < count; i++) {
        // a filter can take a newcomer for someone seen (rarely): both sets then leave it out alike
        const fresh = !hasSeen(s, id(i));
        s = addSeen(s, id(i));
        expect(bits.add(id(i))).toBe(fresh);
        expect(bits.add(id(i)), "seen before").toBe(false);
      }
      expect(JSON.stringify(bits)).toBe(JSON.stringify(s));
      for (let i = 0; i < count + 50; i++) expect(bits.has(id(i))).toBe(hasSeen(s, id(i)));
    }
  });

  it("reads a set kept on disk, a filter kept before ids were keyed included", () => {
    let s = emptySeen();
    for (let i = 0; i < 400; i++) s = addSeen(s, id(i));
    const legacy = { ...s, legacy: true as const };
    const bits = SeenBits.from(legacy);
    expect(bits.legacy).toBe(true);
    expect(JSON.stringify(bits)).toBe(JSON.stringify(legacy));
    for (let i = 0; i < 400; i += 7) expect(bits.has(id(i))).toBe(true);
    const exact = SeenBits.from({ ids: [id(1), id(2)], bloom: null });
    expect([exact.has(id(1)), exact.has(id(3))]).toEqual([true, false]);
    expect(JSON.stringify(exact)).toBe(JSON.stringify({ ids: [id(1), id(2)], bloom: null }));
  });

  it("keeps an id in 8 bytes and the filter in its 4,096", async () => {
    const n = 2_000;
    const [exact, sets] = await bytesEach(
      n,
      () => [] as SeenBits[],
      (all) => {
        for (let k = 0; k < n; k++) {
          const b = SeenBits.from(emptySeen());
          for (let i = 0; i < EXACT_MAX; i++) b.add(id(k * 1_000 + i));
          all.push(b);
        }
      },
    );
    // a set of 256 ids held 10.9 KB as strings (42.5 bytes an id); packed, 2 KB and a little
    expect(exact).toBeLessThan(2_600);
    const [filter] = await bytesEach(
      1,
      () => sets,
      (all) => {
        for (const b of all) b.add("f".repeat(16));
      },
    );
    // each set a filter now: a 5,464-character base64 string before, 4,096 bytes and a little now
    expect(filter / n + exact).toBeLessThan(4_700);
    expect(sets.every((b) => b.has("f".repeat(16)))).toBe(true);
  });
});
