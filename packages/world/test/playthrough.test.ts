/**
 * The automated playthrough (plan 4.2 done check, made honest by plan row G0): a simulated player plays every story
 * quest and every daily through the world's own rules, with a real pet living by the game's own rules beside it.
 * It walks the room graph, looks around once an hour where an item really drops, crafts from real recipes, buys in
 * real shops, gives to residents, walks and travels. Wherever a quest offers a path that needs another player, the
 * solo path is taken, so this also proves no quest needs a second player.
 *
 * What changed with G0, and why. The playthrough used to give itself 500 coins at every shop, hold the pet's energy
 * at 900 for every step, and add "the pet chose" (and its care, its minutes together, its healthy days, its meals)
 * straight into the tally. Each of those made it finish quests a real player might not. Now:
 *   - coins are only what the world pays (quest rewards, first visits, the weekly gift) and what spar wins pay;
 *     when a shop costs more than the player holds, it earns the rest by sparring, as a player would;
 *   - the pet is real (@lingxi/game): every step, look and bench job spends its energy, and when it is spent the
 *     player feeds it, puts it to bed and waits for it to wake, so energy costs real hours;
 *   - the pet's own brain makes its choices: "the pet chooses to …" objectives count only the beats where its brain
 *     chose that, watched minute by minute; care is real care (a medicine counts only when it heals), minutes together
 *     are real watched minutes at the time of day asked, meals are real foods eaten, healthy days are real days;
 *   - an objective the real pet cannot reach is not forced: it is recorded with the reason, and the test asserts
 *     exactly which quests stay out of reach, so the list can only change on purpose (plan G8 owns fixing them).
 * What the web app still counts by hand here, as before, are the things only another screen or person does:
 * saving to the chain, gifts, named events (a replay watched, a friend's visit), talks and Builders' Lane visits,
 * and wearing a piece while walking. The client's own tally glue (what a care or a watched minute counts) is the
 * simulator's single copy of it (packages/game/scripts/sim90/client.ts).
 */

import { describe, expect, it } from "vitest";
import { timeOfDay } from "@lingxi/brain";
import { PARTNERS, arrangeLessons, beatOf, exploreMods, localHour, needsMinOf, stageOf, work } from "@lingxi/game";
import {
  type Condition,
  type ConditionView,
  DAILIES,
  HOME,
  ITEM,
  MAKE_RECIPES,
  RECIPES,
  ROOMS,
  STAGE_ORDER,
  STORY,
  type QuestDef,
  type WorldState,
  WEEKLY_GIFT,
  acceptQuest,
  buy,
  bump,
  claimWeekly,
  completeQuest,
  craft,
  endTrip,
  endWalk,
  giveTo,
  localDay,
  make,
  neighbours,
  placeDecor,
  questProgress,
  questStatus,
  rollDailies,
  startTrip,
  startWalk,
  tallyOf,
  weeklyGiftsWaiting,
  DESTINATION,
  TIMES_OF_DAY,
} from "../src";
import { Life, MIN } from "../../game/scripts/sim90/life";
import { viewOf } from "../../game/scripts/sim90/client";

const HOUR = 3_600_000;
const START = Date.UTC(2026, 10, 16, 8);
/** Events only another player can cause: the playthrough never relies on them. */
const NEEDS_SOMEONE = (c: Condition) => (c.type === "EVENT" && ["visited-by-friend", "pet-sat", "child-born"].includes(String(c.index))) || c.type === "BOND";
/** The most minutes the player watches for a choice or a time together before calling it out of reach. */
const PATIENCE = 12 * 60;
/** How long a player waits for a choice of the pet's own, watching and leaving it there in turn: a week (G8). */
const AWAY_PATIENCE = 7 * 1440;

/** An objective the real pet could not reach, and why: the quest is left undone rather than forced. */
class OutOfReach extends Error {}

class Player {
  life = new Life({ name: "Mochi", line: "gentle", bornAt: START, tzOffsetMin: 0, seed: 1, trees: ["explore", "care", "mind", "spar"] });
  now = START;
  pets = 1;
  wearing: string | null = null;
  log: string[] = [];
  /** game hours each quest took between accepting and handing in, and of those the hours the pet slept to recover */
  hours: Record<string, number> = {};
  rested = 0;
  restedIn: Record<string, number> = {};
  /** hours spent waiting for the time of day a quest names ("this evening") */
  waited = 0;
  waitedIn: Record<string, number> = {};
  /** coins won sparring to afford a shop, and the spars it took */
  sparCoins = 0;
  spars = 0;

  /** The world as it stands, with every count the pet's moves added (the life keeps them until read). */
  get w(): WorldState {
    return this.life.flush();
  }
  set w(next: WorldState) {
    this.life.world = next;
  }
  get pet() {
    return this.life.pet;
  }

