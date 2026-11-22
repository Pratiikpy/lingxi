/**
 * The five players the plan names (38-PLAN-GAME-DESIGN.md section 1), each a schedule of visits and a way of
 * spending them, and the day-by-day numbers each one's 90 days come to.
 *
 * Every player cares the same honest way when it visits (careFor): food from the bag while the pet is hungry,
 * meals bought at Praline's when the bag is empty and the coins and the pet's legs allow, a bath when dusty, a game
 * when low, a pat, medicine when ill, lights out at night. It teaches the school lessons in order as the pet has room,
 * spends every level and skill point, opens the quest book, looks around at home and runs one small errand. What
 * differs is when it comes and what it does with the rest of the visit: watch, tap, or spar.
 */

import type { StarterLine } from "@lingxi/brain";
import { HOME, ROOMS } from "@lingxi/world";
import { DAY_MS, PARTNERS, type Partner, type PlayerDay, type PlayerNumbers, type PlayerType, type Tree, dailyPartnerIndex, dayIndex, growthOf, stageOf, worldSeasonAt } from "../../src";
import { Life, MIN, costOfEverything } from "./life";

/** China's clock (UTC+8): the first audience. Day 1 is a Monday. */
export const TZ = 480;
export const DAY1 = Date.UTC(2026, 10, 23) - TZ * MIN;
/** Everyone hatches their egg on the morning of day 1 and stays ten minutes. */
const HATCH_HOUR = 8;
const HATCH_MINUTES = 10;
/** A tapper's pace: a tap a second, kept up for a whole session (nothing in the rules slows it). */
export const TAPS_PER_MINUTE = 60;
/** Errands a player runs at each stop of a visit. */
const ERRANDS = 3;
/** A long visit stops every half hour to look after the pet again. */
const CARE_EVERY = 30;

/**
 * Every way a tapper can turn taps into care (B8): pats and words, a mini-game played for three stars, a bath, a meal.
 * Each is run as its own tapper, so level-not-by-tapping holds against the fastest, not just against pats.
 */
export const TAP_PATHS = ["petTalk", "play3", "clean", "feed"] as const;
export type TapPath = (typeof TAP_PATHS)[number];

/** One tap down a path. A meal tap feeds from the bag and buys food when it runs out, as a determined player would. */
function tapOnce(life: Life, path: TapPath, k: number, t: number): void {
  if (path === "petTalk") life.care({ kind: k % 2 ? "talk" : "pet" }, t);
  else if (path === "play3") life.care({ kind: "play", stars: 3 }, t);
  else if (path === "clean") life.care({ kind: "clean" }, t);
  else if (!life.feed(t)) {
    life.shopForFood(t);
    life.feed(t);
  }
}

interface PlayerSpec {
  line: StarterLine;
  /** visits as [local hour, minutes], by weekday (0 Monday … 6 Sunday) */
  visits: (weekday: number) => Array<[number, number]>;
  trees: readonly Tree[];
  /** what fills each minute of a visit, beyond watching */
  minute?: "tap" | "spar";
  /** for a tapper: which taps (pats and words unless said) */
  tap?: TapPath;
}

const CARE_FIRST: Tree[] = ["care", "mind", "explore", "spar"];
export const PLAYERS: Record<PlayerType, PlayerSpec> = {
  once: { line: "gentle", visits: () => [[19, 15]], trees: CARE_FIRST },
  three: { line: "gentle", visits: () => [[8, 5], [13, 5], [21, 5]], trees: CARE_FIRST },
  weekend: { line: "gentle", visits: (wd) => (wd >= 5 ? [] : [[19, 15]]), trees: CARE_FIRST },
  tapper: { line: "gentle", visits: () => [[12, 60], [20, 60]], trees: CARE_FIRST, minute: "tap" },
  grinder: { line: "gentle", visits: () => [[12, 60], [20, 60]], trees: ["spar", "care", "mind", "explore"], minute: "spar" },
};

/** The care a player gives at the start of a visit and every half hour of a long one. */
function careFor(life: Life, t: number, hour: number): void {
  const p = () => life.pet;
  if (p().hibernating && !life.feed(t)) life.care({ kind: "pet" }, t);
  if (p().sick) life.care({ kind: "medicine" }, t);
  for (let i = 0; i < 4 && life.food() < 650; i++) if (!life.feed(t)) break;
  if (life.bestFood() === null && life.food() < 700) {
    life.shopForFood(t);
    for (let i = 0; i < 4 && life.food() < 650; i++) if (!life.feed(t)) break;
  }
  if (Math.floor(p().meters.clean / 60) < 500) life.care({ kind: "clean" }, t);
  const night = hour >= 21 || hour < 6;
  if (p().asleep && !night && life.energy() >= 600) life.care({ kind: "wake" }, t);
  if (!p().asleep && !p().sick && Math.floor(p().meters.joy / 60) < 650 && life.energy() >= 200) life.care({ kind: "play", stars: 2 }, t);
  if (!p().asleep) life.care({ kind: "pet" }, t);
  if (night && !p().asleep) life.care({ kind: "lightsOff" }, t);
}

