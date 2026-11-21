/**
 * One simulated player's pet and world, and every move a player can make on them, each through the game's own rules:
 * the pet's beats, care and teaching (@lingxi/game), the world's moves, finds, shop and quests (@lingxi/world). The
 * player types (players.ts) decide when and how often to make these moves; nothing here decides balance.
 *
 * Each move does what the web client does with the same rule (apps/web/src/game/store.ts and world.ts): a care is
 * `care` and then its tally, a food from the bag is `take` and then `care` feed, a walk is `move` and then `exert`,
 * a lesson is `teach` and then one "talk" beat, a return is `catchUp` with the away surprises and `settleForm`.
 */

import { WANTS, compileProgram, gateCount, timeOfDay } from "@lingxi/brain";
import {
  DAILIES,
  ITEM,
  PIECE_PRICES,
  RECIPES,
  ROOMS,
  STORY,
  WEEKLY_GIFT,
  DECOR,
  HOME,
  type Condition,
  BOX_TABLES,
  TIMES_OF_DAY,
  openBox,
  type WorldState,
  acceptQuest,
  craft,
  giveTo,
  has,
  affinitiesOf,
  buy,
  bump,
  claimWeekly,
  completeQuest,
  craftBlocker,
  earn,
  forage,
  knownTravelRecipes,
  move,
  neighbours,
  newWorld,
  questProgress,
  questStatus,
  rollDailies,
  take,
  tallyOf,
  weeklyGiftsWaiting,
} from "@lingxi/world";
import type { StarterLine } from "@lingxi/brain";
import {
  type Brain,
  type Care,
  type CareResult,
  type Fighter,
  type Partner,
  type Pet,
  type Tree,
  PET_SCHOOL,
  SKILLS,
  TREES,
  awayEvent,
  awaySeed,
  care,
  catchUp,
  createPet,
  exert,
  fighterOfMind,
  fighterOfPartner,
  gateBudget,
  growthOf,
  learnSkill,
  lessonCapacity,
  levelCost,
  levelUpPet,
  liveBeat,
  mindBrain,
  restartLog,
  settleForm,
  CURRENT_SPAR,
  fight,
  sparMods,
  stageOf,
  teach,
  tierOpen,
  exploreMods,
  work,
  beatOf,
  localHour,
  watchEvent,
} from "../../src";
import { FIRST_ROUND_MS, FIRST_WIN_COINS, ROUND_MS, WIN_COINS, GIVER_ROOM, type TallyEntry, careTally, meetTally, talkTally, fedTally, minuteTally, sparLevel, viewOf, awayTally } from "./client";

export const MIN = 60_000;
/** Reading a spar's result and tapping for the next one (the simulator's own estimate of a quick player). */
export const BETWEEN_SPARS_MS = 4_000;
/** Praline's shop, the one that sells meals. */
const FOOD_SHOP = 13;

/** Coins to buy every permanent thing sold for coins: decorations, outfit pieces and the shops' tools. */
export function costOfEverything(): number {
  const decor = DECOR.filter((d) => !d.gift && !d.chain).reduce((s, d) => s + d.price, 0);
  const pieces = Object.values(PIECE_PRICES).reduce((s, n) => s + n, 0);
  const tools = new Set(Object.values(ROOMS).flatMap((r) => r.shop.filter((i) => ITEM[i]?.kind === "tool")));
  return decor + pieces + [...tools].reduce((s, i) => s + (ITEM[i]?.price ?? 0), 0);
}

function xorshift(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>>= 0);
  };
}

const gatesOf = new Map<string, number>();
/** A partner's fighter is the same every time (the fight copies its memory), so it is built once. */
const partners = new Map<string, Fighter>();
const partnerFighter = (p: Partner): Fighter => {
  let f = partners.get(p.id);
  if (!f) partners.set(p.id, (f = fighterOfPartner(p)));
  return f;
};

/** What happened today, gathered as it happens and read once at the day's end. */
export interface Today {
  mistakes: number;
  watched: number;
  lessonFires: number;
  spars: number;
  sparWins: number;
}
const freshToday = (): Today => ({ mistakes: 0, watched: 0, lessonFires: 0, spars: 0, sparWins: 0 });

