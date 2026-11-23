/**
 * Story quests and dailies (plan 4.2), after the source's quest lifecycle (note A §2): a quest is available when
 * its requirements pass, accepted (its INC objectives snapshot), ready when every objective passes, and handed in
 * for its rewards. Differences from the source, each fixing a defect the study found (note A §2.13):
 * - a story quest is done once and stays done; a daily's history is kept per day, never erased by the next day;
 * - dailies follow the player's local calendar day (theirs: 18 hours after the last accept, which drifts);
 * - an active quest can be dropped and taken again fresh (theirs exists on chain but no button ever calls it);
 * - a locked quest can say what opens it (theirs are invisible until available).
 */

import { type Condition, type ConditionView, checkAll, progressOf, snapshotOf, type Progress } from "./conditions";
import { bump, withFlag } from "./tally";
import { type WorldResult, type WorldState, earn, give } from "./world";
import { paidByMilestone } from "./quests";

export interface Text {
  en: string;
  zh: string;
}
/** One line of a quest's dialogue: who says it (a resident's face name, or the pet's expression) and the words. */
export interface QuestLine extends Text {
  face?: string;
}

export type Reward =
  | { kind: "coins"; n: number }
  | { kind: "item"; item: number; n: number }
  | { kind: "trust"; who: string; n: number }
  | { kind: "flag"; name: string }
  | { kind: "piece"; id: string }
  | { kind: "decor"; id: string }
  | { kind: "recipe"; index: number };

export interface Objective {
  text: Text;
  cond: Condition;
}

export interface QuestDef {
  id: string;
  kind: "story" | "daily";
  /** story arc (1 to 12); dailies have a group instead */
  arc?: number;
  /** a daily's slot; "request" is a resident's errand, offered in the social slot every other day (G4) */
  group?: "care" | "social" | "explore" | "request";
  /** "pet", a resident id, or a Builders' Lane resident (`lane:<id>`) */
  giver: string;
  title: Text;
  intro: readonly QuestLine[];
  outro: readonly QuestLine[];
  /** checked when the quest is offered (CURR and BOOL only, as the source) */
  requires: readonly Condition[];
  objectives: readonly Objective[];
  rewards: readonly Reward[];
  /** what opens it, said on a locked card */
  opensWhen?: Text;
  /** for the first quests: the id of the control to point at */
  hint?: string;
  /** D9: the parts of the game a daily sends the player to (the map, the bag), so a day offers none behind a lock */
  needs?: readonly Part[];
}

/** A part of the game that opens on a later day (the web's reveal: the map and bag on day 2, spars on day 3). */
export type Part = "map" | "bag" | "spar";

/**
 * D15: the parts a condition sends the player to, worked out from what it counts rather than a hand-written list.
 * Talking to a resident, meeting one, walking, moving between rooms and time outdoors (home counts as inside) need the
 * map; giving from the bag needs the bag; handing a resident something needs both. Of a choice of ways (ANY), a way that
 * waits on another player (a friend's pet visiting) is not one a player can take alone, so it does not count; the rest
 * need only what they all need.
 */
export function partsOf(c: Condition): Part[] {
  if (c.type === "ANY") {
    const solo = (c.of ?? []).filter((x) => !(x.type === "EVENT" && x.index === "visited-by-friend"));
    if (!solo.length) return [];
    const each = solo.map(partsOf);
    return each[0]!.filter((p) => each.every((e) => e.includes(p)));
  }
  const out = new Set<Part>();
  if (c.type === "TALK" || c.type === "MEET" || c.type === "MOVE" || c.type === "WALK" || c.type === "GIVE_TO") out.add("map");
  if (c.type === "GIVE" || c.type === "GIVE_TO") out.add("bag");
  if (c.type === "TOGETHER_WHEN" && typeof c.index === "string" && c.index.endsWith("-outside")) out.add("map");
  return [...out];
}

/** Every part a quest needs: what its objectives count, and any it names itself. */
export function partsNeeded(q: QuestDef): Part[] {
  return [...new Set<Part>([...(q.needs ?? []), ...q.objectives.flatMap((o) => partsOf(o.cond))])];
}

export interface QuestBook {
  /** accepted and not yet handed in: when, and the snapshot of its INC objectives */
  active: Record<string, { at: number; snap: Record<string, number> }>;
  /** story quests handed in, and when */
  done: Record<string, number>;
  /** today's dailies: the local day they belong to, which were offered, and which were handed in */
  today?: { day: string; offered: string[]; done: string[] };
  /** every local day on which a daily was handed in (for the weekly gift); kept, never cleared */
  days?: string[];
  /** weekly gifts already taken */
  weekly?: number;
}

