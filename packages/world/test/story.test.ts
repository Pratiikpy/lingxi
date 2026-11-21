import { describe, expect, it } from "vitest";
import {
  type ConditionView,
  type QuestDef,
  type WorldState,
  acceptQuest,
  bump,
  claimWeekly,
  completeQuest,
  dropQuest,
  localDay,
  newWorld,
  nextInChain,
  pickDailies,
  questProgress,
  questStatus,
  rollDailies,
  tallyOf,
  weeklyGiftsWaiting,
} from "../src";

const T0 = Date.UTC(2026, 10, 16, 9);
const DAY = 86_400_000;
const view = (world: WorldState, now = T0): ConditionView => ({ world, pet: { level: 1, stage: "baby", onChain: false, needsMin: 500 }, pets: 1, now, timeOfDay: 2, day: "2026-11-16", bondLevel: 0, goalsDone: [] });
const T = (en: string) => ({ en, zh: en });
const ok = <X,>(r: ({ ok: true; world: WorldState } & X) | { ok: false; reason: string }) => {
  if (!r.ok) throw new Error(r.reason);
  return r;
};

const hello: QuestDef = {
  id: "q01",
  kind: "story",
  arc: 1,
  giver: "pet",
  title: T("Hello"),
  intro: [T("Pat me?")],
  outro: [T("Thank you!")],
  requires: [],
  objectives: [{ text: T("Pat 3 times"), cond: { type: "CARE", logic: "INC_MIN", index: "pet", value: 3 } }],
  rewards: [
    { kind: "coins", n: 10 },
    { kind: "item", item: 11313, n: 1 },
    { kind: "trust", who: "wick", n: 2 },
    { kind: "flag", name: "diary" },
    { kind: "piece", id: "sunhat" },
    { kind: "decor", id: "fern" },
    { kind: "recipe", index: 9001 },
  ],
};
const meal: QuestDef = { ...hello, id: "q02", requires: [{ type: "QUEST", logic: "BOOL_IS", index: "q01" }], objectives: [{ text: T("Feed"), cond: { type: "CARE", logic: "INC_MIN", index: "feed", value: 1 } }], rewards: [{ kind: "coins", n: 5 }], opensWhen: T("after Hello") };
const later: QuestDef = { ...meal, id: "q09", requires: [{ type: "QUEST", logic: "BOOL_IS", index: "q01" }, { type: "COINS", logic: "CURR_MIN", value: 999 }] };
const daily = (id: string, group: "care" | "social" | "explore", index: string): QuestDef => ({
  ...hello,
  id,
  kind: "daily",
  arc: undefined,
  group,
  requires: [],
  objectives: [{ text: T(id), cond: { type: "CARE", logic: "INC_MIN", index, value: 1 } }],
  rewards: [{ kind: "coins", n: 3 }],
});
const POOL = [daily("d-feed", "care", "feed"), daily("d-bath", "care", "clean"), daily("d-hi", "social", "talk"), daily("d-gift", "social", "pet"), daily("d-look", "explore", "play"), daily("d-walk", "explore", "sleep")];

describe("a story quest", () => {
  it("is taken, counts from then, and pays every reward exactly once", () => {
    let w = bump(newWorld("s"), "CARE", "pet", 40); // pats from long ago do not count
    expect(questStatus(hello, w, view(w))).toBe("available");
    w = ok(acceptQuest(w, hello, view(w))).world;
    expect(questStatus(hello, w, view(w))).toBe("active");
    expect(acceptQuest(w, hello, view(w))).toEqual({ ok: false, reason: "accepted" });
    expect(completeQuest(w, hello, view(w))).toEqual({ ok: false, reason: "notReady" });
    w = bump(w, "CARE", "pet", 2);
    expect(questProgress(hello, w, view(w))[0]).toEqual({ have: 2, need: 3, met: false });
    w = bump(w, "CARE", "pet", 1);
    expect(questStatus(hello, w, view(w))).toBe("ready");
    const coins = w.coins;
    const r = ok(completeQuest(w, hello, view(w)));
    w = r.world;
    expect(w.coins).toBe(coins + 10);
    expect(w.bag[11313]).toBe(3); // a new world starts with 2
    expect(w.trust).toEqual({ wick: 2 });
    expect(w.flags).toEqual(["diary"]);
    expect(w.wardrobe?.owned).toEqual(["sunhat"]);
    expect(w.decor?.owned).toEqual(["fern"]);
    expect(w.recipes).toEqual([9001]);
    expect(tallyOf(w, "QUEST_DONE", "q01")).toBe(1);
    expect(questStatus(hello, w, view(w))).toBe("done");
    expect(completeQuest(w, hello, view(w))).toEqual({ ok: false, reason: "done" });
    expect(acceptQuest(w, hello, view(w))).toEqual({ ok: false, reason: "done" });
  });

  it("pays no coins again for a deed a milestone already paid for, on a save from before B6", () => {
    let w = { ...newWorld("s"), claimed: ["hello"] };
    w = ok(acceptQuest(w, hello, view(w))).world;
    w = bump(w, "CARE", "pet", 3);
    const coins = w.coins;
    const r = ok(completeQuest(w, hello, view(w)));
    expect(r.world.coins, "the pats were paid for by the milestone").toBe(coins);
    expect(r.world.flags, "what the story quest opens still opens").toContain("diary");
    expect(r.rewards.some((x) => x.kind === "coins"), "and the screen does not claim coins it did not pay").toBe(false);
  });

  it("stays locked until what opens it is done, then the chain offers the next one", () => {
    let w = newWorld("s");
    expect(questStatus(meal, w, view(w))).toBe("locked");
    expect(acceptQuest(w, meal, view(w))).toEqual({ ok: false, reason: "locked" });
    w = ok(acceptQuest(w, hello, view(w))).world;
    w = bump(w, "CARE", "pet", 3);
    w = ok(completeQuest(w, hello, view(w))).world;
    expect(questStatus(meal, w, view(w))).toBe("available");
    expect(nextInChain([later, meal], hello, w, view(w))?.id).toBe("q02"); // q09 needs 999 coins too
  });

  it("can be put down and taken again, counting afresh", () => {
    let w = ok(acceptQuest(newWorld("s"), hello, view(newWorld("s")))).world;
    w = bump(w, "CARE", "pet", 2);
    w = ok(dropQuest(w, hello)).world;
    expect(questStatus(hello, w, view(w))).toBe("available");
    expect(dropQuest(w, hello)).toEqual({ ok: false, reason: "notActive" });
    w = ok(acceptQuest(w, hello, view(w))).world;
    expect(questProgress(hello, w, view(w))[0]!.have).toBe(0);
  });
});

