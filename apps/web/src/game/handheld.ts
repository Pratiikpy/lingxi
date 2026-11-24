/**
 * Taking a pet along on the handheld, and bringing it home (plan 4.14).
 *
 * Out: the pet's brain is the circuit on X Layer when the brain it runs now is taped out (read from the processor,
 * every REF target with it); otherwise the very circuit the game runs, a child's or an instinct's composed by REF
 * as it would be on chain. Before the pet leaves, that circuit is checked against the pet's own brain on every
 * input word, so the handheld can never run a different mind. The snacks chosen leave the bag; the pet waits at home,
 * frozen, as it does at a friend's or at the adoption centre.
 *
 * Home: the packet the handheld sends back is replayed by the game from the state it kept, through that same
 * circuit (packages/handheld bringHome). Only an exact replay brings the pet home; its care counts as care given at
 * home; uneaten snacks go back in the bag. If the handheld is lost, the pet can come back as it left.
 *
 * The browser handheld (handheld.html) is on this same site: the packet goes to it through local storage, and so
 * does the packet back. A real Cardputer takes the same packets over USB (game/cardputer.ts).
 */

import { REF, decode, hexToBytes, refKey } from "@lingxi/brain";
import { type Pet, BEAT_MS, stageOf, ruleSkillIds } from "@lingxi/game";
import { readNetlist } from "@lingxi/chain";
import {
  type BrainPart,
  type HomeRefusal,
  type Snack,
  type TripBrain,
  arrivingIn,
  bringHome,
  gameCircuit,
  petDigest,
  returnEndBeat,
  sameMind,
  tripBrainOf,
  tripPacket,
} from "@lingxi/handheld";
import { ITEM } from "@lingxi/world";
import type { Address } from "viem";
import { deployment, mindKey, publicClient, recordOf } from "./chain";
import { useExtras } from "./extras";
import { brainOf, countCare, useGame } from "./store";
import { useWorld } from "./world";
import { DEVICE_KEY, INBOX_KEY, RETURN_KEY, TRIP_KEY, fromB64 } from "./handheldKeys";
import { saveRemove, saveWrite } from "./saveRuntime";
import { clock, now } from "./gameClock";

export { DEVICE_KEY, INBOX_KEY, RETURN_KEY, TRIP_KEY, fromB64 };

export const HANDHELD = "handheld";

export const MAX_SNACK_KINDS = 4;
export const MAX_SNACKS_EACH = 9;

export interface Trip {
  /** absent on trips from before the Cardputer link: those went to the browser handheld */
  via?: Via;
  petKey: string;
  start: Pet;
  packet: string;
  snacks: Array<Snack & { item: number }>;
  brain: {
    source: "chain" | "game";
    processor: string;
    id: string;
    root: string;
    parts: Array<{ processor: string; id: string; nIn: number; nOut: number; hex: string }>;
  };
  sentAt: number;
}

export const atHandheld = (pet: Pet): boolean => pet.away?.code === HANDHELD;

const b64 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const hex = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;

export function readTrip(): Trip | null {
  try {
    const raw = localStorage.getItem(TRIP_KEY);
    return raw ? (JSON.parse(raw) as Trip) : null;
  } catch {
    return null;
  }
}
function writeTrip(t: Trip | null): void {
  if (t) saveWrite(TRIP_KEY, JSON.stringify(t));
  else saveRemove(TRIP_KEY);
}

/* ── the brain that travels ───────────────────────────────────────────── */