export const emptyBook = (): QuestBook => ({ active: {}, done: {} });
export const bookOf = (w: WorldState): QuestBook => w.quests ?? emptyBook();

export type QuestStatus = "locked" | "available" | "active" | "ready" | "done";

/** Where a quest stands for this player. A daily counts as done only for the day it was handed in. */
export function questStatus(q: QuestDef, w: WorldState, v: ConditionView): QuestStatus {
  const b = bookOf(w);
  if (q.kind === "story" && b.done[q.id] !== undefined) return "done";
  if (q.kind === "daily" && b.today?.done.includes(q.id)) return "done";
  const a = b.active[q.id];
  if (a) return checkAll(q.objectives.map((o) => o.cond), v, a.snap) ? "ready" : "active";
  if (q.kind === "daily" && !b.today?.offered.includes(q.id)) return "locked";
  return checkAll(q.requires, v) ? "available" : "locked";
}

/** Each objective's progress for a card: counted from the accept for "from now" objectives. */
export function questProgress(q: QuestDef, w: WorldState, v: ConditionView): Progress[] {
  const a = bookOf(w).active[q.id];
  return q.objectives.map((o) => progressOf(o.cond, v, a?.snap ?? {}));
}

/** Take a quest on: its requirements must pass now; its INC objectives start counting from this moment. */
export function acceptQuest(w: WorldState, q: QuestDef, v: ConditionView): WorldResult {
  const s = questStatus(q, w, v);
  if (s !== "available") return { ok: false, reason: s === "locked" ? "locked" : s === "done" ? "done" : "accepted" };
  const b = bookOf(w);
  const snap = snapshotOf(
    q.objectives.map((o) => o.cond),
    v,
  );
  return { ok: true, world: { ...w, quests: { ...b, active: { ...b.active, [q.id]: { at: v.now, snap } } } } };
}

/** Put an accepted quest down; taking it again later starts its counts afresh. Finished quests cannot be dropped. */
export function dropQuest(w: WorldState, q: QuestDef): WorldResult {
  const b = bookOf(w);
  if (!b.active[q.id]) return { ok: false, reason: "notActive" };
  const active = { ...b.active };
  delete active[q.id];
  return { ok: true, world: { ...w, quests: { ...b, active } } };
}

/** Pay one reward into the world. Unknown pieces or decor are the sheet check's job; here they are just added. */
export function payReward(w: WorldState, r: Reward): WorldState {
  switch (r.kind) {
    case "coins":
      return earn(w, r.n);
    case "item":
      return give(w, r.item, r.n);
    case "trust":
      return { ...w, trust: { ...(w.trust ?? {}), [r.who]: (w.trust?.[r.who] ?? 0) + r.n } };
    case "flag":
      return withFlag(w, r.name);
    case "piece": {
      const wd = w.wardrobe ?? { owned: [], worn: {} };
      return wd.owned.includes(r.id) ? w : { ...w, wardrobe: { ...wd, owned: [...wd.owned, r.id] } };
    }
    case "decor": {
      const d = w.decor ?? { owned: [], placed: [] };
      return d.owned.includes(r.id) ? w : { ...w, decor: { ...d, owned: [...d.owned, r.id] } };
    }
    case "recipe": {
      const known = w.recipes ?? [];
      return known.includes(r.index) ? w : { ...w, recipes: [...known, r.index] };
    }
  }
}

/** Hand a ready quest in: every reward is paid once; a story quest is then done for good, a daily for today. */
export function completeQuest(w: WorldState, q: QuestDef, v: ConditionView): WorldResult<{ rewards: readonly Reward[] }> {
  const s = questStatus(q, w, v);
  if (s !== "ready") return { ok: false, reason: s === "done" ? "done" : s === "active" ? "notReady" : "notAccepted" };
  const b = bookOf(w);
  const active = { ...b.active };
  delete active[q.id];
  let book: QuestBook = { ...b, active };
  if (q.kind === "story") book = { ...book, done: { ...b.done, [q.id]: v.now } };
  else {
    const today = b.today!;
    const days = b.days ?? [];
    book = { ...book, today: { ...today, done: [...today.done, q.id] }, days: days.includes(today.day) ? days : [...days, today.day] };
  }
  let next: WorldState = { ...w, quests: book };
  // a deed a milestone already paid for is not paid for in coins again; what the quest opens still opens (B6)
  const paid = q.kind === "story" && paidByMilestone(q.id, w);
  const rewards = paid ? q.rewards.filter((r) => r.kind !== "coins") : q.rewards;
  for (const r of rewards) next = payReward(next, r);
  next = bump(next, q.kind === "story" ? "QUEST_DONE" : "DAILY_DONE", q.id);
  return { ok: true, rewards, world: next };
}

