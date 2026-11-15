import { describe, expect, it } from "vitest";
import { dailyPartnerIndex, dailySeed, dayIndex, firstBlockAtOrAfter } from "../src/daily";
import { PARTNERS } from "../src/partners";

describe("daily challenge", () => {
  it("changes at midnight UTC and cycles every partner", () => {
    const d = dayIndex(Date.UTC(2026, 10, 15, 23, 59));
    expect(dayIndex(Date.UTC(2026, 10, 16, 0, 0))).toBe(d + 1);
    const seen = new Set(Array.from({ length: PARTNERS.length }, (_, k) => dailyPartnerIndex(d + k)));
    expect(seen.size).toBe(PARTNERS.length);
  });

  it("the seed comes from the block hash and the day, and refuses junk", () => {
    const h = "0x" + "ab".repeat(32);
    expect(dailySeed(100, h)).toBe(dailySeed(100, h));
    expect(dailySeed(101, h)).not.toBe(dailySeed(100, h));
    expect(dailySeed(100, "0x" + "cd".repeat(32))).not.toBe(dailySeed(100, h));
    expect(() => dailySeed(1, "0x1234")).toThrow();
  });

  it("finds the first block of a day in a few reads, on even and uneven block times", async () => {
    for (const times of [
      Array.from({ length: 200_000 }, (_, i) => 1_000_000 + i),
      Array.from({ length: 200_000 }, (_, i) => 1_000_000 + Math.floor(i * 0.7) + (i % 17 === 0 ? 3 : 0)),
    ]) {
      let reads = 0;
      const blockAt = async (n: number) => (reads++, times[n]!);
      const latest = { number: times.length - 1, timestamp: times.at(-1)! };
      for (const ts of [1_050_000, 1_120_000, times.at(-1)!]) {
        reads = 0;
        const n = await firstBlockAtOrAfter(ts, latest, blockAt);
        expect(times[n]!).toBeGreaterThanOrEqual(ts);
        if (n > 0) expect(times[n - 1]!).toBeLessThan(ts);
        expect(reads).toBeLessThan(40);
      }
    }

  });
});
