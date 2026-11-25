/**
 * How a simulated player follows its quests and errands (P7: out of the Life class in life.ts): which quest to take,
 * what each objective asks of the day and how the player meets it, and the care a quest asks for.
 */
/**
 * One simulated player's pet and world, and every move a player can make on them, each through the game's own rules:
 * the pet's beats, care and teaching (@lingxi/game), the world's moves, finds, shop and quests (@lingxi/world). The
 * player types (players.ts) decide when and how often to make these moves; nothing here decides balance.
 *
 * Each move does what the web client does with the same rule (apps/web/src/game/store.ts and world.ts): a care is
 * `care` and then its tally, a food from the bag is `take` and then `care` feed, a walk is `move` and then `exert`,
 * a lesson is `teach` and then one "talk" beat, a return is `catchUp` with the away surprises and `settleForm`.
 */

import { timeOfDay } from "@lingxi/brain";
import {
  DAILIES,
  ITEM,
  RECIPES,
  ROOMS,
  STORY,
  WEEKLY_GIFT,
  HOME,
  type Condition,
  TIMES_OF_DAY,
  acceptQuest,
  craft,
  giveTo,
  has,
  claimWeekly,
  completeQuest,
  craftBlocker,
  neighbours,
  questProgress,
  questStatus,
  rollDailies,
  weeklyGiftsWaiting,
} from "@lingxi/world";
import { dayOf, type Partner, work, beatOf, localHour } from "../../src";
import { GIVER_ROOM, meetTally, talkTally, viewOf } from "./client";
import type { Life } from "./life";

/**
 * Quests as a player who opens the book each visit: today's dailies rolled, the weekly gift taken, every ready
 * quest handed in and every open story quest taken. (Handing in is done from the book, not at the giver's door.)
 */
export function followQuests(life: Life, t: number): void {
  life.flush();
  const tz = life.pet.tzOffsetMin;
  // D9: as the web does, no daily behind a part not open yet (the map and bag on the pet's day 2, spars on day 3)
  const petDay = dayOf(life.pet, t);
  const closed = (
    [
      ["map", 2],
      ["bag", 2],
      ["spar", 3],
    ] as const
  )
    .filter(([, d]) => petDay < d)
    .map(([p]) => p);
  life.world = rollDailies(life.world, DAILIES, viewOf(life.world, life.pet, t), tz, closed);
  if (weeklyGiftsWaiting(life.world) > 0) {
    const r = claimWeekly(life.world, WEEKLY_GIFT);
    if (r.ok) life.world = r.world;
  }
  for (let changed = true, guard = 0; changed && guard < 20; guard++) {
    changed = false;
    for (const q of [...DAILIES, ...STORY]) {
      const v = viewOf(life.world, life.pet, t);
      const s = questStatus(q, life.world, v);
      const r =
        s === "ready"
          ? completeQuest(life.world, q, v)
          : s === "available" && q.kind === "story"
            ? acceptQuest(life.world, q, v)
            : null;
      if (!r?.ok) continue;
      life.world = r.world;
      changed = true;
    }
  }
}

/**
 * One small errand for a taken quest or today's dailies, of the kinds a player does in a visit without planning a
 * trip: a room within four steps, a step out and back, a look around, a spar, a recipe the bag already allows, a
 * gift of something already held, a word with a resident nearby, a look at Builders' Lane, a meal bought on a shop
 * run. Errands that need a plan (gathering a recipe's inputs, a walk or a trip, a friend) are left undone: the
 * playthrough test is the player who does everything.
 */
export function runErrand(life: Life, t: number, sparWith: () => Partner): boolean {
  life.flush();
  for (const q of [...DAILIES, ...STORY]) {
    if (questStatus(q, life.world, viewOf(life.world, life.pet, t)) !== "active") continue;
    const prog = questProgress(q, life.world, viewOf(life.world, life.pet, t));
    for (const [i, o] of q.objectives.entries()) {
      if (!prog[i]!.met && objective(life, o.cond.type === "ANY" ? (o.cond.of ?? [])[0] : o.cond, t, sparWith))
        return true;
    }
  }
  return false;
}

function objective(life: Life, c: Condition | undefined, t: number, sparWith: () => Partner): boolean {
  if (!c) return false;
  const room = Number(c.index);
  switch (c.type) {
    case "VISIT":
    case "ROOM": {
      if (!ROOMS[room] || life.distance(room) > 4) return false;
      if (c.type === "VISIT" && life.world.room === room) life.step(neighbours(room)[0]!, t);
      const there = life.walkTo(room, t);
      life.walkTo(HOME, t);
      return there;
    }
    case "MOVE":
      return life.step(neighbours(life.world.room)[0]!, t) && life.walkTo(HOME, t);
    case "FORAGE":
    case "FIND":
      return c.index === undefined && life.lookAround(t) !== null;
    case "SPAR":
      return life.spar(sparWith(), t).ms > 0;
    case "CRAFT": {
      const r = RECIPES.find(
        (x) =>
          (c.index === undefined || x.out === Number(c.index)) && craftBlocker(life.world, x, life.energy()) === null,
      );
      if (!r || life.pet.asleep) return false;
      const made = craft(life.world, r.index, life.energy());
      if (!made.ok) return false;
      life.world = made.world;
      life.set(work(life.pet, made.energy, made.xp, t, life.brain()));
      return true;
    }
    case "BUY":
      return life.shopForFood(t, 1);
    case "GIVE":
    case "GIVE_TO": {
      const [who, item] =
        c.type === "GIVE_TO"
          ? String(c.index).split(":")
          : ["wick", c.index === undefined ? undefined : String(c.index)];
      const what =
        item !== undefined
          ? Number(item)
          : Object.keys(life.world.bag)
              .map(Number)
              .find((i) => ITEM[i]?.kind === "material");
      if (what === undefined || !has(life.world, what, c.value ?? 1)) return false;
      const r = giveTo(life.world, who!, what, c.value ?? 1);
      if (!r.ok) return false;
      life.world = r.world;
      return true;
    }
    case "TALK": {
      const who = c.index === undefined ? "wick" : String(c.index);
      const at = GIVER_ROOM[who];
      if (at === undefined || life.distance(at) > 4 || !life.walkTo(at, t)) return false;
      life.note(talkTally(who));
      life.walkTo(HOME, t);
      return true;
    }
    case "CARE":
      return careFor(life, String(c.index), t);
    case "MEET":
      life.note(meetTally(c.index === undefined ? "behemoth" : String(c.index), t, life.pet.tzOffsetMin));
      return true;
    default:
      return false;
  }
}

/** A care a quest asks for by name ("feed", "sleep", "wake-morning"…), when the time of day it names is now. */
function careFor(life: Life, index: string, t: number): boolean {
  const [kind, time] = index.split("-") as [string, string | undefined];
  if (time && TIMES_OF_DAY[timeOfDay(localHour(life.pet, beatOf(t)))] !== time) return false;
  if (kind === "feed") return life.feed(t);
  if (kind === "sleep") return !life.pet.asleep && life.care({ kind: "lightsOff" }, t).note === "sleeping";
  if (kind === "wake") {
    if (!life.pet.asleep) life.care({ kind: "lightsOff" }, t);
    return life.care({ kind: "wake" }, t).note === "awake";
  }
  if (kind === "play" || kind === "clean" || kind === "pet" || kind === "talk")
    return life.care(kind === "play" ? { kind, stars: 2 } : { kind }, t).note !== "tooTired";
  return false;
}
