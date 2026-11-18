/**
 * Trust and friendship (plan 4.3). Every resident and every Builders' Lane pet is a friend whose trust rises with
 * their quests and with gifts, never falls, and opens something at each of six levels.
 *
 * The steps copy the source's relationship graph (note A §4): a step may need any one of some earlier steps (its
 * whitelist) and none of others (its blacklist), so a pair of steps that blacklist each other is a branch, and a
 * later step that whitelists both is reached by either road. Unlike the source, where nothing read the graph, every
 * step here opens something real: a topic, a shelf, a recipe, a visit, a keepsake.
 */

import { TRUST_LEVELS, trustLevel } from "./conditions";
import { giftTrust } from "./rules";
import { giveTo } from "./giving";
import { type QuestLine, type Reward, type Text, payReward } from "./story";
import type { Topic } from "./characters";
import { ITEM, type WorldResult, type WorldState } from "./world";

/** The six levels, named; trust points at which each begins are TRUST_LEVELS. */
export const LEVEL_NAMES: readonly Text[] = [
  { en: "Stranger", zh: "陌生人" },
  { en: "Acquaintance", zh: "认识" },
  { en: "Friendly", zh: "友好" },
  { en: "Friend", zh: "朋友" },
  { en: "Close friend", zh: "好朋友" },
  { en: "Kindred", zh: "知己" },
];

/** A friend's level from 1 to 6. */
export const friendLevel = (points: number): number => trustLevel(points) + 1;
/** Trust points needed for a level (1 to 6). */
export const pointsFor = (level: number): number => TRUST_LEVELS[Math.max(0, Math.min(5, level - 1))]!;

export type Unlock =
  /** a new topic in their talk */
  | { kind: "topic"; topic: Topic }
  /** something they sell you from now on, for coins */
  | { kind: "shelf"; item: number; price: number }
  /** a recipe they teach you (a travel recipe) */
  | { kind: "recipe"; index: number }
  /** a resident comes to your home and, when you meet them there, leaves these */
  | { kind: "visit"; rewards: readonly Reward[]; lines: readonly QuestLine[] }
  /** something given at once */
  | { kind: "gift"; rewards: readonly Reward[] };

export interface FriendStep {
  id: string;
  /** the level (1 to 6) at which it opens */
  level: number;
  /** needs any one of these steps first (empty: none) */
  after?: readonly string[];
  /** shut for good once any of these is taken */
  not?: readonly string[];
  /** on a branch, the choice's words */
  choice?: Text;
  title: Text;
  lines: readonly QuestLine[];
  unlock: Unlock;
}

export type Taste = "love" | "like" | "neutral" | "dislike";

export interface FriendSheet {
  id: string;
  /** "resident" talks in a room; "lane" is a Builders' Lane pet with a card */
  kind: "resident" | "lane";
  likes: { love: readonly number[]; like: readonly number[]; dislike: readonly number[] };
  /** what they say to a gift of each kind */
  reactions: Readonly<Record<Taste, QuestLine>>;
  steps: readonly FriendStep[];
}

/** Trust a gift adds, by taste; only the day's first gift to a friend adds it. */
/** Points a first gift of the day adds, by taste, read from the trust circuit (rules.ts). */
export const GIFT_TRUST: Readonly<Record<Taste, number>> = { love: giftTrust("love", false).points, like: giftTrust("like", false).points, neutral: giftTrust("neutral", false).points, dislike: 0 };

export interface FriendsState {
  /** steps taken, per friend */
  steps: Record<string, string[]>;
  /** the local day of the last gift that raised trust, per friend */
  gifted: Record<string, string>;
  /** items whose taste you know, per friend */
  known: Record<string, number[]>;
  /** residents on their way to your home, in the order they were asked; each stays until met */
  visits: string[];
  /** the last gift offered to each friend, refused ones too: its local day and taste (their greeting reads it) */
  lastGift?: Record<string, { day: string; taste: Taste }>;
}

export const friendsOf = (w: WorldState): FriendsState => w.friends ?? { steps: {}, gifted: {}, known: {}, visits: [] };
export const trustOf = (w: WorldState, who: string): number => w.trust?.[who] ?? 0;
export const stepsTaken = (w: WorldState, who: string): readonly string[] => friendsOf(w).steps[who] ?? [];

export function tasteOf(sheet: FriendSheet, item: number): Taste {
  if (sheet.likes.love.includes(item)) return "love";
  if (sheet.likes.like.includes(item)) return "like";
  if (sheet.likes.dislike.includes(item)) return "dislike";
  return "neutral";
}

/** A step's state: taken, open now, shut by a branch taken, or waiting for trust or an earlier step. */
export type StepState = "taken" | "open" | "shut" | "trust" | "earlier";

export function stepState(w: WorldState, sheet: FriendSheet, step: FriendStep): StepState {
  const taken = stepsTaken(w, sheet.id);
  if (taken.includes(step.id)) return "taken";
  if (step.not?.some((s) => taken.includes(s))) return "shut";
  if (step.after?.length && !step.after.some((s) => taken.includes(s))) return "earlier";
  if (friendLevel(trustOf(w, sheet.id)) < step.level) return "trust";
  return "open";
}

export const openSteps = (w: WorldState, sheet: FriendSheet): FriendStep[] => sheet.steps.filter((s) => stepState(w, sheet, s) === "open");

