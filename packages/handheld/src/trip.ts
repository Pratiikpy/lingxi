/**
 * A pet's trip on the handheld (plan 4.14), the game's side.
 *
 * `tripPacket` hands the pet over: its state, its skill effects, a ration of snacks, what the handheld's screen
 * needs, and the brain as read from X Layer with every circuit its REFs name. `petDigest` is the fixed encoding of
 * the pet's life the C core hashes too. `bringHome` reads what the handheld sent back and replays it from the state
 * the game kept, through the game's own care, liveBeat and catchUp and the circuit from the chain; the pet comes
 * home only if the replay ends in the digest the handheld reported. Nothing the handheld says about the pet is kept.
 *
 * The byte layout is the one core/trip.c reads and writes; all integers are little-endian.
 */

import { keccak_256 } from "@noble/hashes/sha3";
import {
  type Brain,
  type Care,
  type CareResult,
  type ItemEffect,
  type Pet,
  BEAT_MS,
  DIETS,
  TRAITS,
  care,
  catchUp,
  decayLeft,
  effectOf,
  liveBeat,
  sinceCaredOf,
} from "@lingxi/game";

/** 2: the pet carries G3's enjoyment bar, last care beat and need tally; 3: G5's beats since care and beats stalled;
 * 4: D1's beats since each need was answered (four in place of one) */
export const TRIP_VERSION = 4;
export const MAX_SNACKS = 4;
export const NAME_MAX = 48;
export const MAX_PARTS = 32;
export const SNACK_NAME = 31;

export const OP_LIVE = 0x10;
export const OP_AWAY = 0x11;
export const OP_CARE = 0x20;
export const CARE_KINDS = ["", "feed", "play", "clean", "lightsOff", "wake", "pet", "medicine", "talk"] as const;
const MISS_KIND: Record<string, number> = { food: 0, joy: 1, clean: 2, energy: 3, sick: 4 };
const LINE: Record<string, number> = { gentle: 0, bold: 1, curious: 2 };

export interface BrainPart {
  processor: string;
  id: bigint;
  nIn: number;
  nOut: number;
  bytes: Uint8Array;
}

export interface TripBrain {
  processor: string;
  id: bigint;
  /** the netlist as read from X Layer */
  bytes: Uint8Array;
  /** every circuit a REF in the tree names */
  parts: BrainPart[];
}

export interface Snack {
  id: string;
  count: number;
  effect: ItemEffect;
  /** what the handheld calls it, in each language (at most 31 bytes of UTF-8 each) */
  name?: { en: string; zh: string };
}

export interface TripScreen {
  name: string;
  line: "gentle" | "bold" | "curious";
  /** 0 egg, 1 baby, 2 child, 3 teen, 4 adult, 5 elder */
  stage: number;
  /** 0 none, else the adult form's number */
  form: number;
  /** the name colour on chain, 0 plain */
  colour: number;
  lang: "en" | "zh";
  bornBeat: number;
}

/** The skill effects the beat uses, in the order core/pet.h lists them. */
export function effectsOf(p: Pet): number[] {
  const g = p.growth;
  return [
    decayLeft(g, "food"),
    decayLeft(g, "joy"),
    decayLeft(g, "energy"),
    decayLeft(g, "clean"),
    effectOf(g, "SLEEP_GAIN"),
    effectOf(g, "SICK_GRACE"),
    effectOf(g, "HIBERNATE_GRACE"),
    effectOf(g, "FOOD_ITEM"),
    effectOf(g, "JOY_ITEM"),
    effectOf(g, "BATH_JOY"),
    effectOf(g, "KINSHIP_KEEP"),
    effectOf(g, "KINSHIP_SOONER"),
    effectOf(g, "XP_GAIN"),
    effectOf(g, "TRAIT_GROWTH"),
  ];
}

class Writer {
  private bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 0xff);
  }
  u16(v: number) {
    this.u8(v);
    this.u8(v >> 8);
  }
  i32(v: number) {
    for (let i = 0; i < 4; i++) this.u8(v >> (8 * i));
  }
  u64(v: bigint) {
    for (let i = 0n; i < 8n; i++) this.u8(Number((v >> (8n * i)) & 0xffn));
  }
  raw(b: Uint8Array | number[]) {
    for (const x of b) this.u8(x);
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

const hexBytes = (h: string): Uint8Array => {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  if (!/^[0-9a-fA-F]*$/.test(s) || s.length % 2) throw new Error("not hex");
  return Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.slice(2 * i, 2 * i + 2), 16));
};
const toHex = (b: Uint8Array): string => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
const utf8 = (s: string) => new TextEncoder().encode(s);