describe("dailies", () => {
  it("follow the player's own calendar day", () => {
    const late = Date.UTC(2026, 10, 16, 23, 30);
    expect(localDay(late, 0)).toBe("2026-11-16");
    expect(localDay(late, 60)).toBe("2026-11-17"); // an hour east it is already tomorrow
    expect(localDay(late, -600)).toBe("2026-11-16");
  });

  it("three a day, one of each kind, the same for the same player and day", () => {
    const a = pickDailies(POOL, "seed", "2026-11-16");
    expect(a).toHaveLength(3);
    expect(a.map((id) => POOL.find((q) => q.id === id)!.group)).toEqual(["care", "social", "explore"]);
    expect(pickDailies(POOL, "seed", "2026-11-16")).toEqual(a);
    const days = Array.from({ length: 20 }, (_, i) => pickDailies(POOL, "seed", localDay(T0 + i * DAY, 0)).join());
    expect(new Set(days).size).toBeGreaterThan(1);
  });

  it("start counting when the day is first seen, finish once that day, and come back tomorrow", () => {
    let w = bump(newWorld("seed"), "CARE", "feed", 5);
    w = rollDailies(w, POOL, view(w), 0);
    const today = w.quests!.today!;
    expect(today.offered).toHaveLength(3);
    expect(rollDailies(w, POOL, view(w, T0 + 3_600_000), 0)).toBe(w); // same day: nothing changes
    const care = POOL.find((q) => q.id === today.offered[0])!;
    expect(questStatus(care, w, view(w))).toBe("active");
    const idx = care.objectives[0]!.cond.index as string;
    w = bump(w, "CARE", idx, 1);
    expect(questStatus(care, w, view(w))).toBe("ready");
    w = ok(completeQuest(w, care, view(w))).world;
    expect(questStatus(care, w, view(w))).toBe("done");
    expect(w.quests!.days).toEqual([today.day]);
    // the next day: fresh dailies, yesterday's kept in the history
    const next = rollDailies(w, POOL, view(w, T0 + DAY), 0);
    expect(next.quests!.today!.day).toBe(localDay(T0 + DAY, 0));
    expect(next.quests!.today!.done).toEqual([]);
    expect(next.quests!.days).toEqual([today.day]);
    // a quest not offered today is not open
    const notToday = POOL.find((q) => !next.quests!.today!.offered.includes(q.id))!;
    expect(questStatus(notToday, next, view(next, T0 + DAY))).toBe("locked");
  });

  it("never hands out an earlier day's dailies again when the clock goes back (P1)", () => {
    let w = rollDailies(newWorld("seed"), POOL, view(newWorld("seed"), T0 + DAY), 0);
    const today = w.quests!.today!;
    // the clock turned back a day: today's set stays, nothing new is offered
    expect(rollDailies(w, POOL, view(w, T0), 0)).toBe(w);
    w = rollDailies(w, POOL, view(w, T0 + 2 * DAY), 0);
    expect(w.quests!.today!.day).not.toBe(today.day);
  });

  it("an unfinished daily lapses with its day and costs nothing", () => {
    let w = rollDailies(newWorld("seed"), POOL, view(newWorld("seed")), 0);
    const first = w.quests!.today!.offered;
    w = rollDailies(w, POOL, view(w, T0 + 2 * DAY), 0);
    for (const id of first) if (!w.quests!.today!.offered.includes(id)) expect(w.quests!.active[id]).toBeUndefined();
    expect(w.quests!.days ?? []).toEqual([]);
  });

  it("any seven days with a daily done earn a weekly gift, never a streak", () => {
    let w = newWorld("seed");
    // seven days, with gaps between them
    for (const d of [0, 1, 3, 4, 8, 9, 15]) {
      const at = T0 + d * DAY;
      w = rollDailies(w, POOL, view(w, at), 0);
      const q = POOL.find((x) => x.id === w.quests!.today!.offered[0])!;
      w = bump(w, "CARE", q.objectives[0]!.cond.index as string, 1);
      w = ok(completeQuest(w, q, view(w, at))).world;
    }
    expect(weeklyGiftsWaiting(w)).toBe(1);
    const coins = w.coins;
    w = ok(claimWeekly(w, [{ kind: "coins", n: 50 }])).world;
    expect(w.coins).toBe(coins + 50);
    expect(weeklyGiftsWaiting(w)).toBe(0);
    expect(claimWeekly(w, [{ kind: "coins", n: 50 }])).toEqual({ ok: false, reason: "none" });
  });
});
