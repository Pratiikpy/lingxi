/**
 * The automated playthrough (plan 4.2 done check): a simulated player finishes every story quest and every daily
 * through the world's own rules. It walks the room graph, looks around once an hour where an item really drops,
 * crafts from real recipes, buys in real shops, gives to residents, walks and travels. What the web app counts for
 * the pet (care, lessons, spars, saves, minutes together, the brain's choices, named events) is bumped the way the
 * app bumps it. Wherever a quest offers a path that needs another player, the solo path is taken, so this also
 * proves no quest needs a second player. Anything that cannot be done fails with the quest and the reason.
 */

import { describe, expect, it } from "vitest";
import {
  type Condition,
  type ConditionView,
  DAILIES,
  HOME,
  ITEM,
  MAKE_RECIPES,
  RECIPES,
  ROOMS,
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
  forage,
  giveTo,
  localDay,
  make,
  move,
  neighbours,
  newWorld,
  placeDecor,
  questProgress,
  questStatus,
  rollDailies,
  startTrip,
  startWalk,
  tallyOf,
  weeklyGiftsWaiting,
  DESTINATION,
} from "../src";

const HOUR = 3_600_000;
const ENERGY = 900;
/** Events only another player can cause: the playthrough never relies on them. */
const NEEDS_SOMEONE = (c: Condition) => (c.type === "EVENT" && ["visited-by-friend", "pet-sat", "child-born"].includes(String(c.index))) || c.type === "BOND";

class Player {
  w: WorldState = newWorld("playthrough-seed-1");
  now = Date.UTC(2026, 10, 16, 8);
  stage: "baby" | "child" | "teen" | "adult" = "baby";
  pets = 1;
  needs = 300;
  timeOfDay: 0 | 1 | 2 | 3 = 1;
  wearing: string | null = null;
  log: string[] = [];
  /** game hours each quest took between accepting and handing in */
  hours: Record<string, number> = {};

  view(): ConditionView {
    return { world: this.w, pet: { level: 3, stage: this.stage, onChain: true, needsMin: this.needs }, pets: this.pets, now: this.now, timeOfDay: this.timeOfDay, day: localDay(this.now, 0), bondLevel: 0, goalsDone: [] };
  }
  must<T extends object>(r: ({ ok: true; world: WorldState } & T) | { ok: false; reason: string }, what: string): { ok: true; world: WorldState } & T {
    if (!r.ok) throw new Error(`${what}: ${r.reason}`);
    this.w = r.world;
    return r;
  }
  /** What the web app does for the pet: count it in the tally. */
  app(type: string, index: number | string = 0, n = 1, total = true) {
    this.w = bump(this.w, type, index, n, { total });
  }