  view(): ConditionView {
    const v = viewOf(this.w, this.pet, this.now);
    // the playthrough's player keeps its pet on chain, as before; saving to the chain is counted below by hand
    return { ...v, pet: { ...v.pet!, onChain: true }, pets: this.pets };
  }
  must<T extends object>(r: ({ ok: true; world: WorldState } & T) | { ok: false; reason: string }, what: string): { ok: true; world: WorldState } & T {
    if (!r.ok) throw new Error(`${what}: ${r.reason}`);
    this.w = r.world;
    return r;
  }
  /** What another screen of the web app counts (a save, a gift, a talk, a named event): bumped the way the app bumps it. */
  app(type: string, index: number | string = 0, n = 1, total = true) {
    this.w = bump(this.w, type, index, n, { total });
  }

  // ── time and the pet ──
  /** Minutes with the game open: each one a live beat, counted as the client counts it (time together, the pet's choice). */
  pass(minutes: number) {
    for (let i = 0; i < minutes; i++) {
      this.now += MIN;
      this.life.watch(this.now);
    }
  }
  /** Time with the game closed: every minute replayed when the player comes back. */
  away(minutes: number) {
    this.now += minutes * MIN;
    this.life.arrive(this.now);
  }
  /** A meal from the bag (the one that fits best). */
  feed(item?: number): boolean {
    return this.life.feed(this.now, item);
  }
  /**
   * Meals in the bag before setting out: three Butterfly Mochi from Praline's when the bag has none, earned by
   * sparring if the coins are short. Done between quests, never mid-errand, so a walk is never turned aside.
   */
  stock() {
    if (this.life.bestFood() !== null) return;
    const mochi = 11130;
    this.goTo(13);
    this.afford(3 * ITEM[mochi]!.price!);
    for (let i = 0; i < 3; i++) this.must(buy(this.w, mochi), "buy mochi");
  }
  /** The pet looked after: fed when hungry, bathed when dusty, woken from hibernation. */
  tend() {
    if (this.pet.hibernating && !this.feed()) this.life.care({ kind: "pet" }, this.now);
    if (this.pet.sick) this.life.care({ kind: "medicine" }, this.now);
    if (this.life.food() < 500) this.feed();
    if (this.pet.meters.clean / 60 < 400) this.life.care({ kind: "clean" }, this.now);
  }
  /** Spent: fed, put to bed, and left to sleep (an hour at a time) until it has its energy back, then woken. */
  rest() {
    const from = this.now;
    this.tend();
    if (!this.pet.asleep) this.life.care({ kind: "lightsOff" }, this.now);
    for (let h = 0; h < 16 && this.life.energy() < 900; h++) this.away(60);
    this.tend();
    if (this.pet.asleep) this.life.care({ kind: "wake" }, this.now);
    this.rested += (this.now - from) / HOUR;
  }
  /** At least `n` energy and awake, resting first if not. */
  ready(n: number) {
    if (this.pet.hibernating || this.pet.asleep || this.life.energy() < n) this.rest();
    if (this.pet.asleep) this.life.care({ kind: "wake" }, this.now);
    if (this.life.energy() < n) throw new Error(`the pet could not get its energy back (${this.life.energy()} of ${n})`);
  }
  /** Coins enough for `n`: sparring the softest partner for wins until there are (Arena.tsx's pay for a win). */
  afford(n: number) {
    for (let i = 0; this.w.coins < n; i++) {
      if (i > 400) throw new Error(`could not earn ${n} coins in ${i} spars`);
      const before = this.w.coins;
      const r = this.life.spar(PARTNERS[0]!, this.now);
      this.spars++;
      this.sparCoins += this.w.coins - before;
      this.pass(Math.ceil(r.ms / MIN));
    }
  }
  /** Until the pet's local time of day is `time` (night, morning, day, evening), the game closed. */
  waitFor(time: string) {
    const from = this.now;
    for (let h = 0; h < 24 && TIMES_OF_DAY[timeOfDay(localHour(this.pet, beatOf(this.now)))] !== time; h++) {
      this.away(60);
      this.tend();
    }
    this.waited += (this.now - from) / HOUR;
  }

  // ── walking the map ──
  step(to: number) {
    this.ready(exploreMods(this.pet.growth).moveEnergy + 5);
    if (!this.life.step(to, this.now)) throw new Error(`move ${this.w.room}→${to} refused`);
    this.pass(2); // a walk to the next room takes a couple of minutes
    if (this.wearing) this.app("MOVE_WEARING", this.wearing);
  }
  goTo(room: number) {
    if (this.w.room === room) return;
    const prev = new Map<number, number>([[this.w.room, -1]]);
    const queue = [this.w.room];
    while (queue.length && !prev.has(room)) {
      const r = queue.shift()!;
      for (const n of neighbours(r)) {
        if (prev.has(n)) continue;
        prev.set(n, r);
        queue.push(n);
      }
    }
    if (!prev.has(room)) throw new Error(`room ${room} cannot be reached from ${this.w.room}`);
    const path: number[] = [];
    for (let r = room; r !== this.w.room; r = prev.get(r)!) path.unshift(r);
    for (const r of path) this.step(r);
  }
  /** Arrive in a room (leaving first if already there), so a visit counts. */
  arrive(room: number) {
    if (this.w.room === room) this.step(neighbours(room)[0]!);
    this.goTo(room);
  }
  visitNew(n: number) {
    const seen = new Set(this.w.visited);
    for (const r of Object.keys(ROOMS).map(Number)) {
      if (this.w.visited.length >= n) return;
      if (!seen.has(r)) this.goTo(r);
    }
    if (this.w.visited.length < n) throw new Error(`only ${this.w.visited.length} rooms can be visited`);
  }

