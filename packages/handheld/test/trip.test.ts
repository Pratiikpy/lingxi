/**
 * The pet's life on the handheld against the game: the same pet, the same trip, the same bits after every step.
 * Then the packets: the game sends a pet out, the core plays the trip, the game brings it home by replay and
 * refuses anything that does not replay to the same digest.
 */
import { describe, expect, it } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3";
import { type ItemEffect, type Pet, BEAT_MS, FOODS, SKILLS, createPet, newGrowth } from "@lingxi/game";
import { type HandheldCore } from "../src/core";
import { type Snack, type TripOp, type TripScreen, bringHome, petDigest, readReturn, replayOps, tripPacket } from "../src/trip";
import { type TestBrain, childBrain, loadCore, rng, starterBrain } from "./helpers";

const START = Date.UTC(2026, 10, 17, 3, 0);
const SCREEN: TripScreen = { name: "Mochi", line: "gentle", stage: 1, form: 0, colour: 3, lang: "en", bornBeat: Math.floor(START / BEAT_MS) };
const snacksOf = (): Snack[] => [
  ...FOODS.slice(0, 3).map((f, i) => ({ id: f.id, count: 2 + i, effect: { food: f.food, joy: f.joy, diet: f.diet } as ItemEffect })),
  { id: "tonic", count: 3, effect: { food: 50, joy: -10, energy: 30, xp: 2 } },
];

/** a pet with some of every skill the beat reads, at random levels */
function petWith(tb: TestBrain, seed: number, line: "gentle" | "bold" | "curious" = "gentle"): Pet {
  const r = rng(seed);
  const tz = r.pick([-480, 0, 60, 330, 480, 540]);
  const p = createPet({ name: "Mochi", line, now: START + r.int(600) * BEAT_MS, tzOffsetMin: tz, brain: tb.brain });
  const growth = newGrowth();
  for (const s of SKILLS) if (!s.rule && r.int(3) === 0) growth.skills[s.id] = 1 + r.int(s.max);
  return { ...p, growth };
}

function randomOps(seed: number, n: number): TripOp[] {
  const r = rng(seed);
  const ops: TripOp[] = [];
  for (let i = 0; i < n; i++) {
    const k = r.int(10);
    if (k < 4) ops.push({ op: "live", n: 1 + r.int(40) });
    else if (k < 6) ops.push({ op: "away", n: r.pick([1, 5, 90, 400, 1500, 2500, 5000]) });
    else {
      const kind = 1 + r.int(8);
      ops.push({ op: "care", kind, arg: kind === 1 ? r.int(4) : kind === 2 ? r.int(4) : 0 });
    }
  }
  return ops;
}

/** play ops on the core, one by one, checking the core against the game after each */
function playBoth(core: HandheldCore, start: Pet, tb: TestBrain, ops: TripOp[], snacks: Snack[], label: string, seen?: (p: Pet) => void): Pet {
  expect(core.open(tripPacket(start, tb.trip, snacks, SCREEN)), label).toBe("ok");
  expect(core.digest(), `${label}: start`).toBe(petDigest(start, 0));
  let p = start;
  const left = snacks.map((s) => ({ ...s }));
  ops.forEach((o, i) => {
    if (o.op === "live") for (let j = 0; j < o.n; j++) core.live();
    else if (o.op === "away") core.away(o.n);
    else if (core.care(o.kind, o.arg) === "noSnack") return;
    const done = replayOps(p, tb.brain, [o], left);
    if (!done.ok) throw new Error(`${label}: game refused op ${i} (${done.reason}) the core took`);
    p = done.pet;
    seen?.(p);
    left.splice(0, left.length, ...done.snacks);
    expect(core.digest(), `${label}: after op ${i} ${JSON.stringify(o)}`).toBe(petDigest(p, p.pendingLog.length - start.pendingLog.length));
  });
  return p;
}