/** The partner a spar grinder picks: one it has never beaten (for the first-win bonus), else the one it beats most. */
function grinderPick(life: Life): Partner {
  const games = (p: Partner) => {
    const r = life.record[p.id];
    return r ? r.w + r.l + r.d : 0;
  };
  const fresh = PARTNERS.find((p) => (life.record[p.id]?.w ?? 0) === 0 && games(p) < 3);
  if (fresh) return fresh;
  const rate = (p: Partner) => (life.record[p.id]?.w ?? 0) / Math.max(1, games(p));
  return [...PARTNERS].sort((a, b) => rate(b) - rate(a))[0]!;
}

const dailyPartner = (t: number): Partner => PARTNERS[dailyPartnerIndex(dayIndex(t))]!;

/** One visit: arrive, care, then each minute filled as the player fills it, the owner watching throughout. */
function visit(life: Life, spec: PlayerSpec, start: number, minutes: number, hour: number, day: number, state: RunState): void {
  life.arrive(start);
  const routine = (t: number, h: number) => {
    life.quests(t);
    life.openBoxes(t);
    careFor(life, t, h);
    life.teachNext(t, day, (d) => (state.firstTooBigDay ??= d));
    life.levelUp();
    if (!life.pet.asleep && life.energy() >= 100 && ROOMS[life.world.room]?.drops.length) life.lookAround(t);
    for (let i = 0; i < ERRANDS && life.errand(t, () => (spec.minute === "spar" ? grinderPick(life) : dailyPartner(t))); i++);
    if (life.world.room !== HOME) life.walkTo(HOME, t);
    life.quests(t);
  };
  routine(start, hour);
  if (!spec.minute && !state.sparredToday) {
    life.spar(dailyPartner(start), start);
    state.sparredToday = true;
  }
  let sparMs = 0;
  for (let m = 0; m < minutes; m++) {
    const t = start + m * MIN;
    if (m > 0 && m % CARE_EVERY === 0) routine(t, hour + Math.floor(m / 60));
    if (spec.minute === "tap") for (let k = 0; k < TAPS_PER_MINUTE; k++) tapOnce(life, spec.tap ?? "petTalk", k, t + Math.floor((k * MIN) / TAPS_PER_MINUTE));
    if (spec.minute === "spar") for (sparMs += MIN; sparMs > 0; ) sparMs -= life.spar(grinderPick(life), t).ms;
    life.watch(t + MIN);
  }
  life.levelUp();
  life.quests(start + minutes * MIN);
}

interface RunState {
  firstTooBigDay: number | null;
  sparredToday: boolean;
}