/** The pet's life as core/pet.c `lx_pet_digest` writes it. `logLength` counts the words logged since it set out. */
export function petDigest(p: Pet, logLength: number): string {
  const w = new Writer();
  w.raw(utf8("LXPET1"));
  w.i32(p.beat);
  for (const m of [p.meters.food, p.meters.joy, p.meters.energy, p.meters.clean]) w.i32(m);
  w.u8(p.asleep ? 1 : 0);
  w.u8(p.hibernating ? 1 : 0);
  w.u8(p.sick ? 1 : 0);
  w.i32(p.starvingBeats);
  w.i32(p.dirtyBeats ?? 0);
  // G5, D1: beats since each need was answered, and beats spent with a need at zero
  for (const v of sinceCaredOf(p)) w.i32(v);
  w.i32(p.stalledBeats ?? 0);
  w.i32(p.mistakes ?? 0);
  const missed = p.missed ?? [];
  w.u8(missed.length);
  for (const m of missed) {
    w.u8(MISS_KIND[m.kind]!);
    w.i32(m.beat);
  }
  w.i32(p.kinship ?? 0);
  w.u8(p.kinBeat === undefined ? 0 : 1);
  w.i32(p.kinBeat ?? 0);
  w.i32(p.brain.length);
  for (const b of p.brain) w.u8(b ? 1 : 0);
  for (const t of TRAITS) w.i32(p.traits[t]);
  w.i32(p.xp);
  w.i32(p.xpCarry ?? 0);
  w.i32(p.traitCarry ?? 0);
  for (const c of [p.counts.feed, p.counts.play, p.counts.clean, p.counts.pet, p.counts.lessons]) w.i32(c);
  for (const d of DIETS) w.i32(p.diet[d]);
  // G3: the enjoyment bar, the beat of the last care thought about, and the care that answered a need
  w.i32(p.enjoy ?? 0);
  w.u8(p.careBeat === undefined ? 0 : 1);
  w.i32(p.careBeat ?? 0);
  w.u8(p.needs ? 1 : 0);
  for (const n of [p.needs?.feed ?? 0, p.needs?.play ?? 0, p.needs?.clean ?? 0, p.needs?.pet ?? 0]) w.i32(n);
  w.raw(hexBytes(p.logHash));
  w.i32(logLength);
  w.u8(p.logBeat === undefined ? 0 : 1);
  w.i32(p.logBeat ?? 0);
  w.u8(p.last.want);
  w.u8(p.last.mood);
  w.u8(p.last.nudge);
  w.i32(p.last.word);
  return toHex(keccak_256(w.done()));
}