/** a circuit read from the processor, with every circuit its REFs name */
async function fromChain(processor: string, id: bigint): Promise<TripBrain> {
  const root = await readNetlist(publicClient, processor as Address, id);
  const bytes = hexToBytes(root.bytes);
  const parts: BrainPart[] = [];
  const seen = new Set<string>();
  const walk = async (b: Uint8Array, nIn: number, depth: number): Promise<void> => {
    if (depth > 4) throw new Error("circuit nests too deeply");
    for (const e of decode(b, nIn)) {
      if (e.op !== REF || seen.has(refKey(e.cpu, e.id))) continue;
      seen.add(refKey(e.cpu, e.id));
      const n = await readNetlist(publicClient, e.cpu as Address, e.id);
      const sb = hexToBytes(n.bytes);
      parts.push({ processor: e.cpu, id: e.id, nIn: n.nIn, nOut: n.nOut, bytes: sb });
      await walk(sb, n.nIn, depth + 1);
    }
  };
  await walk(bytes, root.nIn, 0);
  return { processor, id, bytes, parts };
}

export async function travellingBrain(pet: Pet): Promise<{ trip: TripBrain; source: "chain" | "game" }> {
  const r = recordOf(pet);
  const id = r?.brains?.[mindKey(pet.lessons ?? [], pet.instincts ?? 0, pet.outside, ruleSkillIds(pet.growth))];
  if (deployment && id) {
    try {
      return { trip: await fromChain(deployment.processor, BigInt(id)), source: "chain" };
    } catch {
      // X Layer cannot be read now: the game's own circuit goes, and says so
    }
  }
  return { trip: gameCircuit(pet), source: "game" };
}

/* ── setting out ──────────────────────────────────────────────────────── */

export type TakeRefusal = "busy" | "noSnacks" | "tooMany" | "different" | "unreachable" | "device";

/** where the pet goes: the browser handheld on this site, or a Cardputer over USB */
export type Via = "browser" | "cardputer";

/** hands the packet to a real handheld; throws, with a reason a player can read, if it did not take the pet */
export type Deliver = (packet: Uint8Array) => Promise<void>;

/** the bag's foods a pet can take, best first */
export function travelFoods(bag: Record<number, number>): Array<{ item: number; n: number }> {
  return Object.entries(bag)
    .map(([k, n]) => ({ item: Number(k), n }))
    .filter((x) => x.n > 0 && ITEM[x.item]?.kind === "food" && ITEM[x.item]!.use)
    .sort((a, b) => (ITEM[b.item]!.use!.food ?? 0) - (ITEM[a.item]!.use!.food ?? 0));
}

const STAGE_INDEX: Record<string, number> = { baby: 1, child: 2, teen: 3, adult: 4, elder: 5 };

export async function takeAlong(
  pet: Pet,
  picks: ReadonlyArray<{ item: number; n: number }>,
  lang: "en" | "zh",
  deliver?: Deliver,
): Promise<{ ok: true; source: "chain" | "game" } | { ok: false; reason: TakeRefusal; detail?: string }> {
  if (pet.away || pet.sitting || readTrip()) return { ok: false, reason: "busy" };
  const chosen = picks.filter((p) => p.n > 0);
  if (chosen.length > MAX_SNACK_KINDS || chosen.some((p) => p.n > MAX_SNACKS_EACH))
    return { ok: false, reason: "tooMany" };
  const bag = useWorld.getState().world.bag;
  if (chosen.some((p) => (bag[p.item] ?? 0) < p.n || ITEM[p.item]?.kind !== "food" || !ITEM[p.item]!.use))
    return { ok: false, reason: "noSnacks" };

  const { trip: brainOut, source } = await travellingBrain(pet);
  const travelling = tripBrainOf(brainOut);
  if (!(await sameMind(brainOf(pet), travelling.brain, pet.brain))) return { ok: false, reason: "different" };

  // the pet as it is this very beat: what the handheld starts from and what the game will replay from
  const current = useGame.getState().pets.find((p) => p.bornAt === pet.bornAt) ?? pet;
  const r = recordOf(current);
  const snacks = chosen.map((p) => {
    const def = ITEM[p.item]!;
    return {
      item: p.item,
      id: String(p.item),
      count: p.n,
      effect: { ...def.use! },
      name: { en: def.name.en.slice(0, 24), zh: def.name.zh.slice(0, 8) },
    };
  });
  const packet = tripPacket(current, brainOut, snacks, {
    name: current.name,
    line: current.line,
    stage: STAGE_INDEX[stageOf(current, now())] ?? 1,
    form: 0,
    colour: r ? (useExtras.getState().colours[r.petId] ?? 0) : 0,
    lang,
    bornBeat: Math.floor(current.bornAt / 60_000),
  });
  // a real handheld takes the pet first; only once it has does anything change here
  if (deliver) {
    try {
      await deliver(packet);
    } catch (e) {
      return { ok: false, reason: "device", detail: e instanceof Error ? e.message : String(e) };
    }
  }
  for (const p of chosen) if (!useWorld.getState().consume(p.item, p.n)) return { ok: false, reason: "noSnacks" };
  const trip: Trip = {
    via: deliver ? "cardputer" : "browser",
    petKey: String(current.bornAt),
    start: current,
    packet: b64(packet),
    snacks,
    brain: {
      source,
      processor: brainOut.processor,
      id: brainOut.id.toString(),
      root: hex(brainOut.bytes),
      parts: brainOut.parts.map((q) => ({
        processor: q.processor,
        id: q.id.toString(),
        nIn: q.nIn,
        nOut: q.nOut,
        hex: hex(q.bytes),
      })),
    },
    sentAt: now(),
  };
  writeTrip(trip);
  if (!deliver) saveWrite(INBOX_KEY, trip.packet);
  saveRemove(RETURN_KEY);
  useGame.getState().replace({ ...current, away: { code: HANDHELD, key: "", until: 0, sitter: null } });
  return { ok: true, source };
}