export class Life {
  pet: Pet;
  world: WorldState;
  readonly seedOfPet: number;
  readonly rnd: () => number;
  readonly skillOrder: number[];
  /** wins, losses and draws against each partner (the client's spar record) */
  readonly record: Record<string, { w: number; l: number; d: number }> = {};
  today: Today = freshToday();
  mistakes = 0;
  /** each school lesson taught: watched minutes since, and minutes it decided */
  readonly byLesson: Record<string, { watched: number; fired: number }> = {};
  tooBig = false;

  constructor(o: { name: string; line: StarterLine; bornAt: number; tzOffsetMin: number; seed: number; trees: readonly Tree[] }) {
    this.pet = createPet({ name: o.name, line: o.line, now: o.bornAt, tzOffsetMin: o.tzOffsetMin, brain: mindBrain({ line: o.line, lessons: [] }) });
    this.world = newWorld(`sim90-${o.seed}-${o.name}`);
    this.seedOfPet = awaySeed(this.pet);
    this.rnd = xorshift(o.seed ^ 0x5bd1e995);
    this.skillOrder = [...SKILLS].sort((a, b) => o.trees.indexOf(a.tree) - o.trees.indexOf(b.tree) || a.id - b.id).map((s) => s.id);
  }

  /* ── the pet ──────────────────────────────────────────────────────────── */

  brain(): Brain {
    const p = this.pet;
    return mindBrain({ line: p.line, lessons: p.lessons, family: p.family, instincts: p.instincts, outside: p.outside, growth: p.growth });
  }
  /** lesson slots a quest gave (the client's setQuestSlots in world.ts) */
  slots(): number {
    return (this.world.flags ?? []).includes("lesson-slot") ? 1 : 0;
  }
  energy(): number {
    return Math.floor(this.pet.meters.energy / 60);
  }
  food(): number {
    return Math.floor(this.pet.meters.food / 60);
  }

  /** Every change to the pet passes here, so each care mistake the game records is counted once. */
  set(next: Pet): void {
    const before = this.pet;
    const n = (next.mistakes ?? 0) < 63 ? (next.mistakes ?? 0) - (before.mistakes ?? 0) : newMisses(before, next);
    if (n > 0) {
      this.mistakes += n;
      this.today.mistakes += n;
    }
    this.pet = next;
  }

  /**
   * The client adds each count to the tally as it happens; here they wait and are added together before anything
   * reads the tally (the quest book, the day's end). Counts only add up, so the tally a quest reads is the same.
   */
  private pending = new Map<string, TallyEntry>();
  note(entries: readonly TallyEntry[]): void {
    for (const e of entries) {
      const k = `${e[0]}|${e[1]}|${e[3]}`;
      const had = this.pending.get(k);
      this.pending.set(k, had ? [e[0], e[1], had[2] + e[2], e[3]] : e);
    }
  }
  flush(): WorldState {
    for (const [type, index, n, total] of this.pending.values()) this.world = bump(this.world, type, index, n, { total });
    this.pending.clear();
    return this.world;
  }

  /** The player opens the game: every minute away is replayed with the away surprises, as the client's returnTo does. */
  arrive(t: number): void {
    const seed = this.seedOfPet;
    // what the pet chose of its own accord, awake, while away counts as the client counts it (store.ts returnTo, G8)
    const wants: Record<string, number> = {};
    this.set(
      settleForm(
        catchUp(this.pet, t, this.brain(), (b) => awayEvent(seed, b), (want) => {
          const w = WANTS[want];
          if (w && w !== "idle") wants[w] = (wants[w] ?? 0) + 1;
        }),
        t,
      ),
    );
    this.note(awayTally(this.world.room, wants));
    this.trimLog();
  }