/** The quest to show after this one is handed in: the lowest in the sheet that needs it and can be taken now. */
export function nextInChain(sheet: readonly QuestDef[], done: QuestDef, w: WorldState, v: ConditionView): QuestDef | null {
  return sheet.find((q) => q.requires.some((c) => c.type === "QUEST" && c.index === done.id) && questStatus(q, w, v) === "available") ?? null;
}

/* ── dailies ─────────────────────────────────────────────────────────────── */

export const DAILIES_PER_DAY = 3;
export const WEEKLY_DAYS = 7;

/** The player's local calendar day, "YYYY-MM-DD", from the time and their offset east of UTC in minutes. */
export function localDay(now: number, tzOffsetMin: number): string {
  return new Date(now + tzOffsetMin * 60_000).toISOString().slice(0, 10);
}

/** A small, stable hash of a string (FNV-1a), for choosing the same dailies for the same player and day. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Today's three: one care, one social, one explore, picked from the player's seed and the day. On about half the days
 * the social one is a resident's request instead (G4), so the residents keep asking after their stories end.
 */
export function pickDailies(pool: readonly QuestDef[], seed: string, day: string, closed: readonly Part[] = []): string[] {
  const out: string[] = [];
  // D9: a daily that sends the player to a part not open yet is not offered (a slot with none left stays empty)
  const reachable = (q: QuestDef) => !partsNeeded(q).some((p) => closed.includes(p));
  // about every other day, chosen from the seed and the day rather than by turns, so a player who comes every other
  // day still meets both kinds
  const requestDay = hash(`${seed}:${day}:request`) % 2 === 0 && pool.some((q) => q.group === "request" && reachable(q));
  for (const slot of ["care", "social", "explore"] as const) {
    const g = slot === "social" && requestDay ? "request" : slot;
    const of = pool.filter((q) => q.kind === "daily" && q.group === g && reachable(q));
    if (!of.length) continue;
    // requests go round the residents in turn from a place the seed picks, so each day's asker differs from the last
    const dayNo = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
    out.push(of[g === "request" ? (hash(`${seed}:request`) + dayNo) % of.length : hash(`${seed}:${day}:${g}`) % of.length]!.id);
  }
  return out;
}

/**
 * Start the day's dailies when a new local day is first seen: the three are offered and begin counting at once
 * (no accept tap: missing a day costs nothing, and the day's counts start when the day does). The day before
 * keeps its history in `days`. Seeing the same day again changes nothing.
 */
export function rollDailies(w: WorldState, pool: readonly QuestDef[], v: ConditionView, tzOffsetMin: number, closed: readonly Part[] = []): WorldState {
  const day = localDay(v.now, tzOffsetMin);
  const b = bookOf(w);
  // a day only moves forward: a clock turned back keeps today's dailies rather than offering an earlier day's again; the
  // player's time zone is kept current all the same, so the village follows their own day (D2)
  if (b.today && b.today.day >= day) return w.tz === tzOffsetMin ? w : { ...w, tz: tzOffsetMin };
  const offered = pickDailies(pool, w.seed, day, closed);
  const active = { ...b.active };
  // yesterday's unfinished dailies lapse quietly
  for (const id of b.today?.offered ?? []) delete active[id];
  for (const id of offered) {
    const q = pool.find((x) => x.id === id)!;
    active[id] = {
      at: v.now,
      snap: snapshotOf(
        q.objectives.map((o) => o.cond),
        v,
      ),
    };
  }
  return { ...w, tz: tzOffsetMin, quests: { ...b, active, today: { day, offered, done: [] } } };
}

/** Weekly gifts waiting: one for every seven days with a finished daily, any seven, never a streak. */
export const weeklyGiftsWaiting = (w: WorldState): number => Math.floor((bookOf(w).days?.length ?? 0) / WEEKLY_DAYS) - (bookOf(w).weekly ?? 0);

/** Take one weekly gift. */
export function claimWeekly(w: WorldState, gift: readonly Reward[]): WorldResult {
  if (weeklyGiftsWaiting(w) < 1) return { ok: false, reason: "none" };
  const b = bookOf(w);
  let next: WorldState = { ...w, quests: { ...b, weekly: (b.weekly ?? 0) + 1 } };
  for (const r of gift) next = payReward(next, r);
  return { ok: true, world: next };
}
