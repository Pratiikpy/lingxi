import { describe, expect, it } from "vitest";
import { BADGES, badgeGoal, newTiers, progressOf, record, tierOf, visitRoom, type Ledger } from "../src/index";

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

  it("gives no badge for simply hatching the first pet: Pet keeper starts at a second one, at most the roster's eight (G8)", () => {
    const keeper = BADGES.find((b) => b.id === "keeper")!;
    const first = record({}, "pets");
    expect(newTiers({}, first)).toEqual([]);
    expect(newTiers(first, record(first, "pets"))).toEqual([{ badge: keeper, tier: 1 }]);
    expect(keeper.tiers[2]).toBeLessThanOrEqual(8);
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

  it("a goal of one is said in the singular in English, for every badge that counts (R65)", () => {
    const of = (id: string) => BADGES.find((b) => b.id === id)!;
    expect(badgeGoal(of("teacher"), 1, "en")).toBe("Teach 1 lesson");
    expect(badgeGoal(of("giver"), 1, "en")).toBe("Send 1 gift");
    expect(badgeGoal(of("healer"), 1, "en")).toBe("Nurse a sick pet back once");
    expect(badgeGoal(of("party"), 1, "en")).toBe("Be on the lane for 1 hundred-day party");
    expect(badgeGoal(of("teacher"), 8, "en")).toBe("Teach 8 lessons");
    expect(badgeGoal(of("teacher"), 1, "zh")).toBe("教会 1 课");
    // a stage or a season place is a word, never a count
    expect(badgeGoal(grown, 2, "en", "a child")).toBe("Raise a pet to a child");
    for (const b of BADGES) {
      if (b.metric === "stage" || b.metric === "seasonPlace") continue;
      const one = badgeGoal(b, 1, "en");
      expect(one, b.id).not.toContain("{n}");
      // no "1" before a plural noun: "1 lessons", "1 gifts", "1 times"
      expect(one, b.id).not.toMatch(
        /1 (?:[a-z-]+ )?(?:lessons|gifts|times|baths|pets|little ones|spars|places|days|parties)/,
      );
    }
  });
});