/* ── coming home ──────────────────────────────────────────────────────── */

function tripBrain(t: Trip): TripBrain {
  return {
    processor: t.brain.processor,
    id: BigInt(t.brain.id),
    bytes: hexToBytes(t.brain.root),
    parts: t.brain.parts.map((q) => ({
      processor: q.processor,
      id: BigInt(q.id),
      nIn: q.nIn,
      nOut: q.nOut,
      bytes: hexToBytes(q.hex),
    })),
  };
}

/** the travelling pet's place in the roster, made the pet on screen; -1 when it is no longer in this game */
function focusTravelling(t: Trip): number {
  const g = useGame.getState();
  const i = g.pets.findIndex((p) => String(p.bornAt) === t.petKey && atHandheld(p));
  if (i >= 0 && g.active !== i) g.switchTo(i);
  return i;
}

function finish(home: Pet, snacksLeft: ReadonlyArray<{ item: number; count: number }>): void {
  const { away: _away, ...back } = home;
  useGame.getState().replace(back as Pet);
  for (const s of snacksLeft) if (s.count > 0) useWorld.getState().receive(s.item, s.count);
  writeTrip(null);
  saveRemove(INBOX_KEY);
  saveRemove(DEVICE_KEY);
  saveRemove(RETURN_KEY);
  // the time since the handheld's last beat passes at home, as after any absence
  useGame.getState().wakeUp();
}

export type HomeResult =
  | { ok: true; minutes: number; cares: number; words: number }
  | { ok: false; reason: HomeRefusal | "noTrip" };

/** Past the minute's boundary by this much before a waited-for log is checked again. */
const ARRIVAL_MARGIN_MS = 50;

/**
 * A6: the handheld's log may end in the minute the game's clock has not quite reached (each page asked the server
 * for the time on its own, moments apart). Waits for the game's clock to reach it, saying how long; a log further
 * ahead is not waited for and the replay refuses it. A clock that has not yet heard from the server asks again
 * before such a log is judged.
 */
async function untilArrived(start: Pet, packet: Uint8Array, onArriving?: (ms: number) => void): Promise<void> {
  const end = returnEndBeat(start, packet);
  if (end === null) return;
  if (end > Math.floor(now() / BEAT_MS) && !clock.synced()) await clock.sync();
  for (let tries = 0; tries < 2; tries++) {
    const ms = arrivingIn(start, packet, now());
    if (ms <= 0) return;
    onArriving?.(ms);
    await new Promise((r) => setTimeout(r, ms + ARRIVAL_MARGIN_MS));
  }
}