describe("the pet's life, bit for bit", () => {
  it("matches the game over 40 random trips with the starter brains and random skills", async () => {
    const core = await loadCore();
    for (let t = 0; t < 40; t++) {
      const line = (["gentle", "bold", "curious"] as const)[t % 3]!;
      const tb = starterBrain(line);
      playBoth(core, petWith(tb, 100 + t, line), tb, randomOps(500 + t, 60), snacksOf(), `trip ${t} (${line})`);
    }
  }, 900_000);

  it("matches the game for a child whose brain REFs both parents", async () => {
    const core = await loadCore();
    for (let t = 0; t < 8; t++) {
      const tb = childBrain(t % 2 ? "bold" : "gentle", t % 3 ? "curious" : "gentle");
      playBoth(core, petWith(tb, 900 + t), tb, randomOps(1900 + t, 60), snacksOf(), `child trip ${t}`);
    }
  }, 900_000);

  it("goes through neglect, sickness, hibernation and waking, and the catch-up limit", async () => {
    const core = await loadCore();
    const tb = starterBrain("gentle");
    const ops: TripOp[] = [
      { op: "away", n: 900 }, // food runs out: a care mistake
      { op: "away", n: 400 }, // six hours empty: ill
      { op: "care", kind: 2, arg: 3 }, // too sick to play
      { op: "care", kind: 7, arg: 0 }, // medicine
      { op: "away", n: 3000 }, // a day empty: hibernates
      { op: "live", n: 3 },
      { op: "care", kind: 1, arg: 0 }, // food ends hibernation
      { op: "away", n: 6000 }, // longer than three days: only the last three are lived
      { op: "care", kind: 6, arg: 0 },
      { op: "care", kind: 6, arg: 0 },
      { op: "care", kind: 4, arg: 0 },
      { op: "live", n: 200 },
      { op: "care", kind: 5, arg: 0 },
    ];
    const states = { sick: false, cured: false, hibernating: false, wokeFromHibernation: false };
    let was: Pet | null = null;
    const end = playBoth(core, petWith(tb, 4242), tb, ops, snacksOf(), "neglect", (p) => {
      if (p.sick) states.sick = true;
      if (was?.sick && !p.sick) states.cured = true;
      if (p.hibernating) states.hibernating = true;
      if (was?.hibernating && !p.hibernating) states.wokeFromHibernation = true;
      was = p;
    });
    expect(states).toEqual({ sick: true, cured: true, hibernating: true, wokeFromHibernation: true });
    expect(end.mistakes ?? 0).toBeGreaterThan(2);
  }, 600_000);
});