  /** One minute with the game open and the owner watching (the client's tick). */
  watch(t: number): void {
    // the client's tick: watched minutes bring the living room's events (store.ts tick, G1)
    this.set(settleForm(liveBeat(this.pet, t, this.brain(), watchEvent(this.seedOfPet, beatOf(t))), t));
    this.note(minuteTally(this.world.room, this.pet, t));
    this.today.watched++;
    const rule = this.pet.last.rule;
    const lessons = this.pet.lessons;
    const decided = !this.pet.last.instinct && rule >= 0 && rule < lessons.length ? lessons[rule] : undefined;
    if (decided) this.today.lessonFires++;
    for (const l of lessons) {
      const id = PET_SCHOOL.find((s) => s.rule.label === l.label)?.id;
      if (!id) continue;
      const b = (this.byLesson[id] ??= { watched: 0, fired: 0 });
      b.watched++;
      if (decided === l) b.fired++;
    }
    this.trimLog();
  }

  /**
   * The input log is kept as the game keeps it, but cut back to nothing after each stretch: nothing in the rules
   * reads its length, and a 90-day log copied on every tap would make the run take hours. It is cut with the game's
   * own restartLog, as a pet kept on chain has its log restarted.
   */
  trimLog(): void {
    if (this.pet.pendingLog.length) this.pet = restartLog(this.pet, this.pet.pendingLog.length, this.pet.brain);
  }

  care(c: Care, t: number): CareResult {
    const wasAsleep = this.pet.asleep;
    const r = care(this.pet, c, t, this.brain());
    this.set(r.pet);
    this.note(careTally(c.kind, wasAsleep, r));
    return r;
  }

  /** The food in the bag that best fills what the pet is missing. */
  bestFood(): number | null {
    const room = 1000 - this.food();
    const foods = Object.keys(this.world.bag).map(Number).filter((i) => ITEM[i]?.kind === "food" && (ITEM[i]!.use?.food ?? 0) > 0);
    if (!foods.length) return null;
    const fill = (i: number) => ITEM[i]!.use!.food!;
    const fits = foods.filter((i) => fill(i) <= room + 100).sort((a, b) => fill(b) - fill(a));
    return fits[0] ?? foods.sort((a, b) => fill(a) - fill(b))[0]!;
  }

  /** A food from the bag (the one named, or the one that fits best), eaten (world.ts `use` for a food). */
  feed(t: number, named?: number): boolean {
    const item = named ?? this.bestFood();
    if (item === null) return false;
    const r = take(this.world, item);
    if (!r.ok) return false;
    this.world = r.world;
    const res = this.care({ kind: "feed", food: r.use }, t);
    if (res.note === "ate" || res.note === "woke") this.note(fedTally(item, r.use.diet, this.pet, t));
    return true;
  }

  /** A school lesson, taught the way the client's learn does: the rule on top, then one beat with "talk" on the pins. */
  teachNext(t: number, day: number, onTooBig: (day: number) => void): void {
    for (const s of PET_SCHOOL) {
      if (this.pet.lessons.some((l) => l.label === s.rule.label)) continue;
      const r = teach(this.pet, s.rule, t, this.slots());
      if (!r.ok) {
        if (r.reason === "full") return;
        if (r.reason === "tooBig") onTooBig(day);
        continue;
      }
      this.set(r.pet);
      this.care({ kind: "talk" }, t);
      this.note([["LESSON", 0, 1, true]]);
      return;
    }
  }

  /** Every level the XP buys, and each point spent on the first skill the trees allow, in this player's order. */
  levelUp(): void {
    for (let r = levelUpPet(this.pet); r.ok; r = levelUpPet(this.pet)) this.set(r.pet);
    while (growthOf(this.pet).points > 0) {
      const id = this.skillOrder.find((s) => learnSkill(this.pet, s).ok);
      if (id === undefined) return;
      const r = learnSkill(this.pet, id);
      if (r.ok) this.set(r.pet);
    }
  }

  /** All XP the pet has earned: what it holds and what its levels cost. */
  xpTotal(): number {
    let spent = 0;
    for (let l = 1; l < growthOf(this.pet).level; l++) spent += levelCost(l);
    return this.pet.xp + spent;
  }

