/**
 * Quests in the game (plan 4.2): the view the conditions read, gathered from the live stores; taking, handing in
 * and dropping quests; today's dailies; and the notes that say a quest has opened or is ready to hand in. The
 * rules themselves live in @lingxi/world (story.ts); this module only feeds them and keeps the world saved.
 */

import { useMemo } from "react";
import { create } from "zustand";
import { timeOfDay } from "@lingxi/brain";
import { bondLevel, growthOf, localHour, needsMinOf, stageOf } from "@lingxi/game";
import {
  type ConditionView,
  DAILIES,
  QUESTLINE,
  QUEST_BY_ID,
  type QuestDef,
  type QuestStatus,
  type Reward,
  STORY,
  WEEKLY_GIFT,
  acceptQuest,
  claimWeekly,
  completeQuest,
  dropQuest,
  localDay,
  questStatus,
  rollDailies,
} from "@lingxi/world";
import { useBadges } from "./badges";
import { useChain } from "./chain";
import { bondsOf, useFriends } from "./friends";
import { play } from "./sound";
import { useGame } from "./store";
import { useWorld } from "./world";
import { goalsDone, useGoals } from "./goals";
import { now as gameNow } from "./gameClock";

const tzOffset = () => useGame.getState().pet?.tzOffsetMin ?? -new Date(gameNow()).getTimezoneOffset();

/** Every store a quest condition reads: the inputs of `conditionViewFrom`. */
export interface ConditionInputs {
  world: ReturnType<typeof useWorld.getState>["world"];
  pet: ReturnType<typeof useGame.getState>["pet"];
  pets: ReturnType<typeof useGame.getState>["pets"];
  ledger: ReturnType<typeof useBadges.getState>["ledger"];
  friends: ReturnType<typeof useFriends.getState>["all"];
  onChain: boolean;
  goalsDone: string[];
  now: number;
}

/** Everything a condition reads, from the inputs given. */
export function conditionViewFrom(i: ConditionInputs): ConditionView {
  const { pet, now } = i;
  const stage = pet ? stageOf(pet, now) : null;
  const bonds = pet ? Object.values(bondsOf(i.friends, pet.bornAt)) : [];
  return {
    world: i.world,
    pet: pet && stage ? { level: growthOf(pet).level, stage, onChain: i.onChain, needsMin: needsMinOf(pet) } : null,
    pets: Math.max(i.pets.length, i.ledger.pets ?? 0),
    now,
    timeOfDay: pet ? (timeOfDay(localHour(pet, Math.floor(now / 60_000))) as 0 | 1 | 2 | 3) : 2,
    day: localDay(now, pet?.tzOffsetMin ?? -new Date(now).getTimezoneOffset()),
    bondLevel: bonds.reduce((m, b) => Math.max(m, bondLevel(b.points)), 0),
    goalsDone: i.goalsDone,
  };
}

/** Everything a condition reads, from the stores as they are right now. */
export function conditionView(now = gameNow()): ConditionView {
  const { pet, pets } = useGame.getState();
  return conditionViewFrom({ world: useWorld.getState().world, pet, pets, ledger: useBadges.getState().ledger, friends: useFriends.getState().all, onChain: useChain.getState().record !== null, goalsDone: goalsDone(), now });
}

export const statusOf = (q: QuestDef, v = conditionView()): QuestStatus => questStatus(q, useWorld.getState().world, v);

/** Where a giver can be found: a resident's room, Builders' Lane, or the pet itself. */
export const giverRoom: Readonly<Record<string, number>> = { wick: 64, praline: 13, yonder: 3, bolt: 5, flit: 56, why: 59, jab: 89, twain: 19, nimbus: 53 };

export interface QuestNote {
  id: number;
  quest: string;
  /** a quest that opened, became ready or was handed in; or a community goal with something to take (quest = goal id) */
  kind: "new" | "ready" | "done" | "goal";
  rewards?: readonly Reward[];
}

interface QuestUi {
  /** a quest that just opened, became ready, or was handed in: one toast at a time, the rest wait their turn */
  note: QuestNote | null;
  queue: QuestNote[];
  push: (n: Omit<QuestNote, "id">) => void;
  dismiss: () => void;
  /** the quest whose card is open from the pet's bubble or the book */
  open: string | null;
  setOpen: (id: string | null) => void;
  /** the book's tab to show when it next opens (a goal's toast opens Together) */
  bookTab: "story" | "today" | "together" | "milestones" | null;
  setBookTab: (t: QuestUi["bookTab"]) => void;
}

