import { describe, expect, it } from "vitest";
import {
  FRIENDS,
  FRIEND_BY_ID,
  GIFT_TRUST,
  LEVEL_NAMES,
  type WorldState,
  buyFromFriend,
  craft,
  friendErrors,
  friendLevel,
  giveGift,
  meetVisitor,
  newWorld,
  nextLevel,
  openSteps,
  shelfOf,
  stepState,
  takeStep,
  topicsOf,
  trustOf,
  visitorOf,
} from "../src";

const praline = FRIEND_BY_ID.praline!;
const behemoth = FRIEND_BY_ID.behemoth!;
const withTrust = (w: WorldState, who: string, n: number): WorldState => ({ ...w, trust: { ...(w.trust ?? {}), [who]: n } });
const withItem = (w: WorldState, item: number, n: number): WorldState => ({ ...w, bag: { ...w.bag, [item]: (w.bag[item] ?? 0) + n } });
const take = (w: WorldState, f = praline, id: string): WorldState => {
  const r = takeStep(w, f, id);
  if (!r.ok) throw new Error(`${id}: ${r.reason}`);
  return r.world;
};

describe("trust levels", () => {
  it("has six named levels at 0, 5, 15, 30, 50 and 80 points", () => {
    expect(LEVEL_NAMES).toHaveLength(6);
    expect([0, 4, 5, 14, 15, 29, 30, 49, 50, 79, 80, 500].map(friendLevel)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });
});

describe("gifts", () => {
  it("raise trust by taste, with only the day's first gift counting", () => {
    let w = withItem(withItem(newWorld("g"), 11313, 2), 1201, 300);
    const love = giveGift(w, praline, 11313, "2026-11-20");
    if (!love.ok) throw new Error(love.reason);
    expect([love.taste, love.trust]).toEqual(["love", GIFT_TRUST.love]);
    w = love.world;
    expect(trustOf(w, "praline")).toBe(4);
    // a second gift the same day leaves the bag and counts for errands, but adds no trust
    const again = giveGift(w, praline, 1201, "2026-11-20");
    if (!again.ok) throw new Error(again.reason);
    expect([again.taste, again.trust]).toEqual(["like", 0]);
    expect(again.world.bag[1201]).toBe(299);
    expect(again.world.tally?.["GIVE_TO:praline"]).toBe(2);
    expect(trustOf(again.world, "praline")).toBe(4);
    // the next day it counts again
    const next = giveGift(again.world, praline, 11313, "2026-11-21");
    expect(next.ok && trustOf(next.world, "praline")).toBe(8);
  });

  it("are politely refused when disliked: the item stays and the taste is remembered", () => {
    const w = withItem(newWorld("g"), 1001, 1);
    const r = giveGift(w, praline, 1001, "2026-11-20");
    if (!r.ok) throw new Error(r.reason);
    expect([r.taste, r.trust]).toEqual(["dislike", 0]);
    expect(r.world.bag[1001]).toBe(1);
    expect(r.world.friends?.known.praline).toEqual([1001]);
    expect(trustOf(r.world, "praline")).toBe(0);
  });

  it("give a neutral thing +1, and refuse what is not in the bag", () => {
    const w = withItem(newWorld("g"), 1002, 1);
    const r = giveGift(w, praline, 1002, "d");
    expect(r.ok && [r.taste, r.trust]).toEqual(["neutral", 1]);
    expect(giveGift(newWorld("g"), praline, 11311, "d")).toEqual({ ok: false, reason: "missing" });
  });

  it("work for a Builders' Lane pet too", () => {
    const r = giveGift(withItem(newWorld("g"), 1303, 1), behemoth, 1303, "d");
    expect(r.ok && [r.taste, trustOf(r.world, "behemoth")]).toEqual(["love", 4]);
  });
});

describe("friendship steps", () => {
  it("open one level at a time, each after the one before", () => {
    let w = newWorld("s");
    expect(openSteps(w, praline).map((s) => s.id)).toEqual(["praline-1"]);
    w = take(w, praline, "praline-1");
    expect(stepState(w, praline, praline.steps[1]!)).toBe("trust");
    w = withTrust(w, "praline", 5);
    expect(openSteps(w, praline).map((s) => s.id)).toEqual(["praline-2"]);
    // a later step is waiting for an earlier one before it waits for trust
    expect(takeStep(w, praline, "praline-4")).toEqual({ ok: false, reason: "earlier" });
  });

  it("make level 3 a branch: either road can be taken, and taking one shuts the other for good", () => {
    let w = withTrust(newWorld("b"), "praline", 15);
    w = take(take(w, praline, "praline-1"), praline, "praline-2");
    expect(openSteps(w, praline).map((s) => s.id).sort()).toEqual(["praline-3a", "praline-3b"]);
    // road A: the shelf
    const a = take(w, praline, "praline-3a");
    expect(stepState(a, praline, praline.steps.find((s) => s.id === "praline-3b")!)).toBe("shut");
    expect(takeStep(a, praline, "praline-3b")).toEqual({ ok: false, reason: "shut" });
    expect(shelfOf(a, praline)).toEqual([{ item: 11110, price: 25 }]);
    // road B, from the same start: the recipe, and no shelf
    const b = take(w, praline, "praline-3b");
    expect(stepState(b, praline, praline.steps.find((s) => s.id === "praline-3a")!)).toBe("shut");
    expect(b.recipes).toContain(20005);
    expect(shelfOf(b, praline)).toEqual([]);
    // both roads lead on to level 4
    for (const x of [a, b]) expect(stepState(withTrust(x, "praline", 30), praline, praline.steps.find((s) => s.id === "praline-4")!)).toBe("open");
  });

  it("open what each step promises: topics, the shelf, a working recipe, gifts, a visit, a keepsake", () => {
    let w = withTrust(newWorld("u"), "praline", 80);
    w = take(w, praline, "praline-1");
    expect(topicsOf(w, praline).map((t) => t.ask.en)).toEqual(["About Byakuya"]);
    const before = w.bag[11130] ?? 0;
    w = take(w, praline, "praline-2");
    expect(w.bag[11130]).toBe(before + 2);
    w = take(w, praline, "praline-3b");
    // the taught recipe really makes the thing
    const made = craft(withItem(withItem(w, 7201, 2), 1201, 100), 20005);
    expect(made.ok && made.world.bag[11110]).toBe((w.bag[11110] ?? 0) + 2);
    w = take(take(w, praline, "praline-4"), praline, "praline-5");
    expect(topicsOf(w, praline)).toHaveLength(2);
    expect(visitorOf(w)).toBe("praline");
    // the visitor waits at home until met, then leaves a decoration and goes
    const met = meetVisitor(w, praline);
    if (!met.ok) throw new Error(met.reason);
    expect(met.world.decor?.owned).toContain("rug");
    expect(visitorOf(met.world)).toBeNull();
    expect(meetVisitor(met.world, praline)).toEqual({ ok: false, reason: "notVisiting" });
    const last = take(met.world, praline, "praline-6");
    expect(last.wardrobe?.owned).toContain("bow");
    expect(openSteps(last, praline)).toEqual([]);
    expect(nextLevel(last, praline)).toBeNull();
  });

  it("sell from the shelf for coins", () => {
    let w = withTrust(newWorld("shop"), "praline", 15);
    w = take(take(take(w, praline, "praline-1"), praline, "praline-2"), praline, "praline-3a");
    const r = buyFromFriend({ ...w, coins: 30 }, praline, 11110);
    expect(r.ok && [r.world.coins, r.world.bag[11110]]).toEqual([5, (w.bag[11110] ?? 0) + 1]);
    expect(buyFromFriend({ ...w, coins: 10 }, praline, 11110)).toEqual({ ok: false, reason: "coins" });
    expect(buyFromFriend(w, praline, 11313)).toEqual({ ok: false, reason: "notSold" });
  });

  it("let every friend be walked to level 6 down either branch", () => {
    for (const f of FRIENDS) {
      for (const road of ["3a", "3b"]) {
        let w = withTrust(newWorld(f.id), f.id, 80);
        for (const k of ["1", "2", road, "4", "5", "6"]) w = take(w, f, `${f.id}-${k}`);
        expect(openSteps(w, f)).toEqual([]);
      }
    }
  });

  it("queue visitors and let each be met in turn", () => {
    let w = newWorld("v");
    for (const who of ["wick", "praline"]) {
      const f = FRIEND_BY_ID[who]!;
      w = withTrust(w, who, 80);
      for (const k of ["1", "2", "3a", "4", "5"]) w = take(w, f, `${who}-${k}`);
    }
    expect(w.friends?.visits).toEqual(["wick", "praline"]);
    expect(meetVisitor(w, FRIEND_BY_ID.praline!)).toEqual({ ok: false, reason: "notVisiting" });
    const a = meetVisitor(w, FRIEND_BY_ID.wick!);
    expect(a.ok && visitorOf(a.world)).toBe("praline");
  });

  it("say what the next level opens", () => {
    const n = nextLevel(withTrust(newWorld("n"), "praline", 6), praline);
    expect(n).toMatchObject({ level: 3, at: 15 });
    expect(n!.opens.map((s) => s.id)).toEqual(["praline-3a", "praline-3b"]);
  });
});

describe("the friends' content", () => {
  it("passes its own check: all fourteen, six levels each, a branch at 3, every line and item real", () => {
    expect(friendErrors(FRIENDS)).toEqual([]);
    expect(FRIENDS).toHaveLength(14);
  });

  it("is checked: a missing level, a broken branch, a stranger's face and an unreal item are all caught", () => {
    const bad = { ...praline, likes: { ...praline.likes, love: [99999] }, steps: praline.steps.filter((s) => s.level !== 6).map((s) => (s.id === "praline-3a" ? { ...s, not: [] } : s.id === "praline-1" ? { ...s, lines: [{ face: "x.png", en: "hi", zh: "嗨" }] } : s)) };
    const errs = friendErrors([bad, ...FRIENDS.filter((f) => f.id !== "praline")]).join("\n");
    for (const want of ["no item 99999", "level 6 opens nothing", "level 3 must be a branch", "praline has no portrait x.png"]) expect(errs).toContain(want);
  });
});