  gates(): number {
    const program = this.brain().program;
    if (!program) return 0;
    const key = JSON.stringify(program.rules.map((r) => [r.when, r.then]));
    let g = gatesOf.get(key);
    if (g === undefined) gatesOf.set(key, (g = gateCount(compileProgram(program))));
    return g;
  }
  gateBudget(): number {
    return gateBudget(this.pet.growth);
  }
  capacity(t: number): number {
    return lessonCapacity(stageOf(this.pet, t), this.pet.growth, this.slots());
  }
  tiersOpen(): number {
    const g = growthOf(this.pet);
    return TREES.reduce((n, tree) => n + [1, 2, 3, 4, 5, 6].filter((tier) => tierOpen(g, tree, tier)).length, 0);
  }

  /* ── the world ────────────────────────────────────────────────────────── */

  /** Walk room by room to `to` (each step `move`, then the pet tires as the client's tirePet does). */
  walkTo(to: number, t: number): boolean {
    if (this.world.room === to) return true;
    const prev = new Map<number, number>([[this.world.room, -1]]);
    const queue = [this.world.room];
    while (queue.length && !prev.has(to)) {
      const r = queue.shift()!;
      for (const n of neighbours(r)) {
        if (prev.has(n)) continue;
        prev.set(n, r);
        queue.push(n);
      }
    }
    if (!prev.has(to)) return false;
    const path: number[] = [];
    for (let r = to; r !== this.world.room; r = prev.get(r)!) path.unshift(r);
    for (const step of path) if (!this.step(step, t)) return false;
    return true;
  }
  distance(to: number): number {
    const seen = new Map<number, number>([[this.world.room, 0]]);
    const queue = [this.world.room];
    while (queue.length) {
      const r = queue.shift()!;
      if (r === to) return seen.get(r)!;
      for (const n of neighbours(r)) {
        if (seen.has(n)) continue;
        seen.set(n, seen.get(r)! + 1);
        queue.push(n);
      }
    }
    return Infinity;
  }
  step(to: number, t: number): boolean {
    if (this.pet.asleep) return false;
    const mods = exploreMods(this.pet.growth);
    const r = move(this.world, to, this.energy(), mods);
    if (!r.ok) return false;
    this.world = r.world;
    this.set(exert(this.pet, mods.moveEnergy, t, this.brain()));
    return true;
  }
  /** Look around the room the pet is in (the client's forage); what was found, or null when the room would not allow it. */
  lookAround(t: number): Array<{ item: number; n: number }> | null {
    const mods = exploreMods(this.pet.growth);
    const kin = affinitiesOf(this.pet.line, ((this.pet.instincts ?? 0) & 1) === 1);
    const r = forage(this.world, t, this.energy(), mods, kin);
    if (!r.ok) return null;
    this.world = r.world;
    this.set(exert(this.pet, mods.forageEnergy, t, this.brain()));
    return r.found;
  }

  /** To Praline's for meals and home again, if the pet has the energy for both ways; the most food per coin first. */
  shopForFood(t: number, count = 6): boolean {
    const there = this.distance(FOOD_SHOP);
    const per = exploreMods(this.pet.growth).moveEnergy;
    if (this.pet.asleep || this.energy() < 2 * there * per + 20) return false;
    const meals = ROOMS[FOOD_SHOP]!.shop.filter((i) => ITEM[i]?.kind === "food" && ITEM[i]!.price !== undefined && (ITEM[i]!.use?.food ?? 0) > 0);
    const best = meals.sort((a, b) => ITEM[b]!.use!.food! / ITEM[b]!.price! - ITEM[a]!.use!.food! / ITEM[a]!.price!)[0]!;
    if (this.world.coins < ITEM[best]!.price!) return false;
    const home = this.world.room;
    if (!this.walkTo(FOOD_SHOP, t)) {
      this.walkTo(home, t);
      return false;
    }
    for (let i = 0; i < count; i++) {
      const r = buy(this.world, best);
      if (!r.ok) break;
      this.world = r.world;
    }
    this.walkTo(HOME, t);
    return true;
  }

  /** Coins won outside the world (spars), as the client's reward does. */
  reward(coins: number): void {
    if (coins > 0) this.world = earn(this.world, coins);
  }