/** Take a step: it is recorded and what it opens is opened (a gift paid, a recipe learned, a visit set off). */
export function takeStep(w: WorldState, sheet: FriendSheet, stepId: string): WorldResult<{ unlock: Unlock }> {
  const step = sheet.steps.find((s) => s.id === stepId);
  if (!step) return { ok: false, reason: "noStep" };
  const st = stepState(w, sheet, step);
  if (st !== "open") return { ok: false, reason: st };
  const f = friendsOf(w);
  let next: WorldState = { ...w, friends: { ...f, steps: { ...f.steps, [sheet.id]: [...(f.steps[sheet.id] ?? []), step.id] } } };
  const u = step.unlock;
  if (u.kind === "gift") for (const r of u.rewards) next = payReward(next, r);
  if (u.kind === "recipe") next = payReward(next, { kind: "recipe", index: u.index });
  if (u.kind === "visit") {
    const nf = friendsOf(next);
    next = { ...next, friends: { ...nf, visits: nf.visits.includes(sheet.id) ? nf.visits : [...nf.visits, sheet.id] } };
  }
  return { ok: true, world: next, unlock: u };
}

/**
 * Give a friend a gift. A disliked thing is refused and stays in the bag. Anything else leaves the bag (and counts
 * for errands, as any gift does); the day's first gift to this friend raises trust by its taste.
 */
export function giveGift(w: WorldState, sheet: FriendSheet, item: number, day: string): WorldResult<{ taste: Taste; trust: number }> {
  if (!ITEM[item]) return { ok: false, reason: "noItem" };
  if (!((w.bag[item] ?? 0) > 0)) return { ok: false, reason: "missing" };
  const taste = tasteOf(sheet, item);
  const f = friendsOf(w);
  const known = f.known[sheet.id] ?? [];
  const learnt: FriendsState = { ...f, known: { ...f.known, [sheet.id]: known.includes(item) ? known : [...known, item] }, lastGift: { ...(f.lastGift ?? {}), [sheet.id]: { day, taste } } };
  if (giftTrust(taste, false).refused) return { ok: true, world: { ...w, friends: learnt }, taste, trust: 0 };
  const given = giveTo(w, sheet.id, item, 1);
  if (!given.ok) return given;
  // the day's first gift counts, and only for a day after the last one counted (a clock turned back adds nothing)
  const last = learnt.gifted[sheet.id];
  const counts = !last || day > last;
  const trust = giftTrust(taste, !counts).points;
  const friends: FriendsState = counts ? { ...learnt, gifted: { ...learnt.gifted, [sheet.id]: day } } : learnt;
  const world: WorldState = { ...given.world, friends, trust: trust ? { ...(given.world.trust ?? {}), [sheet.id]: trustOf(given.world, sheet.id) + trust } : given.world.trust };
  return { ok: true, world, taste, trust };
}

/** Topics a friend has opened, in the order the steps were taken. */
export function topicsOf(w: WorldState, sheet: FriendSheet): Topic[] {
  const taken = stepsTaken(w, sheet.id);
  return sheet.steps.filter((s) => taken.includes(s.id) && s.unlock.kind === "topic").map((s) => (s.unlock as { topic: Topic }).topic);
}

/** What a friend sells you now. */
export function shelfOf(w: WorldState, sheet: FriendSheet): Array<{ item: number; price: number }> {
  const taken = stepsTaken(w, sheet.id);
  return sheet.steps.filter((s) => taken.includes(s.id) && s.unlock.kind === "shelf").map((s) => ({ item: (s.unlock as { item: number }).item, price: (s.unlock as { price: number }).price }));
}

export function buyFromFriend(w: WorldState, sheet: FriendSheet, item: number): WorldResult {
  const offer = shelfOf(w, sheet).find((o) => o.item === item);
  if (!offer) return { ok: false, reason: "notSold" };
  if (w.coins < offer.price) return { ok: false, reason: "coins" };
  return { ok: true, world: { ...w, coins: w.coins - offer.price, bag: { ...w.bag, [item]: (w.bag[item] ?? 0) + 1 } } };
}

/** The resident visiting your home now, if any: the first one asked who has not yet been met. */
export const visitorOf = (w: WorldState): string | null => friendsOf(w).visits[0] ?? null;

/** Meet the visitor at home: their keepsake is paid and they go home. */
export function meetVisitor(w: WorldState, sheet: FriendSheet): WorldResult<{ rewards: readonly Reward[]; lines: readonly QuestLine[] }> {
  if (visitorOf(w) !== sheet.id) return { ok: false, reason: "notVisiting" };
  const step = sheet.steps.find((s) => s.unlock.kind === "visit" && stepsTaken(w, sheet.id).includes(s.id));
  if (!step || step.unlock.kind !== "visit") return { ok: false, reason: "noVisit" };
  const f = friendsOf(w);
  let next: WorldState = { ...w, friends: { ...f, visits: f.visits.slice(1) } };
  for (const r of step.unlock.rewards) next = payReward(next, r);
  return { ok: true, world: next, rewards: step.unlock.rewards, lines: step.unlock.lines };
}

/** The next level's points and the steps it opens, for the Friends list. */
export function nextLevel(w: WorldState, sheet: FriendSheet): { level: number; at: number; opens: FriendStep[] } | null {
  const lvl = friendLevel(trustOf(w, sheet.id));
  if (lvl >= 6) return null;
  return { level: lvl + 1, at: pointsFor(lvl + 1), opens: sheet.steps.filter((s) => s.level === lvl + 1 && stepState(w, sheet, s) !== "shut") };
}