describe("taking a pet along and bringing it home", () => {
  async function trip(seed: number) {
    const core = await loadCore();
    const tb = starterBrain("bold");
    const start = petWith(tb, seed, "bold");
    const snacks = snacksOf();
    const ops = randomOps(seed + 1, 40);
    expect(core.open(tripPacket(start, tb.trip, snacks, SCREEN))).toBe("ok");
    for (const o of ops) {
      if (o.op === "live") for (let j = 0; j < o.n; j++) core.live();
      else if (o.op === "away") core.away(o.n);
      else core.care(o.kind, o.arg);
    }
    return { core, tb, start, snacks, back: core.close(), digest: core.digest() };
  }
  const later = (p: Pet) => (p.beat + 400_000) * BEAT_MS;

  it("brings an honest trip home, in the state the handheld reached", async () => {
    const t = await trip(31);
    const home = bringHome(t.start, t.tb.brain, t.snacks, t.back, later(t.start));
    expect(home.ok).toBe(true);
    if (!home.ok) return;
    expect(petDigest(home.pet, home.words)).toBe(t.digest);
    expect(home.words).toBeGreaterThan(0);
    expect(home.pet.pendingLog.length).toBe(t.start.pendingLog.length + home.words);
  });

  it("refuses a damaged packet, another pet's trip, a changed log, a pet that ran ahead of time", async () => {
    const t = await trip(47);
    const now = later(t.start);
    const flip = t.back.slice();
    flip[60] = flip[60]! ^ 1;
    expect(bringHome(t.start, t.tb.brain, t.snacks, flip, now)).toEqual({ ok: false, reason: "damaged" });
    expect(bringHome({ ...t.start, xp: t.start.xp + 1 }, t.tb.brain, t.snacks, t.back, now)).toEqual({ ok: false, reason: "notThisTrip" });
    expect(bringHome(t.start, t.tb.brain, t.snacks, t.back, t.start.beat * BEAT_MS)).toEqual({ ok: false, reason: "aheadOfTime" });
    expect(bringHome(t.start, t.tb.brain, t.snacks, Uint8Array.from([1, 2, 3]), now)).toEqual({ ok: false, reason: "notATrip" });

    // a log changed and resealed: one more live beat claimed than was lived
    const r = readReturn(t.back);
    expect(r.ok).toBe(true);
    const body = t.back.slice(0, t.back.length - 32);
    const dv = new DataView(body.buffer);
    const opsAt = 41;
    let found = false;
    for (let p = opsAt; p < opsAt + dv.getUint32(37, true); ) {
      if (body[p] === 0x10) {
        dv.setUint16(p + 1, dv.getUint16(p + 1, true) + 1, true);
        found = true;
        break;
      }
      p += body[p] === 0x11 ? 5 : 3;
    }
    expect(found).toBe(true);
    const resealed = new Uint8Array(t.back.length);
    resealed.set(body);
    resealed.set(keccak_256(body), body.length);
    expect(bringHome(t.start, t.tb.brain, t.snacks, resealed, now)).toEqual({ ok: false, reason: "differs" });

    // the same log claimed for a different brain
    const other = starterBrain("curious");
    expect(bringHome(t.start, other.brain, t.snacks, t.back, now).ok).toBe(false);
  });

  it("refuses a snack the handheld did not carry", async () => {
    const core = await loadCore();
    const tb = starterBrain("gentle");
    const start = petWith(tb, 77);
    const one: Snack[] = [{ id: "mochi", count: 1, effect: { food: 300, joy: 20, diet: "grain" } }];
    expect(core.open(tripPacket(start, tb.trip, one, SCREEN))).toBe("ok");
    expect(core.care(1, 0)).not.toBe("noSnack");
    expect(core.care(1, 0)).toBe("noSnack");
    expect(core.care(1, 3)).toBe("noSnack");
    const back = core.close();
    const home = bringHome(start, tb.brain, one, back, (start.beat + 10) * BEAT_MS);
    expect(home.ok).toBe(true);
    // the game would refuse a second feed from a ration of one, even if a handheld claimed it
    expect(replayOps(start, tb.brain, [{ op: "care", kind: 1, arg: 0 }, { op: "care", kind: 1, arg: 0 }], one)).toEqual({ ok: false, reason: "noSnack" });
  });

  it("refuses a packet whose brain is not the one it names, or which is cut short or of another version", async () => {
    const core = await loadCore();
    const tb = starterBrain("gentle");
    const start = petWith(tb, 5);
    const good = tripPacket(start, tb.trip, snacksOf(), SCREEN);
    expect(core.open(good)).toBe("ok");
    expect(core.open(good.subarray(0, good.length - 1))).toBe("badCheck");
    const v2 = good.slice();
    v2[4] = 2;
    expect(core.open(v2)).toBe("badVersion");
    expect(core.open(Uint8Array.from([0x4c, 0x58, 0x48, 0x32, ...new Array(60).fill(0)]))).toBe("badMagic");
    // a brain whose bytes were changed after its keccak was taken, the packet resealed: refused before it runs
    const bytes = tb.trip.bytes.slice();
    bytes[10] = bytes[10]! ^ 1;
    const forged = tripPacket(start, { ...tb.trip, bytes }, snacksOf(), SCREEN);
    const at = forged.length - 32 - 1 - 32; // the brain keccak sits after the netlist, before the part count
    forged.set(keccak_256(tb.trip.bytes), at);
    forged.set(keccak_256(forged.subarray(0, forged.length - 32)), forged.length - 32);
    expect(core.open(forged)).toBe("badHash");
    // a brain with the wrong number of memory bits for this pet
    expect(core.open(tripPacket(start, starterBrain("bold").trip, snacksOf(), SCREEN))).toBe(starterBrain("bold").netlist!.latches.length === start.brain.length ? "ok" : "badShape");
  });
});