  /** One practice spar, paid as Arena.tsx pays it; returns whether it was won and how long it took to watch. */
  spar(partner: Partner, t: number): { won: boolean; ms: number } {
    const p = this.pet;
    const me = fighterOfMind(p.name, { line: p.line, lessons: p.lessons, family: p.family, instincts: p.instincts, outside: p.outside, growth: p.growth }, sparLevel(stageOf(p, t)), p.brain);
    const r = fight(CURRENT_SPAR, me, partnerFighter(partner), this.rnd(), () => [false, false]);
    const outcome = r.winner === 0 ? "w" : r.winner === 1 ? "l" : "d";
    const rec = (this.record[partner.id] ??= { w: 0, l: 0, d: 0 });
    const first = outcome === "w" && rec.w === 0;
    rec[outcome]++;
    this.note([["SPAR", 0, 1, true]]);
    this.today.spars++;
    const skill = sparMods(p.growth);
    if (outcome === "w") {
      this.note([["SPAR_WIN", 0, 1, true]]);
      this.today.sparWins++;
      this.reward(WIN_COINS + (first ? FIRST_WIN_COINS : 0) + skill.winCoins);
    } else if (outcome === "l") this.reward(skill.lossCoins);
    return { won: outcome === "w", ms: FIRST_ROUND_MS + (r.rounds.length - 1) * ROUND_MS + BETWEEN_SPARS_MS };
  }