  // ── getting things ──
  /** The nearest room with something to find (some rooms, like the Lantern Room, have nothing to look for). */
  nearestWithDrops(): number {
    const seen = new Set([this.w.room]);
    const queue = [this.w.room];
    while (queue.length) {
      const r = queue.shift()!;
      if (ROOMS[r]?.drops.length) return r;
      for (const n of neighbours(r)) {
        if (seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    throw new Error("no room has anything to find");
  }
  /** Look around once (waiting out the room's hour if it was just looked at); what was found. */
  lookAround(room?: number): Array<{ item: number; n: number }> {
    this.goTo(room ?? this.nearestWithDrops());
    for (let i = 0; i < 3; i++) {
      this.ready(exploreMods(this.pet.growth).forageEnergy + 5);
      const found = this.life.lookAround(this.now);
      if (found) {
        this.pass(1);
        return found;
      }
      this.away(60); // once per room per hour
    }
    throw new Error(`cannot look around in room ${this.w.room}`);
  }
  /** Look around where `item` drops until `n` more have been found. */
  find(item: number, n: number) {
    const rooms = Object.values(ROOMS).filter((r) => r.drops.some((d) => d.item === item)).map((r) => r.index);
    if (!rooms.length) throw new Error(`nowhere drops ${ITEM[item]?.name.en ?? item}`);
    const goal = tallyOf(this.w, "FIND", item) + n;
    for (let tries = 0; tallyOf(this.w, "FIND", item) < goal; tries++) {
      if (tries > 400) throw new Error(`could not find ${ITEM[item]?.name.en} in ${tries} looks`);
      this.lookAround(rooms[tries % rooms.length]);
    }
  }
  /** Have `n` of an item in the bag: found, bought or made, whichever the world allows. */
  have(item: number, n: number) {
    const need = () => n - (this.w.bag[item] ?? 0);
    if (need() <= 0) return;
    const recipe = RECIPES.find((r) => r.out === item);
    const dropped = Object.values(ROOMS).some((r) => r.drops.some((d) => d.item === item));
    const shop = Object.values(ROOMS).find((r) => r.shop.includes(item));
    if (dropped) return this.find(item, need());
    if (shop) {
      this.goTo(shop.index);
      this.afford(need() * ITEM[item]!.price!);
      while (need() > 0) this.must(buy(this.w, item), `buy ${item}`);
      return;
    }
    if (recipe) {
      while (need() > 0) this.make(recipe.out);
      return;
    }
    throw new Error(`${ITEM[item]?.name.en ?? item} cannot be found, bought or made`);
  }
  make(out: number) {
    const r = RECIPES.find((x) => x.out === out);
    if (!r) throw new Error(`no recipe makes ${out}`);
    for (const x of r.ins) this.have(x.item, x.amount);
    // a tool is bought once and kept (plan 4.5); a room-only recipe is made in its room
    if (r.tool !== undefined) this.have(r.tool, 1);
    if (r.room !== undefined) this.goTo(r.room);
    this.ready(r.energy + 5);
    const made = this.must(craft(this.w, r.index, this.life.energy()), `craft ${ITEM[out]?.name.en}`);
    // the work tires the pet and teaches it (world.ts craft)
    this.life.set(work(this.pet, made.energy, made.xp, this.now, this.life.brain()));
  }
  sew(id: string) {
    const r = MAKE_RECIPES.find((x) => x.id === id)!;
    for (const x of r.ins) this.have(x.item, x.amount);
    const owned = this.w.wardrobe?.owned.includes(id) && r.kind === "outfit";
    if (owned) {
      // already sewn once: make the furniture of the same name instead, which also counts as MAKE
      const f = MAKE_RECIPES.find((x) => x.id === id && x.kind === "furniture");
      if (f) return (f.ins.forEach((x) => this.have(x.item, x.amount)), this.must(make(this.w, "furniture", id), `build ${id}`));
    }
    this.must(make(this.w, r.kind, id), `make ${id}`);
  }
  walk() {
    this.ready(200);
    this.must(startWalk(this.w, this.now, false), "start walk");
    this.pass(21);
    this.must(endWalk(this.w, this.now), "end walk");
    // a walk together is play (world.ts endWalk): joy for the pet, and it tires
    this.life.care({ kind: "play" }, this.now);
  }
  trip(to: string) {
    this.tend();
    this.must(startTrip(this.w, to, this.now), `start trip ${to}`);
    this.away(DESTINATION[to]!.hours * 60);
    this.must(endTrip(this.w, this.now), `end trip ${to}`);
  }
  /** Minutes together at a time of day, in a room or outdoors, watched one by one with the pet awake. */
  together(key: string, minutes: number) {
    const [time, where] = key.split("-") as [string, string | undefined];
    const goal = tallyOf(this.w, "TOGETHER_WHEN", key) + minutes;
    for (let tried = 0; tallyOf(this.w, "TOGETHER_WHEN", key) < goal; tried++) {
      if (tried > PATIENCE) throw new OutOfReach(`${minutes} minutes together ${key}: the pet was not awake with you that long`);
      this.waitFor(time);
      if (where && where !== "outside" && where !== "inside") this.goTo(Number(where));
      if (where === "outside") this.goTo(neighbours(HOME)[0]!);
      if (where === "inside") this.goTo(HOME);
      if (this.pet.asleep) this.life.care({ kind: "wake" }, this.now);
      this.pass(1);
    }
  }
  /**
   * Wait until the pet's own brain has chosen `want` (in `room`, when one is named) `n` more times: watched a while, and
   * then, as a player can, left there and come back to, since its choices while away count too (G8).
   */
  choose(want: string, room: number | undefined, n: number) {
    if (room !== undefined) this.goTo(room);
    const key = room !== undefined ? `${want}-${room}` : want;
    const goal = tallyOf(this.w, "CHOOSE", key) + n;
    const since = this.now;
    for (let watched = 0; tallyOf(this.w, "CHOOSE", key) < goal; watched++) {
      if (this.now - since > AWAY_PATIENCE * MIN) throw new OutOfReach(`its brain never chose to ${want}${room !== undefined ? ` in room ${room}` : ""} in ${AWAY_PATIENCE / 1440} days, watched and left there`);
      // every two hours watched without it, the pet is left there for four hours and the game opened again, as a
      // player sets off: rested, fed and clean first, so what it chooses alone is its own and not hunger or sleep
      // (to see it choose to eat, it is left unfed)
      if (watched % 120 === 119) {
        this.ready(700);
        if (want !== "eat") {
          this.stock();
          for (let i = 0; i < 3 && this.life.food() < 800; i++) if (!this.feed()) break;
          this.tend();
        }
        if (room !== undefined) this.goTo(room);
        this.away(4 * 60);
        if (want !== "eat") this.tend();
        if (room !== undefined) this.goTo(room);
        continue;
      }
      // to see it choose to eat, it is let get hungry rather than fed
      if (watched % 60 === 59 && want !== "eat") this.tend();
      if (this.pet.asleep && want === "eat") this.life.care({ kind: "wake" }, this.now);
      else if (this.pet.asleep) this.rest();
      if (room !== undefined) this.goTo(room);
      this.pass(1);
    }
  }
  /** One real care, at the time of day it names; counted only when it did what the client counts. */
  care(index: string, n: number) {
    const [kind, time] = index.split("-") as [string, string | undefined];
    const goal = tallyOf(this.w, "CARE", index) + n;
    for (let tries = 0; tallyOf(this.w, "CARE", index) < goal; tries++) {
      if (tries > 48) throw new OutOfReach(`care "${index}" never counted`);
      if (time) this.waitFor(time);
      if (kind === "medicine") {
        if (!this.pet.sick) throw new OutOfReach("a medicine counts only when it heals, and this pet is well");
        this.life.care({ kind: "medicine" }, this.now);
      } else if (kind === "feed") {
        // a full pet is overfed, which the client does not count: wait for it to be hungry
        if (this.life.food() >= 880) this.away(60);
        else this.feed();
      } else if (kind === "sleep") this.life.care({ kind: "lightsOff" }, this.now);
      else if (kind === "wake") {
        if (!this.pet.asleep) this.life.care({ kind: "lightsOff" }, this.now);
        this.life.care({ kind: "wake" }, this.now);
      } else if (kind === "play") {
        this.ready(150);
        this.life.care({ kind: "play" }, this.now);
      } else this.life.care({ kind: kind as "clean" | "pet" | "talk" }, this.now);
      this.pass(1);
    }
  }
  /** A named food eaten, waiting for room in its belly first. */
  eat(item: number) {
    this.have(item, 1);
    for (let h = 0; h < 12 && this.life.food() >= 880; h++) this.away(60);
    if (!this.life.feed(this.now, item)) throw new Error(`could not eat ${ITEM[item]?.name.en}`);
  }
}

/** Do whatever one condition asks, through the world's rules where the world owns the act. */
function satisfy(p: Player, c: Condition, q: QuestDef): void {
  const n = c.value ?? 1;
  const idx = c.index;
  switch (c.type) {
    case "ANY": {
      // each way a player alone can take, in turn, as a player tries the next when one does not work
      const solo = (c.of ?? []).filter((x) => !NEEDS_SOMEONE(x));
      if (!solo.length) throw new Error(`${q.id} has no solo path`);
      let last: unknown = null;
      for (const way of solo) {
        try {
          return satisfy(p, way, q);
        } catch (e) {
          if (!(e instanceof OutOfReach)) throw e;
          last = e;
        }
      }
      throw last;
    }
    case "VISIT":
      for (let i = 0; i < n; i++) p.arrive(Number(idx));
      return;
    case "VISITED":
      return p.visitNew(n);
    case "MOVE":
      for (let i = 0; i < n; i++) p.step(neighbours(p.w.room)[0]!);
      return;
    case "MOVE_WEARING": {
      const wd = p.w.wardrobe;
      if (!wd?.owned.includes(String(idx))) throw new Error(`${q.id}: ${idx} is not owned yet`);
      p.wearing = String(idx);
      for (let i = 0; i < n; i++) p.step(neighbours(p.w.room)[0]!);
      p.wearing = null;
      return;
    }
    case "ROOM":
      return p.goTo(Number(idx));
    case "FORAGE":
      for (let i = 0; i < n; i++) p.lookAround(idx === undefined ? undefined : Number(idx));
      return;
    case "FAMILIAR": {
      // fill the bars of the rooms that fill fastest, going round them so no hour is spent waiting in one
      const goal = tallyOf(p.w, "FAMILIAR") + n;
      const rooms = Object.values(ROOMS)
        .filter((r) => r.drops.length && r.familiarSize > 0)
        .sort((a, b) => a.familiarSize - b.familiarSize)
        .slice(0, Math.max(n, 3))
        .map((r) => r.index);
      for (let i = 0; tallyOf(p.w, "FAMILIAR") < goal; i++) {
        if (i > 300) throw new Error(`${q.id}: could not fill ${n} rooms' bars`);
        p.lookAround(rooms[i % rooms.length]);
      }
      return;
    }
    case "FIND":
      if (idx === undefined) {
        for (let got = 0; got < n; ) got += p.lookAround().reduce((t, f) => t + f.n, 0);
        return;
      }
      return p.find(Number(idx), n);
    case "DISTINCT": {
      const [type, sub] = String(idx).split(":");
      if (type === "FIND") {
        const kinds = () => Object.keys(p.w.tally ?? {}).filter((k) => k.startsWith("FIND:") && k !== "FIND:0").length;
        const goal = kinds() + n;
        const rooms = Object.values(ROOMS).filter((r) => r.drops.length);
        for (let i = 0; kinds() < goal; i++) {
          if (i > 300) throw new Error(`${q.id}: could not find ${n} new kinds`);
          p.lookAround(rooms[i % rooms.length]!.index);
        }
        return;
      }
      if (type === "FORAGE") {
        // places never looked around in, nearest first in the room list
        const fresh = Object.values(ROOMS).filter((r) => r.drops.length && !tallyOf(p.w, "FORAGE", r.index)).slice(0, n);
        if (fresh.length < n) throw new Error(`${q.id}: only ${fresh.length} new places left`);
        for (const r of fresh) p.lookAround(r.index);
        return;
      }
      // five different foods really eaten
      if (type === "FED") return void [11110, 11120, 11140, 11302, 11313].forEach((f) => p.eat(f));
      // Builders' Lane is a screen, not a room: its visits are counted by hand, as the app counts them
      if (type === "MEET") return void ["behemoth", "mars", "tapboy", "builder", "diver"].forEach((id) => p.app("MEET", id));
      if (type === "MEET_DAY")
        return void [0, 1, 2].forEach((d) => {
          if (d) p.away(24 * 60);
          p.tend();
          p.app("MEET_DAY", `${sub}-${localDay(p.now, 0)}`, 1, false);
        });
      if (type === "HEALTHY_DAY") {
        // three real days on which the pet was seen with every need at least a quarter full
        for (let d = 0; d < 3; d++) {
          if (d) p.away(24 * 60);
          for (let i = 0; i < 6 && needsMinOf(p.pet) < 250; i++) {
            // meals bought when the bag is empty, and a tired pet put to bed first: food and energy are needs too
            p.stock();
            if (p.life.energy() < 300) p.rest();
            p.tend();
            p.ready(200);
            p.life.care({ kind: "play" }, p.now);
          }
          // seen awake, as the client counts a healthy day
          if (p.pet.asleep) p.life.care({ kind: "wake" }, p.now);
          p.pass(1);
        }
        return;
      }
      throw new Error(`${q.id}: no way to raise DISTINCT ${idx}`);
    }
    case "DISTINCT_TODAY":
      // a sweet, a fruit and a savoury food eaten today
      return void [11140, 11313, 11302].forEach((f) => p.eat(f));
    case "CRAFT":
      if (idx === undefined) for (let i = 0; i < n; i++) p.make(1102);
      else for (let i = 0; i < n; i++) p.make(Number(idx));
      return;
    case "MAKE":
      for (let i = 0; i < n; i++) p.sew(String(idx));
      return;
    case "BUY": {
      const item = ROOMS[13]!.shop[0]!;
      p.goTo(13);
      p.afford(n * ITEM[item]!.price!);
      for (let i = 0; i < n; i++) p.must(buy(p.w, item), "buy");
      return;
    }
    case "GIVE_TO": {
      const [who, item] = String(idx).split(":") as [string, string | undefined];
      const it = item ? Number(item) : 1002;
      p.have(it, n);
      p.must(giveTo(p.w, who, it, n), `give ${who} ${it}`);
      return;
    }
    case "GIVE":
      p.have(idx === undefined ? 1002 : Number(idx), n);
      p.must(giveTo(p.w, "wick", idx === undefined ? 1002 : Number(idx), n), "give");
      return;
    case "WALK":
      for (let i = 0; i < n; i++) p.walk();
      return;
    case "TRIP":
      for (let i = 0; i < n; i++) p.trip(idx === undefined ? "seaside" : String(idx));
      return;
    case "TOGETHER_WHEN":
      return p.together(String(idx), n);
    case "CHOOSE": {
      const [want, room] = String(idx).split("-") as [string, string | undefined];
      return p.choose(want, room === undefined ? undefined : Number(room), n);
    }
    case "CARE":
      return p.care(String(idx), n);
    case "LESSON": {
      // a real lesson, taught as the client teaches it; a full mind forgets its oldest lesson to make room
      for (let i = 0; i < n; i++) {
        const before = tallyOf(p.w, "LESSON");
        p.life.teachNext(p.now, 0, () => {});
        if (tallyOf(p.w, "LESSON") === before && p.pet.lessons.length) {
          p.life.set(arrangeLessons(p.pet, p.pet.lessons.length - 1, "forget"));
          p.life.teachNext(p.now, 0, () => {});
        }
        if (tallyOf(p.w, "LESSON") === before) throw new Error(`${q.id}: no lesson could be taught`);
      }
      return;
    }
    case "SPAR":
      // a real spar, against the softest partner
      for (let i = 0; i < n; i++) p.life.spar(PARTNERS[0]!, p.now);
      return;
    case "SAVE":
    case "GIFT":
      return p.app(c.type, 0, c.logic.startsWith("CURR") ? Math.max(0, n - tallyOf(p.w, c.type)) || 0 : n);
    case "TALK":
    case "MEET":
    case "EVENT":
      return p.app(c.type, idx ?? (c.type === "MEET" ? "behemoth" : c.type === "TALK" ? "praline" : 0), n);
    case "ITEM":
      return p.have(Number(idx), n);
    case "NEEDS": {
      // every need brought above the line through real care, with a little to spare for the walk to whoever asks
      const aim = n + 50;
      for (let i = 0; i < 12 && needsMinOf(p.pet) < aim; i++) {
        p.tend();
        if (p.pet.meters.energy / 60 < aim) p.rest();
        if (p.pet.meters.joy / 60 < aim) {
          p.ready(150);
          p.life.care({ kind: "play" }, p.now);
        }
        if (p.life.food() < aim) {
          p.stock();
          p.feed();
        }
        if (p.pet.meters.clean / 60 < aim) p.life.care({ kind: "clean" }, p.now);
      }
      if (needsMinOf(p.pet) < n) throw new Error(`${q.id}: needs stayed under ${n}: ${JSON.stringify(p.pet.meters)}`);
      return;
    }
    case "STAGE":
      // grown up by real days of care
      for (let d = 0; STAGE_ORDER.indexOf(stageOf(p.pet, p.now)) < n; d++) {
        if (d > 40) throw new Error(`${q.id}: the pet did not grow to ${STAGE_ORDER[n]}`);
        p.away(12 * 60);
        p.tend();
      }
      return;
    case "PETS":
      p.pets = Math.max(p.pets, n);
      return;
    case "PLACED": {
      const owned = p.w.decor?.owned ?? [];
      if (owned.length < n) throw new Error(`${q.id}: only ${owned.length} decorations owned`);
      owned.slice(0, n).forEach((id, i) => p.must(placeDecor(p.w, id, 20 + i * 20, 100), `place ${id}`));
      return;
    }
    case "TRUST_LEVEL":
    case "QUEST":
      return; // earned by earlier quests; the status check below proves it
    default:
      throw new Error(`${q.id}: the playthrough has no way to do ${c.type}`);
  }
}

/** Play one quest to its hand-in; an objective out of the real pet's reach leaves it taken but undone. */
function play(p: Player, q: QuestDef, outOfReach: Map<string, string>): boolean {
  // what opens it, in the world (a resident's arc opens on entering their room)
  for (const c of q.requires) if (c.type === "VISIT" && tallyOf(p.w, "VISIT", c.index ?? 0) < (c.value ?? 1)) p.arrive(Number(c.index));
  for (const c of q.requires) if (c.type === "MEET" && tallyOf(p.w, "MEET", c.index ?? 0) < 1) p.app("MEET", c.index ?? "behemoth");
  expect(questStatus(q, p.w, p.view()), `${q.id} should be open`).toBe("available");
  p.must(acceptQuest(p.w, q, p.view()), `accept ${q.id}`);
  p.stock();
  const giverRoom = ROOMS[{ wick: 64, praline: 13, yonder: 3, bolt: 5, flit: 56, why: 59, jab: 89, twain: 19, nimbus: 53 }[q.giver] ?? -1];
  const started = p.now;
  const rested = p.rested;
  const waited = p.waited;
  try {
    for (const o of q.objectives) satisfy(p, o.cond, q);
    // hand-in happens with the giver: go to them, then read the quest book there
    if (giverRoom && !q.objectives.some((o) => o.cond.type === "ROOM")) p.goTo(giverRoom.index);
    // as a player reads the quest book after an errand: anything that slipped while doing the rest is done again, a
    // few times at most (where to be comes last, since the rest can take the player elsewhere)
    for (let look = 0; look < 3; look++) {
      const after = questProgress(q, p.w, p.view());
      const slipped = q.objectives.filter((_, i) => !after[i]!.met);
      if (!slipped.length) break;
      for (const o of [...slipped.filter((o) => o.cond.type !== "ROOM"), ...slipped.filter((o) => o.cond.type === "ROOM")]) satisfy(p, o.cond, q);
    }
  } catch (e) {
    if (!(e instanceof OutOfReach)) throw e;
    outOfReach.set(q.id, e.message);
    return false;
  }
  p.hours[q.id] = (p.now - started) / HOUR;
  p.restedIn[q.id] = p.rested - rested;
  p.waitedIn[q.id] = p.waited - waited;
  const prog = questProgress(q, p.w, p.view());
  const left = q.objectives.flatMap((o, i) => (prog[i]!.met ? [] : [`${o.text.en} (${prog[i]!.have}/${prog[i]!.need})`]));
  expect(left, `${q.id} ${q.title.en}: still to do`).toEqual([]);
  p.must(completeQuest(p.w, q, p.view()), `hand in ${q.id}`);
  p.log.push(q.id);
  return true;
}

/**
 * The quest as a player reads it in each language, with the pet's name filled in as the game fills it: title,
 * every line of the introduction and closing, every objective. English must read as English and Chinese as Chinese,
 * nothing may be empty, and no placeholder may be left unfilled.
 */
const CJK = /[㐀-鿿]/;
const read: Record<"en" | "zh", number> = { en: 0, zh: 0 };
function readBoth(q: QuestDef): string[] {
  const faults: string[] = [];
  for (const lang of ["en", "zh"] as const) {
    const name = lang === "zh" ? "团团" : "Mochi";
    const texts = [q.title[lang], ...q.intro.map((l) => l[lang]), ...q.outro.map((l) => l[lang]), ...q.objectives.map((o) => o.text[lang])];
    for (const raw of texts) {
      const t = raw.replaceAll("{name}", name);
      read[lang]++;
      if (!t.trim()) faults.push(`${q.id} ${lang}: empty`);
      else if (/\{\w+\}/.test(t)) faults.push(`${q.id} ${lang}: unfilled "${t.slice(0, 40)}"`);
      else if (lang === "zh" && !CJK.test(t)) faults.push(`${q.id} zh: not Chinese "${t.slice(0, 40)}"`);
      else if (lang === "en" && CJK.test(t)) faults.push(`${q.id} en: Chinese in English "${t.slice(0, 40)}"`);
    }
  }
  return faults;
}

/**
 * The story quests an honest player alone cannot finish today, and every quest that waits on one of them. Empty since
 * G8: the pet's choices while away count (quest 43), and quest 51 takes three mint as well. A new entry is a defect.
 */
const OUT_OF_REACH: Readonly<Record<string, string>> = {};

/** What the old playthrough reached that only the quests above lead to: nothing, since G8. */
const KEPT_BACK = { pieces: [] as string[], decor: [] as string[], trust: [] as string[] };

describe("the automated playthrough", () => {
  it("plays every story quest through the game's own rules, alone, with real coins, real energy and its pet's own choices", () => {
    const p = new Player();
    const faults: string[] = [];
    const outOfReach = new Map<string, string>();
    const left = new Set(STORY.map((q) => q.id));
    for (let round = 0; left.size && round < 100; round++) {
      let progressed = false;
      for (const q of STORY) {
        if (!left.has(q.id) || outOfReach.has(q.id)) continue;
        const reqsMet = q.requires.every((c) => c.type !== "QUEST" || p.w.quests?.done[String(c.index)] !== undefined);
        const trustOk = q.objectives.every((o) => o.cond.type !== "TRUST_LEVEL" || questStatus(q, p.w, p.view()) !== "locked");
        if (!reqsMet || !trustOk) continue;
        const done = play(p, q, outOfReach);
        faults.push(...readBoth(q));
        if (done) left.delete(q.id);
        progressed = true;
      }
      if (!progressed) break;
    }
    if (process.env.SHOW_HOURS) {
      console.log(Object.entries(p.hours).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, h]) => `${id} ${h.toFixed(1)}h (${p.restedIn[id]!.toFixed(1)}h asleep, ${p.waitedIn[id]!.toFixed(1)}h waiting for the hour)`).join(", "));
      console.log(`days played ${((p.now - START) / 86_400_000).toFixed(1)}, slept ${p.rested.toFixed(0)}h, ${p.spars} spars for ${p.sparCoins} coins, ${p.life.mistakes} care mistakes`);
      console.log([...outOfReach].map(([id, why]) => `${id}: ${why}`).join("\n"));
    }
    // what an honest solo player cannot finish, and why; everything else is finished
    expect(Object.fromEntries(outOfReach), "objectives out of the real pet's reach").toEqual(OUT_OF_REACH);
    const blocked = (q: QuestDef): boolean => outOfReach.has(q.id) || q.requires.some((c) => c.type === "QUEST" && blocked(STORY.find((x) => x.id === c.index)!));
    expect([...left].sort(), "quests left undone").toEqual(STORY.filter(blocked).map((q) => q.id).sort());
    expect(p.log).toHaveLength(STORY.length - STORY.filter(blocked).length);
    // every quest played was read in both languages as it was handed in
    expect(faults, "quest text a player could not read").toEqual([]);
    expect(read.en).toBe(read.zh);
    expect(read.en).toBeGreaterThan(p.log.length * 4);
    // nothing asks a player to wait more than a night (36-QUEST-LINE.md §1), except quests that are about days (saving
    // several days, coming back on different days, growing up). Counted now without the hours the pet slept to get its
    // energy back, which the old held-up energy hid, and the hours waited for the time of day a quest names; both are
    // real waits, reported with SHOW_HOURS, and the plan's rows weigh them (G3 the energy, G4 the pacing)
    const aboutDays = (q: QuestDef) => q.objectives.some((o) => (o.cond.type === "SAVE" && (o.cond.value ?? 1) > 1) || o.cond.type === "STAGE" || /HEALTHY_DAY|MEET_DAY/.test(String(o.cond.index)));
    const slow = STORY.filter((q) => p.hours[q.id] !== undefined && !aboutDays(q) && p.hours[q.id]! - p.restedIn[q.id]! - p.waitedIn[q.id]! > 16).map((q) => `${q.id} ${p.hours[q.id]!.toFixed(1)}h`);
    expect(slow, "quests that took more than a night awake").toEqual([]);
    // every reward landed: each finished quest's keepsakes are owned (the old fixed list less what only the quests out
    // of reach give), and trust reached its levels
    const given = (kind: "piece" | "decor") => STORY.filter((q) => p.log.includes(q.id)).flatMap((q) => q.rewards.flatMap((r) => (r.kind === kind ? [r.id] : [])));
    expect(p.w.wardrobe?.owned).toEqual(expect.arrayContaining(given("piece")));
    expect(p.w.decor?.owned).toEqual(expect.arrayContaining(given("decor")));
    const missing = (ids: string[], owned: string[] = []) => ids.filter((id) => !owned.includes(id));
    expect(missing(["charm", "ribbon", "ranger", "goggles", "net", "nurse", "headband", "whistle", "seal", "dream", "b:lamps13", "b:telescope", "b:handheld", "b:hardhat"], p.w.wardrobe?.owned), "pieces only quests out of reach give").toEqual(KEPT_BACK.pieces);
    expect(missing(["postcard", "starmap", "photo", "portrait", "firstaid", "pillow", "cloud", "dreamjar", "eggshell", "nameplate", "sign", "mapframe"], p.w.decor?.owned), "decor only quests out of reach give").toEqual(KEPT_BACK.decor);
    const residents = ["wick", "praline", "yonder", "bolt", "flit", "why", "jab", "twain", "nimbus"];
    for (const who of residents) {
      const owed = STORY.filter((q) => p.log.includes(q.id)).reduce((t, q) => t + q.rewards.reduce((n, r) => n + (r.kind === "trust" && r.who === who ? r.n : 0), 0), 0);
      expect(p.w.trust?.[who] ?? 0, who).toBe(owed);
    }
    expect(residents.filter((who) => (p.w.trust?.[who] ?? 0) < 30), "residents whose arc waits on a quest out of reach").toEqual(KEPT_BACK.trust);
    // the coins were earned, never granted: everything held was paid in by the world or by spar wins
    expect(tallyOf(p.w, "COINS_EARNED") - tallyOf(p.w, "COINS_SPENT") + 30).toBe(p.w.coins);
  }, 600_000);

  it("finishes every daily, across real days, and earns the weekly gift without a streak", () => {
    const p = new Player();
    const seen = new Set<string>();
    const faults: string[] = [];
    const outOfReach = new Map<string, string>();
    for (let day = 0; seen.size < DAILIES.length && day < 120; day += 2) {
      // every other day: a missed day never costs a daily (the pet, being real, misses its owner meanwhile)
      p.away(Math.max(0, START + day * 86_400_000 - p.now) / MIN);
      p.tend();
      p.stock();
      p.w = rollDailies(p.w, DAILIES, p.view(), 0);
      for (const id of p.w.quests!.today!.offered) {
        const q = DAILIES.find((x) => x.id === id)!;
        try {
          for (const o of q.objectives) satisfy(p, o.cond, q);
        } catch (e) {
          if (!(e instanceof OutOfReach)) throw e;
          outOfReach.set(id, e.message);
          continue;
        }
        // the day can run out while the pet sleeps or the player waits for the evening: the next offer tries again
        if (localDay(p.now, 0) !== p.w.quests!.today!.day) continue;
        expect(questStatus(q, p.w, p.view()), `${id} on day ${day}`).toBe("ready");
        p.must(completeQuest(p.w, q, p.view()), `hand in ${id}`);
        faults.push(...readBoth(q));
        seen.add(id);
      }
    }
    expect(Object.fromEntries(outOfReach), "dailies out of the real pet's reach").toEqual({});
    expect(DAILIES.filter((q) => !seen.has(q.id)).map((q) => q.id)).toEqual([]);
    expect(faults, "daily text a player could not read").toEqual([]);
    expect(weeklyGiftsWaiting(p.w)).toBeGreaterThanOrEqual(1);
    const coins = p.w.coins;
    p.must(claimWeekly(p.w, WEEKLY_GIFT), "weekly gift");
    expect(p.w.coins).toBe(coins + 60);
  }, 600_000);
});