/** One player type's 90 days, through the real rules, from a seed. */
export function playType(type: PlayerType, seed: number, days: number, tap?: TapPath): PlayerNumbers {
  const spec = tap ? { ...PLAYERS[type], tap } : PLAYERS[type];
  const bornAt = DAY1 + HATCH_HOUR * 3_600_000;
  const life = new Life({ name: type, line: spec.line, bornAt, tzOffsetMin: TZ, seed: seed ^ PLAYER_SALT[type], trees: spec.trees });
  const state: RunState = { firstTooBigDay: null, sparredToday: false };
  const everything = costOfEverything();
  const rows: PlayerDay[] = [];
  const seenQuests = new Set<string>();
  const seenRecipes = new Set<number>();
  const seenFinds = new Set<string>();
  const seenRequests = new Set<string>();
  const seenHappenings = new Set<string>();
  const thingsLeft: number[] = [];
  let last = { xp: 0, met: 0, keepsakes: 0, season: "", earned: life.coinsEarned(), spent: life.coinsSpent(), visited: life.world.visited.length, stage: "", capacity: 0, tiers: 0, form: false };
  let level99Day: number | null = null;
  let allAffordableDay: number | null = null;
  let sickAfterWeekend = 0;
  let weekends = 0;
  let teenGateShare = 0;
  for (let day = 1; day <= days; day++) {
    const midnight = DAY1 + (day - 1) * DAY_MS;
    const weekday = (day - 1) % 7;
    state.sparredToday = false;
    const visits = spec.visits(weekday).filter(([h]) => day > 1 || h > HATCH_HOUR);
    if (day === 1) visit(life, spec, bornAt, HATCH_MINUTES, HATCH_HOUR, day, state);
    for (const [i, [hour, minutes]] of visits.entries()) {
      const start = midnight + hour * 3_600_000;
      if (type === "weekend" && weekday === 0 && i === 0 && day > 1) {
        // the first return after a weekend away: is the pet ill?
        life.arrive(start);
        weekends++;
        if (life.pet.sick) sickAfterWeekend++;
      }
      visit(life, spec, start, minutes, hour, day, state);
    }
    const end = midnight + DAY_MS - MIN;
    life.arrive(end);
    const today = life.endDay();
    const quests = life.questsSeen(end).filter((id) => !seenQuests.has(id));
    const recipes = life.recipesReachable().filter((r) => !seenRecipes.has(r));
    const finds = life.finds().filter((f) => !seenFinds.has(f));
    quests.forEach((q) => seenQuests.add(q));
    recipes.forEach((r) => seenRecipes.add(r));
    finds.forEach((f) => seenFinds.add(f));
    const stage = stageOf(life.pet, end);
    const capacity = life.capacity(end);
    const tiers = life.tiersOpen();
    const form = life.pet.form !== undefined;
    const visited = life.world.visited.length;
    // G4: a visitor met for the first time, a keepsake left, a resident's request first asked, a season turned
    const met = Object.keys(life.album).length;
    const request = life.requestToday();
    const freshRequest = request !== null && !seenRequests.has(request);
    if (request) seenRequests.add(request);
    const season = worldSeasonAt(midnight).id;
    // D2: the village's happening, a different one every day
    const happening = life.happeningId(midnight + 12 * 3_600_000);
    const freshHappening = !seenHappenings.has(happening);
    seenHappenings.add(happening);
    thingsLeft.push(life.thingsLeft(end));
    const g4 = met - last.met + (life.keepsakes - last.keepsakes) + (freshRequest ? 1 : 0) + (last.season && season !== last.season ? 1 : 0) + (freshHappening ? 1 : 0);
    const newThings = g4 + quests.length + recipes.length + finds.length + (visited - last.visited) + (stage !== last.stage ? 1 : 0) + (capacity > last.capacity ? 1 : 0) + Math.max(0, tiers - last.tiers) + (form && !last.form ? 1 : 0);
    const xp = life.xpTotal();
    const earned = life.coinsEarned();
    const spent = life.coinsSpent();
    const level = growthOf(life.pet).level;
    rows.push({
      day,
      stage,
      level,
      xp: xp - last.xp,
      coinsIn: earned - last.earned,
      coinsOut: spent - last.spent,
      coins: life.world.coins,
      mistakes: today.mistakes,
      sick: life.pet.sick === true,
      questsOpen: life.questsOpen(end),
      dailiesOpen: life.dailiesOpen(),
      recipesReachable: life.recipesReachable().length,
      roomsUnseen: Object.keys(ROOMS).length - visited,
      newThings,
      watched: today.watched,
      lessonFires: today.lessonFires,
      lessons: life.pet.lessons.length,
      gates: life.gates(),
      gateBudget: life.gateBudget(),
      spars: today.spars,
      sparWins: today.sparWins,
    });
    last = { xp, met, keepsakes: life.keepsakes, season, earned, spent, visited, stage, capacity, tiers, form };
    if (level >= 99) level99Day ??= day;
    if (life.world.coins >= everything) allAffordableDay ??= day;
    if (day <= 7) teenGateShare = Math.max(teenGateShare, life.gates() / life.gateBudget());
  }
  const watched = rows.reduce((s, r) => s + r.watched, 0);
  return {
    type,
    days: rows,
    level99Day,
    mistakes: life.mistakes,
    sickAfterWeekend,
    weekends,
    maxDailyCoinsIn: Math.max(...rows.map((r) => r.coinsIn)),
    allAffordableDay,
    daysWithNothingNew: rows.filter((r) => r.newThings === 0).length,
    fewestThingsLeft: Math.min(...thingsLeft),
    lessonFiresPerWatchedMinute: watched ? rows.reduce((s, r) => s + r.lessonFires, 0) / watched : 0,
    byLesson: life.byLesson,
    firstTooBigDay: state.firstTooBigDay,
    teenGateShare,
  };
}

const PLAYER_SALT: Record<PlayerType, number> = { once: 0x1111, three: 0x2222, weekend: 0x3333, tapper: 0x4444, grinder: 0x5555 };
