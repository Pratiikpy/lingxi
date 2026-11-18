import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/limit";

describe("the per-address limiter", () => {
  it("limits one address and leaves another alone", () => {
    const l = new RateLimiter(2, 60_000);
    expect([l.take("a", 0), l.take("a", 1), l.take("a", 2), l.take("b", 3)]).toEqual([true, true, false, true]);
    expect(l.take("a", 60_001)).toBe(true);
  });

  it("holds at most so many addresses, so a crowd of new ones cannot grow it without end", () => {
    const l = new RateLimiter(5, 3_600_000, 1_000);
    for (let i = 0; i < 25_000; i++) l.take(`10.0.${i >> 8}.${i & 255}`, i);
    expect(l.size()).toBeLessThanOrEqual(1_000);
    // the address seen most recently is still remembered, and still limited
    for (let i = 0; i < 4; i++) l.take("busy", 30_000 + i);
    expect(l.take("busy", 30_010)).toBe(true);
    expect(l.take("busy", 30_011)).toBe(false);
  });
});