  /**
   * Quests as a player who opens the book each visit: today's dailies rolled, the weekly gift taken, every ready
   * quest handed in and every open story quest taken. (Handing in is done from the book, not at the giver's door.)
   */
  quests(t: number): void {
    this.flush();
    const tz = this.pet.tzOffsetMin;
    this.world = rollDailies(this.world, DAILIES, viewOf(this.world, this.pet, t), tz);
    if (weeklyGiftsWaiting(this.world) > 0) {
      const r = claimWeekly(this.world, WEEKLY_GIFT);
      if (r.ok) this.world = r.world;
    }
    for (let changed = true, guard = 0; changed && guard < 20; guard++) {
      changed = false;
      for (const q of [...DAILIES, ...STORY]) {
        const v = viewOf(this.world, this.pet, t);
        const s = questStatus(q, this.world, v);
        const r = s === "ready" ? completeQuest(this.world, q, v) : s === "available" && q.kind === "story" ? acceptQuest(this.world, q, v) : null;
        if (!r?.ok) continue;
        this.world = r.world;
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
  errand(t: number, sparWith: () => Partner): boolean {
    this.flush();
    for (const q of [...DAILIES, ...STORY]) {
      if (questStatus(q, this.world, viewOf(this.world, this.pet, t)) !== "active") continue;
      const prog = questProgress(q, this.world, viewOf(this.world, this.pet, t));
      for (const [i, o] of q.objectives.entries()) {
        if (!prog[i]!.met && this.objective(o.cond.type === "ANY" ? (o.cond.of ?? [])[0] : o.cond, t, sparWith)) return true;
      }
    }
    return false;
  }

  private objective(c: Condition | undefined, t: number, sparWith: () => Partner): boolean {
    if (!c) return false;
    const room = Number(c.index);
    switch (c.type) {
      case "VISIT":
      case "ROOM": {
        if (!ROOMS[room] || this.distance(room) > 4) return false;
        if (c.type === "VISIT" && this.world.room === room) this.step(neighbours(room)[0]!, t);
        const there = this.walkTo(room, t);
        this.walkTo(HOME, t);
        return there;
      }
      case "MOVE":
        return this.step(neighbours(this.world.room)[0]!, t) && this.walkTo(HOME, t);
      case "FORAGE":
      case "FIND":
        return c.index === undefined && this.lookAround(t) !== null;
      case "SPAR":
        return this.spar(sparWith(), t).ms > 0;
      case "CRAFT": {
        const r = RECIPES.find((x) => (c.index === undefined || x.out === Number(c.index)) && craftBlocker(this.world, x, this.energy()) === null);
        if (!r || this.pet.asleep) return false;
        const made = craft(this.world, r.index, this.energy());
        if (!made.ok) return false;
        this.world = made.world;
        this.set(work(this.pet, made.energy, made.xp, t, this.brain()));
        return true;
      }
      case "BUY":
        return this.shopForFood(t, 1);
      case "GIVE":
      case "GIVE_TO": {
        const [who, item] = c.type === "GIVE_TO" ? String(c.index).split(":") : ["wick", c.index === undefined ? undefined : String(c.index)];
        const what = item !== undefined ? Number(item) : Object.keys(this.world.bag).map(Number).find((i) => ITEM[i]?.kind === "material");
        if (what === undefined || !has(this.world, what, c.value ?? 1)) return false;
        const r = giveTo(this.world, who!, what, c.value ?? 1);
        if (!r.ok) return false;
        this.world = r.world;
        return true;
      }
      case "TALK": {
        const who = c.index === undefined ? "wick" : String(c.index);
        const at = GIVER_ROOM[who];
        if (at === undefined || this.distance(at) > 4 || !this.walkTo(at, t)) return false;
        this.note(talkTally(who));
        this.walkTo(HOME, t);
        return true;
      }
      case "CARE":
        return this.careFor(String(c.index), t);
      case "MEET":
        this.note(meetTally(c.index === undefined ? "behemoth" : String(c.index), t, this.pet.tzOffsetMin));
        return true;
      default:
        return false;
    }
  }

  /** A care a quest asks for by name ("feed", "sleep", "wake-morning"…), when the time of day it names is now. */
  private careFor(index: string, t: number): boolean {
    const [kind, time] = index.split("-") as [string, string | undefined];
    if (time && TIMES_OF_DAY[timeOfDay(localHour(this.pet, beatOf(t)))] !== time) return false;
    if (kind === "feed") return this.feed(t);
    if (kind === "sleep") return !this.pet.asleep && this.care({ kind: "lightsOff" }, t).note === "sleeping";
    if (kind === "wake") {
      if (!this.pet.asleep) this.care({ kind: "lightsOff" }, t);
      return this.care({ kind: "wake" }, t).note === "awake";
    }
    if (kind === "play" || kind === "clean" || kind === "pet" || kind === "talk") return this.care(kind === "play" ? { kind, stars: 2 } : { kind }, t).note !== "tooTired";
    return false;
  }

  /** Every box in the bag opened (the bag screen's open). */
  openBoxes(t: number): void {
    for (const box of Object.keys(BOX_TABLES).map(Number))
      while (has(this.world, box)) {
        const r = openBox(this.world, t, box);
        if (!r.ok) break;
        this.world = r.world;
      }
  }

  /* ── what is left and what is new ─────────────────────────────────────── */

  questsOpen(t: number): number {
    const v = viewOf(this.world, this.pet, t);
    return STORY.filter((q) => ["available", "active", "ready"].includes(questStatus(q, this.world, v))).length;
  }
  questsSeen(t: number): string[] {
    const v = viewOf(this.world, this.pet, t);
    return STORY.filter((q) => questStatus(q, this.world, v) !== "locked").map((q) => q.id);
  }
  dailiesOpen(): number {
    const today = this.world.quests?.today;
    return today ? today.offered.filter((id) => !today.done.includes(id)).length : 0;
  }
  recipesReachable(): number[] {
    return [...RECIPES, ...knownTravelRecipes(this.world)].filter((r) => craftBlocker(this.world, r) === null).map((r) => r.index);
  }
  finds(): string[] {
    return Object.keys(this.world.tally ?? {}).filter((k) => k.startsWith("FIND:") && k !== "FIND:0");
  }
  coinsEarned(): number {
    return tallyOf(this.world, "COINS_EARNED");
  }
  coinsSpent(): number {
    return tallyOf(this.world, "COINS_SPENT");
  }
  endDay(): Today {
    this.flush();
    const t = this.today;
    this.today = freshToday();
    return t;
  }
}

/** Misses the game recorded between two states, read from the kept list once the count has reached its cap. */
function newMisses(before: Pet, after: Pet): number {
  const b = before.missed ?? [];
  const last = b.length ? b[b.length - 1]!.beat : -Infinity;
  const a = after.missed ?? [];
  return a.filter((m) => m.beat > last).length + Math.max(0, a.filter((m) => m.beat === last).length - b.filter((m) => m.beat === last).length);
}
