import { describe, expect, it } from "vitest";
import { BADGES, newTiers, progressOf, record, tierOf, visitRoom, type Ledger } from "../src/index";

const chef = BADGES.find((b) => b.id === "chef")!;
const grown = BADGES.find((b) => b.id === "grown")!;

describe("care badges across every pet", () => {
  it("counts totals into bronze, silver and gold, with progress to the next tier", () => {
    let l: Ledger = {};
    for (let i = 0; i < 29; i++) l = record(l, "feed");
    expect(tierOf(chef, l)).toBe(0);
    expect(progressOf(chef, l)).toEqual({ value: 29, next: 30, fraction: 29 / 30 });
    const before = l;
    l = record(l, "feed");
    expect(tierOf(chef, l)).toBe(1);
    expect(newTiers(before, l)).toEqual([{ badge: chef, tier: 1 }]);
    l = record(l, "feed", 470);
    expect(tierOf(chef, l)).toBe(3);
    expect(progressOf(chef, l).next).toBeNull();
  });

  it("keeps the best stage any pet reached, so a new egg never lowers it", () => {
    let l = record({}, "stage", 4);
    l = record(l, "stage", 1);
    expect(l.stage).toBe(4);
    expect(tierOf(grown, l)).toBe(3);
  });

  it("counts each place once", () => {
    let l: Ledger = {};
    for (const r of [1, 2, 2, 3, 1]) l = visitRoom(l, r);
    expect(l.rooms).toBe(3);
  });

  it("never changes the ledger it was given", () => {
    const l: Ledger = { feed: 3 };
    record(l, "feed");
    visitRoom(l, 5);
    expect(l).toEqual({ feed: 3 });
  });

  it("every badge has words in both languages and rising tiers", () => {
    for (const b of BADGES) {
      expect(b.name.en && b.name.zh && b.how.en.includes("{n}") && b.how.zh.includes("{n}")).toBeTruthy();
      expect(b.tiers[0] < b.tiers[1] && b.tiers[1] < b.tiers[2]).toBe(true);
    }
  });
});