let noteId = 0;
export const useQuestUi = create<QuestUi>((set, get) => ({
  note: null,
  queue: [],
  push: (n) => {
    const next = { ...n, id: ++noteId };
    if (get().note) set({ queue: [...get().queue, next].slice(-4) });
    else set({ note: next });
  },
  dismiss: () => {
    const [head, ...rest] = get().queue;
    set({ note: head ?? null, queue: rest });
  },
  open: null,
  setOpen: (open) => set({ open }),
  bookTab: null,
  setBookTab: (bookTab) => set({ bookTab }),
}));

/** Take a quest on. The giver's own rules decide where (a resident's talk, the pet's bubble, a lane card). */
export function takeQuest(id: string): boolean {
  const q = QUEST_BY_ID[id];
  if (!q) return false;
  const r = acceptQuest(useWorld.getState().world, q, conditionView());
  if (!r.ok) return false;
  useWorld.getState().setWorld(r.world);
  play("pop");
  return true;
}

/** Hand a ready quest in: its rewards are paid and the toast says what came. */
export function handIn(id: string): readonly Reward[] | null {
  const q = QUEST_BY_ID[id];
  if (!q) return null;
  const r = completeQuest(useWorld.getState().world, q, conditionView());
  if (!r.ok) return null;
  useWorld.getState().setWorld(r.world);
  play("success");
  useQuestUi.getState().push({ quest: id, kind: "done", rewards: r.rewards });
  return r.rewards;
}

export function putDown(id: string): boolean {
  const q = QUEST_BY_ID[id];
  if (!q) return false;
  const r = dropQuest(useWorld.getState().world, q);
  if (!r.ok) return false;
  useWorld.getState().setWorld(r.world);
  return true;
}

export function takeWeeklyGift(): boolean {
  const r = claimWeekly(useWorld.getState().world, WEEKLY_GIFT);
  if (!r.ok) return false;
  useWorld.getState().setWorld(r.world);
  play("sparkle");
  return true;
}

/** Start today's dailies the first time today is seen (and again after midnight while the game is open). */
export function rollToday(): void {
  if (!useGame.getState().pet) return;
  const w = useWorld.getState().world;
  const next = rollDailies(w, DAILIES, conditionView(), tzOffset());
  if (next !== w) useWorld.getState().setWorld(next);
}

/** Every quest's status, for the book, the markers and the notes. */
export function allStatuses(v = conditionView()): Record<string, QuestStatus> {
  return Object.fromEntries(QUESTLINE.map((q) => [q.id, questStatus(q, v.world, v)]));
}

/**
 * Every quest's status on screen, kept current with every store a condition reads (P2): a quest that waits on a badge,
 * a friendship, a chain record or a community goal changes the moment that does, not at the pet's next beat.
 */
export function useQuestStatuses(): Record<string, QuestStatus> {
  const world = useWorld((s) => s.world);
  const pet = useGame((s) => s.pet);
  const pets = useGame((s) => s.pets);
  const ledger = useBadges((s) => s.ledger);
  const friends = useFriends((s) => s.all);
  const onChain = useChain((s) => s.record !== null);
  const reports = useGoals((s) => s.reports);
  return useMemo(() => {
    const done = goalsDone(reports);
    return allStatuses(conditionViewFrom({ world, pet, pets, ledger, friends, onChain, goalsDone: done, now: gameNow() }));
  }, [world, pet, pets, ledger, friends, onChain, reports]);
}

/** Quests a giver has for you now: ones to offer, and ones to take back. */
export function questsOf(giver: string, statuses = allStatuses()): { offer: QuestDef[]; ready: QuestDef[]; active: QuestDef[] } {
  const mine = STORY.filter((q) => q.giver === giver);
  return {
    offer: mine.filter((q) => statuses[q.id] === "available"),
    ready: mine.filter((q) => statuses[q.id] === "ready"),
    active: mine.filter((q) => statuses[q.id] === "active"),
  };
}

/**
 * Notes when a story quest opens or becomes ready. Statuses are recomputed when the world or the pet changes,
 * at most every few hundred milliseconds, and compared with the last ones; the first look after loading only
 * records them, so a reload never repeats old news.
 */
let last: Record<string, QuestStatus> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
function recheck(): void {
  timer = null;
  if (!useGame.getState().pet) return;
  rollToday();
  const now = allStatuses();
  if (last) {
    for (const q of STORY) {
      const was = last[q.id];
      const is = now[q.id];
      if (was === is) continue;
      if (is === "available" && was === "locked") useQuestUi.getState().push({ quest: q.id, kind: "new" });
      else if (is === "ready" && was === "active") useQuestUi.getState().push({ quest: q.id, kind: "ready" });
    }
  }
  last = now;
}
const schedule = () => {
  if (!timer) timer = setTimeout(recheck, 400);
};
useWorld.subscribe(schedule);
useGame.subscribe(schedule);
useChain.subscribe(schedule);
if (typeof window !== "undefined") {
  schedule();
  // dailies roll over at local midnight even if the game stays open
  setInterval(schedule, 60_000);
}