/** The packet that sends the pet out (core/trip.c `lx_trip_open` reads it). */
export function tripPacket(p: Pet, brain: TripBrain, snacks: readonly Snack[], screen: TripScreen): Uint8Array {
  if (snacks.length > MAX_SNACKS) throw new Error(`at most ${MAX_SNACKS} snacks`);
  if (brain.parts.length > MAX_PARTS) throw new Error(`at most ${MAX_PARTS} circuits`);
  const name = utf8(screen.name);
  if (name.length > NAME_MAX) throw new Error("name too long");
  const w = new Writer();
  w.raw(utf8("LXH1"));
  w.u8(TRIP_VERSION);
  w.i32(p.beat);
  w.i32(p.tzOffsetMin);
  for (const m of [p.meters.food, p.meters.joy, p.meters.energy, p.meters.clean]) w.i32(m);
  w.u8(p.asleep ? 1 : 0);
  w.u8(p.hibernating ? 1 : 0);
  w.u8(p.sick ? 1 : 0);
  w.i32(p.starvingBeats);
  w.i32(p.dirtyBeats ?? 0);
  // G5, D1: beats since each need was answered, and beats spent with a need at zero
  for (const v of sinceCaredOf(p)) w.i32(v);
  w.i32(p.stalledBeats ?? 0);
  w.i32(p.mistakes ?? 0);
  const missed = p.missed ?? [];
  w.u8(missed.length);
  for (const m of missed) {
    w.u8(MISS_KIND[m.kind]!);
    w.i32(m.beat);
  }
  w.i32(p.kinship ?? 0);
  w.u8(p.kinBeat === undefined ? 0 : 1);
  w.i32(p.kinBeat ?? 0);
  w.u16(p.brain.length);
  for (const b of p.brain) w.u8(b ? 1 : 0);
  for (const t of TRAITS) w.i32(p.traits[t]);
  w.i32(p.xp);
  w.i32(p.xpCarry ?? 0);
  w.i32(p.traitCarry ?? 0);
  for (const c of [p.counts.feed, p.counts.play, p.counts.clean, p.counts.pet, p.counts.lessons]) w.i32(c);
  for (const d of DIETS) w.i32(p.diet[d]);
  // G3: the enjoyment bar, the beat of the last care thought about, and the care that answered a need
  w.i32(p.enjoy ?? 0);
  w.u8(p.careBeat === undefined ? 0 : 1);
  w.i32(p.careBeat ?? 0);
  w.u8(p.needs ? 1 : 0);
  for (const n of [p.needs?.feed ?? 0, p.needs?.play ?? 0, p.needs?.clean ?? 0, p.needs?.pet ?? 0]) w.i32(n);
  w.raw(hexBytes(p.logHash));
  w.u8(p.logBeat === undefined ? 0 : 1);
  w.i32(p.logBeat ?? 0);
  w.u8(p.last.want);
  w.u8(p.last.mood);
  w.u8(p.last.nudge);
  w.u16(p.last.word);
  for (const e of effectsOf(p)) w.u16(e);

  w.i32(screen.bornBeat);
  w.u8(LINE[screen.line]!);
  w.u8(screen.stage);
  w.u8(screen.form);
  w.u8(screen.colour);
  w.u8(screen.lang === "zh" ? 1 : 0);
  w.u8(name.length);
  w.raw(name);

  w.u8(snacks.length);
  for (const s of snacks) {
    const id = utf8(s.id);
    if (id.length > 15) throw new Error("snack id too long");
    w.u16(s.count);
    w.u16(s.effect.food ?? 0);
    w.u16(s.effect.joy ?? 0);
    w.u16(s.effect.energy ?? 0);
    w.u16(s.effect.xp ?? 0);
    w.u8(s.effect.diet ? DIETS.indexOf(s.effect.diet) : -1);
    w.u8(id.length);
    w.raw(id);
    for (const n of [s.name?.en ?? s.id, s.name?.zh ?? s.name?.en ?? s.id]) {
      const b = utf8(n);
      if (b.length > SNACK_NAME) throw new Error(`snack name too long: ${n}`);
      w.u8(b.length);
      w.raw(b);
    }
  }

  w.raw(hexBytes(brain.processor));
  w.u64(brain.id);
  w.u16(16);
  w.u16(8);
  w.i32(brain.bytes.length);
  w.raw(brain.bytes);
  w.raw(keccak_256(brain.bytes));
  w.u8(brain.parts.length);
  for (const q of brain.parts) {
    w.raw(hexBytes(q.processor));
    w.u64(q.id);
    w.u16(q.nIn);
    w.u16(q.nOut);
    w.i32(q.bytes.length);
    w.raw(q.bytes);
  }
  const body = w.done();
  const out = new Uint8Array(body.length + 32);
  out.set(body);
  out.set(keccak_256(body), body.length);
  return out;
}

export type TripOp = { op: "live"; n: number } | { op: "away"; n: number } | { op: "care"; kind: number; arg: number };

export interface TripReturn {
  startDigest: string;
  ops: TripOp[];
  endDigest: string;
  endBeat: number;
}

export type HomeRefusal = "notATrip" | "damaged" | "notThisTrip" | "badLog" | "noSnack" | "aheadOfTime" | "differs";

/** Read the packet the handheld sends back, checking its form only (the replay checks its meaning). */
export function readReturn(b: Uint8Array): { ok: true; trip: TripReturn } | { ok: false; reason: HomeRefusal } {
  if (b.length < 4 + 1 + 32 + 4 + 32 + 4 + 32 || new TextDecoder().decode(b.subarray(0, 4)) !== "LXR1")
    return { ok: false, reason: "notATrip" };
  if (b[4] !== TRIP_VERSION) return { ok: false, reason: "notATrip" };
  const body = b.subarray(0, b.length - 32);
  if (toHex(keccak_256(body)) !== toHex(b.subarray(b.length - 32))) return { ok: false, reason: "damaged" };
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const startDigest = toHex(b.subarray(5, 37));
  const len = dv.getUint32(37, true);
  if (41 + len + 32 + 4 + 32 !== b.length) return { ok: false, reason: "damaged" };
  const ops: TripOp[] = [];
  let p = 41;
  const end = 41 + len;
  while (p < end) {
    const op = b[p]!;
    if (op === OP_LIVE && p + 3 <= end) {
      const n = dv.getUint16(p + 1, true);
      if (n === 0) return { ok: false, reason: "badLog" };
      ops.push({ op: "live", n });
      p += 3;
    } else if (op === OP_AWAY && p + 5 <= end) {
      const n = dv.getUint32(p + 1, true);
      if (n === 0) return { ok: false, reason: "badLog" };
      ops.push({ op: "away", n });
      p += 5;
    } else if (op === OP_CARE && p + 3 <= end) {
      const kind = b[p + 1]!;
      if (kind < 1 || kind >= CARE_KINDS.length) return { ok: false, reason: "badLog" };
      ops.push({ op: "care", kind, arg: b[p + 2]! });
      p += 3;
    } else return { ok: false, reason: "badLog" };
  }
  return {
    ok: true,
    trip: { startDigest, ops, endDigest: toHex(b.subarray(end, end + 32)), endBeat: dv.getInt32(end + 32, true) },
  };
}