  // ── walking the map ──
  step(to: number) {
    this.must(move(this.w, to, ENERGY), `move ${this.w.room}→${to}`);
    this.now += 2 * 60_000; // a walk to the next room takes a couple of minutes
    if (this.wearing) this.app("MOVE_WEARING", this.wearing);
  }
  goTo(room: number) {
    if (this.w.room === room) return;
    const prev = new Map<number, number>([[this.w.room, -1]]);
    const queue = [this.w.room];
    while (queue.length && !prev.has(room)) {
      const r = queue.shift()!;
      for (const n of neighbours(r)) if (!prev.has(n)) (prev.set(n, r), queue.push(n));
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
      for (const n of neighbours(r)) if (!seen.has(n)) (seen.add(n), queue.push(n));
    }
    throw new Error("no room has anything to find");
  }
  lookAround(room?: number) {
    this.goTo(room ?? this.nearestWithDrops());
    for (let i = 0; i < 3; i++) {
      const r = forage(this.w, this.now, ENERGY);
      if (r.ok) return (this.w = r.world), r.found;
      this.now += HOUR; // once per room per hour
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
      this.w = { ...this.w, coins: this.w.coins + 500 };
      this.goTo(shop.index);
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
    this.must(craft(this.w, r.index), `craft ${ITEM[out]?.name.en}`);
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
    this.must(startWalk(this.w, this.now, false), "start walk");
    this.now += 21 * 60_000;
    this.must(endWalk(this.w, this.now), "end walk");
  }
  trip(to: string) {
    this.must(startTrip(this.w, to, this.now), `start trip ${to}`);
    this.now += DESTINATION[to]!.hours * HOUR;
    this.must(endTrip(this.w, this.now), `end trip ${to}`);
  }
  /** Minutes together, as the app counts them, in a room and at a time of day. */
  together(key: string, minutes: number) {
    const [time, where] = key.split("-") as [string, string | undefined];
    if (where && where !== "outside" && where !== "inside") this.goTo(Number(where));
    if (where === "outside") this.goTo(neighbours(HOME)[0]!);
    this.app("TOGETHER_WHEN", time, minutes);
    this.app("TOGETHER_WHEN", key, minutes, false);
  }
}

/** Do whatever one condition asks, through the world's rules where the world owns the act. */
function satisfy(p: Player, c: Condition, q: QuestDef): void {
  const n = c.value ?? 1;
  const idx = c.index;
  switch (c.type) {
    case "ANY": {
      const solo = (c.of ?? []).find((x) => !NEEDS_SOMEONE(x));
      if (!solo) throw new Error(`${q.id} has no solo path`);
      return satisfy(p, solo, q);
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
      if (type === "FED") return void ["11110", "11120", "11140", "11302", "11313"].forEach((f) => p.app("FED", f));
      if (type === "MEET") return void ["behemoth", "mars", "tapboy", "builder", "diver"].forEach((id) => p.app("MEET", id));
      if (type === "HEALTHY_DAY") return void [0, 1, 2].forEach((d) => p.app("HEALTHY_DAY", localDay(p.now + d * 86_400_000, 0), 1, false));
      if (type === "MEET_DAY") return void [0, 1, 2].forEach((d) => p.app("MEET_DAY", `${sub}-${localDay(p.now + d * 86_400_000, 0)}`, 1, false));
      throw new Error(`${q.id}: no way to raise DISTINCT ${idx}`);
    }
    case "DISTINCT_TODAY":
      return void ["sweet", "fruit", "savory"].forEach((g) => p.app(String(idx), `${localDay(p.now, 0)}-${g}`, 1, false));
    case "CRAFT":
      if (idx === undefined) for (let i = 0; i < n; i++) p.make(1102);
      else for (let i = 0; i < n; i++) p.make(Number(idx));
      return;
    case "MAKE":
      for (let i = 0; i < n; i++) p.sew(String(idx));
      return;
    case "BUY":
      p.w = { ...p.w, coins: p.w.coins + 500 };
      p.goTo(13);
      for (let i = 0; i < n; i++) p.must(buy(p.w, ROOMS[13]!.shop[0]!), "buy");
      return;
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
      if (room) p.goTo(Number(room));
      p.app("CHOOSE", want, n);
      if (room) p.app("CHOOSE", String(idx), n, false);
      return;
    }
    case "CARE": {
      const [care, time] = String(idx).split("-") as [string, string | undefined];
      p.app("CARE", care, n);
      if (time) p.app("CARE", String(idx), n, false);
      return;
    }
    case "LESSON":
    case "SPAR":
    case "SAVE":
    case "GIFT":
      return p.app(c.type, 0, c.logic.startsWith("CURR") ? Math.max(0, n - tallyOf(p.w, c.type)) || 0 : n);
    case "TALK":
    case "MEET":
    case "EVENT":
      return p.app(c.type, idx ?? (c.type === "MEET" ? "behemoth" : c.type === "TALK" ? "praline" : 0), n);
    case "ITEM":
      return p.have(Number(idx), n);
    case "NEEDS":
      p.needs = Math.max(p.needs, n);
      return;
    case "STAGE":
      p.stage = "adult";
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

function play(p: Player, q: QuestDef) {
  // what opens it, in the world (a resident's arc opens on entering their room)
  for (const c of q.requires) if (c.type === "VISIT" && tallyOf(p.w, "VISIT", c.index ?? 0) < (c.value ?? 1)) p.arrive(Number(c.index));
  for (const c of q.requires) if (c.type === "MEET" && tallyOf(p.w, "MEET", c.index ?? 0) < 1) p.app("MEET", c.index ?? "behemoth");
  expect(questStatus(q, p.w, p.view()), `${q.id} should be open`).toBe("available");
  p.must(acceptQuest(p.w, q, p.view()), `accept ${q.id}`);
  const started = p.now;
  for (const o of q.objectives) satisfy(p, o.cond, q);
  p.hours[q.id] = (p.now - started) / HOUR;
  const prog = questProgress(q, p.w, p.view());
  const left = q.objectives.filter((_, i) => !prog[i]!.met).map((o, i) => `${o.text.en} (${prog[i]?.have}/${prog[i]?.need})`);
  expect(left, `${q.id} ${q.title.en}: still to do`).toEqual([]);
  // hand-in happens with the giver: go to them
  const giverRoom = ROOMS[{ wick: 64, praline: 13, yonder: 3, bolt: 5, flit: 56, why: 59, jab: 89, twain: 19, nimbus: 53 }[q.giver] ?? -1];
  if (giverRoom && !q.objectives.some((o) => o.cond.type === "ROOM")) p.goTo(giverRoom.index);
  p.must(completeQuest(p.w, q, p.view()), `hand in ${q.id}`);
  p.log.push(q.id);
}

describe("the automated playthrough", () => {
  it("finishes all 80 story quests through the game's own rules, alone", () => {
    const p = new Player();
    const left = new Set(STORY.map((q) => q.id));
    for (let round = 0; left.size && round < 100; round++) {
      let progressed = false;
      for (const q of STORY) {
        if (!left.has(q.id)) continue;
        const reqsMet = q.requires.every((c) => c.type !== "QUEST" || p.w.quests?.done[String(c.index)] !== undefined);
        const trustOk = q.objectives.every((o) => o.cond.type !== "TRUST_LEVEL" || questStatus(q, p.w, p.view()) !== "locked");
        if (!reqsMet || !trustOk) continue;
        play(p, q);
        left.delete(q.id);
        progressed = true;
      }
      if (!progressed) break;
    }
    expect([...left], "quests the playthrough could not reach").toEqual([]);
    expect(p.log).toHaveLength(80);
    // nothing asks a player to wait more than a night (36-QUEST-LINE.md §1), except quests that are about days:
    // saving several days, or coming back on different days
    const aboutDays = (q: QuestDef) => q.objectives.some((o) => (o.cond.type === "SAVE" && (o.cond.value ?? 1) > 1) || /HEALTHY_DAY|MEET_DAY/.test(String(o.cond.index)));
    const slow = STORY.filter((q) => !aboutDays(q) && p.hours[q.id]! > 16).map((q) => `${q.id} ${p.hours[q.id]!.toFixed(1)}h`);
    expect(slow, "quests that took more than a night").toEqual([]);
    if (process.env.SHOW_HOURS) console.log(Object.entries(p.hours).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, h]) => `${id} ${h.toFixed(1)}h`).join(", "));
    // every reward landed: the keepsakes are owned and trust reached its levels
    expect(p.w.wardrobe?.owned).toEqual(expect.arrayContaining(["charm", "ribbon", "ranger", "goggles", "net", "nurse", "headband", "whistle", "seal", "dream", "b:lamps13", "b:telescope", "b:handheld", "b:hardhat"]));
    expect(p.w.decor?.owned).toEqual(expect.arrayContaining(["postcard", "starmap", "photo", "portrait", "firstaid", "pillow", "cloud", "dreamjar", "eggshell", "nameplate", "sign", "mapframe"]));
    for (const who of ["wick", "praline", "yonder", "bolt", "flit", "why", "jab", "twain", "nimbus"]) expect(p.w.trust?.[who] ?? 0, who).toBeGreaterThanOrEqual(30);
  });

  it("finishes every daily, across real days, and earns the weekly gift without a streak", () => {
    const p = new Player();
    const seen = new Set<string>();
    let day = 0;
    for (; seen.size < DAILIES.length && day < 120; day += 2) {
      p.now = Date.UTC(2026, 10, 16, 8) + day * 86_400_000; // every other day: gaps never cost anything
      p.w = rollDailies(p.w, DAILIES, p.view(), 0);
      for (const id of p.w.quests!.today!.offered) {
        const q = DAILIES.find((x) => x.id === id)!;
        for (const o of q.objectives) satisfy(p, o.cond, q);
        expect(questStatus(q, p.w, p.view()), `${id} on day ${day}`).toBe("ready");
        p.must(completeQuest(p.w, q, p.view()), `hand in ${id}`);
        seen.add(id);
      }
    }
    expect(DAILIES.filter((q) => !seen.has(q.id)).map((q) => q.id)).toEqual([]);
    expect(weeklyGiftsWaiting(p.w)).toBeGreaterThanOrEqual(1);
    const coins = p.w.coins;
    p.must(claimWeekly(p.w, WEEKLY_GIFT), "weekly gift");
    expect(p.w.coins).toBe(coins + 60);
  });
});