/** The homecoming under way in this page, if any: one at a time, so a second call cannot read a trip the first ends. */
let homecoming: Promise<HomeResult> | null = null;

/**
 * Bring the pet home from the packet a handheld sent back. Nothing changes unless the replay matches exactly, and
 * then only after `release` (a Cardputer letting go of the pet) has succeeded, so a pet is never in two places. A log
 * that ends a moment ahead of the game's clock is waited for first (`onArriving` hears for how long). A call made
 * while one is under way (the page starting as the packet lands, say) gets that one's result.
 */
export function bringPetHome(
  packet: Uint8Array,
  release?: () => Promise<void>,
  onArriving?: (ms: number) => void,
): Promise<HomeResult> {
  homecoming ??= homecomingOf(packet, release, onArriving).finally(() => {
    homecoming = null;
  });
  return homecoming;
}

async function homecomingOf(
  packet: Uint8Array,
  release?: () => Promise<void>,
  onArriving?: (ms: number) => void,
): Promise<HomeResult> {
  const first = readTrip();
  if (!first) return { ok: false, reason: "noTrip" };
  await untilArrived(first.start, packet, onArriving);
  // the trip is read again after any wait: the pet may have been called back meanwhile
  const t = readTrip();
  if (!t || t.packet !== first.packet || focusTravelling(t) < 0) return { ok: false, reason: "noTrip" };
  const { brain } = tripBrainOf(tripBrain(t));
  const r = bringHome(t.start, brain, t.snacks, packet, now());
  if (!r.ok) return r;
  if (release) await release();
  for (const c of r.cares) countCare(c.kind, c.wasAsleep, c.result);
  finish(
    r.pet,
    t.snacks.map((s, i) => ({ item: s.item, count: r.snacks[i]?.count ?? 0 })),
  );
  return { ok: true, minutes: r.pet.beat - t.start.beat, cares: r.cares.length, words: r.words };
}

/** The handheld's packet back, if the browser handheld left one. */
export function pendingReturn(): Uint8Array | null {
  const s = localStorage.getItem(RETURN_KEY);
  return s ? fromB64(s) : null;
}

/** The handheld is lost or broken: the pet comes back as it left, all its snacks with it; its days there are gone. */
export function callBack(): boolean {
  const t = readTrip();
  if (!t) return false;
  // a Cardputer that turns up again still carries the pet: it is let go the next time it is plugged in
  if (t.via === "cardputer") owe(petDigest(t.start, 0));
  if (focusTravelling(t) < 0) {
    // the pet is no longer in this game: its snacks still come back
    for (const s of t.snacks) useWorld.getState().receive(s.item, s.count);
    writeTrip(null);
    return true;
  }
  finish(
    t.start,
    t.snacks.map((s) => ({ item: s.item, count: s.count })),
  );
  return true;
}

/* ── pets called back from a Cardputer that was not plugged in ─────────── */

const OWED_KEY = "lingxi.handheld.owed.v1";
function owed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(OWED_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function owe(startDigest: string): void {
  saveWrite(OWED_KEY, JSON.stringify([...new Set([...owed(), startDigest])].slice(-16)));
}
/** whether a pet a Cardputer still carries is one this game called back, by the trip's start digest */
export const isOwed = (startDigest: string): boolean => owed().includes(startDigest);
export function settleOwed(startDigest: string): void {
  saveWrite(OWED_KEY, JSON.stringify(owed().filter((d) => d !== startDigest)));
}

/** For the screen: what this trip took and where its brain came from. */
export const tripSummary = (t: Trip) => ({
  snacks: t.snacks,
  source: t.brain.source,
  sentAt: t.sentAt,
  startDigest: petDigest(t.start, 0),
});