function careOf(kind: number, arg: number, snacks: Snack[]): Care | null {
  switch (CARE_KINDS[kind]) {
    case "feed": {
      const s = snacks[arg];
      if (!s || s.count <= 0) return null;
      s.count--;
      return { kind: "feed", food: s.effect };
    }
    case "play":
      return { kind: "play", stars: arg };
    case "clean":
      return { kind: "clean" };
    case "lightsOff":
      return { kind: "lightsOff" };
    case "wake":
      return { kind: "wake" };
    case "pet":
      return { kind: "pet" };
    case "medicine":
      return { kind: "medicine" };
    default:
      return { kind: "talk" };
  }
}

/** A care given on the handheld, as the replay gave it: what it was, whether the pet was asleep, what it did. */
export interface ReplayedCare {
  kind: Care["kind"];
  wasAsleep: boolean;
  result: CareResult;
}

/** Replay a list of trip ops from `start` with the game's own functions. Returns the pet, the snacks left and each care. */
export function replayOps(
  start: Pet,
  brain: Brain,
  ops: readonly TripOp[],
  snacks: readonly Snack[],
): { ok: true; pet: Pet; snacks: Snack[]; cares: ReplayedCare[] } | { ok: false; reason: HomeRefusal } {
  const left = snacks.map((s) => ({ ...s }));
  const cares: ReplayedCare[] = [];
  let p = start;
  for (const o of ops) {
    if (o.op === "live") {
      for (let i = 0; i < o.n; i++) p = liveBeat(p, (p.beat + 1) * BEAT_MS, brain);
    } else if (o.op === "away") {
      p = catchUp(p, (p.beat + o.n) * BEAT_MS, brain);
    } else {
      const c = careOf(o.kind, o.arg, left);
      if (!c) return { ok: false, reason: "noSnack" };
      const result = care(p, c, p.beat * BEAT_MS, brain);
      cares.push({ kind: c.kind, wasAsleep: p.asleep, result });
      p = result.pet;
    }
  }
  return { ok: true, pet: p, snacks: left, cares };
}

/**
 * Bring the pet home: the replay of the handheld's log, from the state the game kept when it left, must end in the
 * digest the handheld reported, and must not run past the present. `now` is the real time in ms.
 */
export function bringHome(
  start: Pet,
  brain: Brain,
  snacks: readonly Snack[],
  packet: Uint8Array,
  now: number,
): { ok: true; pet: Pet; snacks: Snack[]; words: number; cares: ReplayedCare[] } | { ok: false; reason: HomeRefusal } {
  const r = readReturn(packet);
  if (!r.ok) return r;
  const t = r.trip;
  if (t.startDigest !== petDigest(start, 0)) return { ok: false, reason: "notThisTrip" };
  const beats = t.ops.reduce((n, o) => n + (o.op === "care" ? 0 : o.n), 0);
  if (start.beat + beats > Math.floor(now / BEAT_MS) || t.endBeat > Math.floor(now / BEAT_MS))
    return { ok: false, reason: "aheadOfTime" };
  const done = replayOps(start, brain, t.ops, snacks);
  if (!done.ok) return done;
  const words = done.pet.pendingLog.length - start.pendingLog.length;
  if (done.pet.beat !== t.endBeat || petDigest(done.pet, words) !== t.endDigest)
    return { ok: false, reason: "differs" };
  return { ok: true, pet: done.pet, snacks: done.snacks, words, cares: done.cares };
}

/** The last beat a returned packet's log reaches, or null for a packet that cannot be read or is not this trip. */
export function returnEndBeat(start: Pet, packet: Uint8Array): number | null {
  const r = readReturn(packet);
  if (!r.ok || r.trip.startDigest !== petDigest(start, 0)) return null;
  const beats = r.trip.ops.reduce((n, o) => n + (o.op === "care" ? 0 : o.n), 0);
  return Math.max(start.beat + beats, r.trip.endBeat);
}

/**
 * How long to wait before bringing a returned packet home, in ms: 0 to check it now. The handheld and the game read
 * the same clock, but each page asked the server for it on its own, moments apart, so a log can end in the minute
 * the game's clock has not quite reached. Such a log is waited for, never accepted early: `bringHome` still refuses
 * anything past the present. A log further ahead than that is not waited for, and the replay refuses it.
 */
export function arrivingIn(start: Pet, packet: Uint8Array, now: number): number {
  const end = returnEndBeat(start, packet);
  if (end === null || end !== Math.floor(now / BEAT_MS) + 1) return 0;
  return end * BEAT_MS - now;
}
