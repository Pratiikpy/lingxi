/**
 * Friendly spars (LX-SPAR/1). Two pets face each other for up to 16 rounds.
 * Every round each pet's own brain circuit reads the fight through its usual 16
 * pins and its answer becomes its move, so teaching changes how a pet fights and
 * its LATCH memory carries from round to round. Everything is integer and
 * seeded, so a spar replays to the same rounds anywhere.
 *
 * The fight on a pet's pins:
 *   hunger ← its own health (full health = 0 · nearly out = 3)
 *   joy    ← momentum (how the last two rounds went for it)
 *   energy ← stamina bucket
 *   clean  ← the other pet's health (high = 3)
 *   time   ← round phase: morning (opening), day (middle), evening (late); never night
 *   action ← the other pet's last move (as a care action number)
 *   event  ← 3 if it was just hit hard · 2 if the other left an opening (rested
 *            or snacked) · 1 if the other was friendly (charm or gift) · else 0
 *   owner  ← 1 while its owner is cheering
 * Its want becomes a move:
 *   eat → snack (heal)  · play → pounce (attack) · sleep → rest (stamina)
 *   explore → dodge     · sulk → guard           · cuddle → charm (weaken)
 *   share → gift (both heal a little)            · idle → tap (a light swipe)
 * Mood adds power: grumpy −1, calm 0, happy +1, excited +2.
 */

import { type FastBrain, encodeSenses } from "@lingxi/brain";

export const SPAR_VERSION = "LX-SPAR/1";
export const ROUNDS = 16;
export const MAX_HP = 100;
export const MAX_STAMINA = 10;

export const MOVES = ["tap", "snack", "pounce", "rest", "dodge", "guard", "charm", "gift"] as const;
export type Move = (typeof MOVES)[number];

/** A move's number when another pet's brain reads it on the action pins. */
const MOVE_AS_ACTION: Record<Move, number> = { tap: 0, snack: 1, pounce: 2, rest: 0, dodge: 0, guard: 0, charm: 5, gift: 7 };

export interface Fighter {
  name: string;
  brain: FastBrain;
  /** LATCH memory at the start of the spar (copied, never changed) */
  memory: readonly number[];
  /** small stat edges from growth: 0..3 */
  level: number;
}

export interface Side {
  hp: number;
  stamina: number;
  weakened: number;
  memory: number[];
  last: Move;
  momentum: number;
}

export interface Round {
  n: number;
  words: [number, number];
  moves: [Move, Move];
  moods: [number, number];
  hp: [number, number];
  stamina: [number, number];
  hits: [number, number];
}

export interface SparResult {
  version: typeof SPAR_VERSION;
  seed: number;
  rounds: Round[];
  winner: 0 | 1 | -1;
  /** a fingerprint of the whole fight, for sharing and checking */
  digest: string;
}

const bucketUp = (v: number, max: number) => Math.min(3, Math.floor((v * 4) / (max + 1)));
const healthPin = (hp: number) => 3 - bucketUp(hp, MAX_HP);

function xorshift(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}

function word(me: Side, them: Side, round: number, cheering: boolean, hitHard: boolean): number {
  const phase = round < 3 ? 1 : round < ROUNDS - 4 ? 2 : 3;
  const opening = them.last === "rest" || them.last === "snack";
  const friendly = them.last === "charm" || them.last === "gift";
  return encodeSenses({
    hunger: healthPin(me.hp),
    joy: Math.max(0, Math.min(3, me.momentum + 1)),
    energy: bucketUp(me.stamina, MAX_STAMINA),
    clean: bucketUp(them.hp, MAX_HP),
    time: phase,
    action: MOVE_AS_ACTION[them.last],
    event: hitHard ? 3 : opening && round > 0 ? 2 : friendly ? 1 : 0,
    owner: cheering ? 1 : 0,
  });
}

/** djb2 over the round data, as a short hex fingerprint. */
function digestOf(rounds: Round[], seed: number): string {
  let h = 5381 ^ seed;
  for (const r of rounds) for (const v of [r.words[0], r.words[1], MOVES.indexOf(r.moves[0]), MOVES.indexOf(r.moves[1]), r.hp[0], r.hp[1]]) h = ((h * 33) ^ v) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export function spar(a: Fighter, b: Fighter, seed: number, cheer: (round: number) => [boolean, boolean] = () => [false, false]): SparResult {
  const rnd = xorshift(seed);
  const sides: [Side, Side] = [
    { hp: MAX_HP, stamina: MAX_STAMINA, weakened: 0, memory: a.memory.slice(), last: "tap", momentum: 0 },
    { hp: MAX_HP, stamina: MAX_STAMINA, weakened: 0, memory: b.memory.slice(), last: "tap", momentum: 0 },
  ];
  const fighters: [Fighter, Fighter] = [a, b];
  const rounds: Round[] = [];
  let hitHard: [boolean, boolean] = [false, false];
  for (let n = 0; n < ROUNDS; n++) {
    const cheering = cheer(n);
    const words: [number, number] = [word(sides[0], sides[1], n, cheering[0], hitHard[0]), word(sides[1], sides[0], n, cheering[1], hitHard[1])];
    const outs = [0, 1].map((i) => {
      const st = Uint8Array.from(sides[i]!.memory);
      const out = fighters[i]!.brain.step(st, words[i]!);
      sides[i]!.memory = Array.from(st);
      return out;
    });
    let moves = outs.map((o) => MOVES[o & 7]!) as [Move, Move];
    // a pet with no stamina can only rest or tap; now and then an eager pounce slips to a tap
    moves = moves.map((m, i) => (sides[i]!.stamina <= 0 && m !== "rest" && m !== "tap" ? "rest" : m)) as [Move, Move];
    moves = moves.map((m) => (m === "pounce" && rnd() % 8 === 0 ? "tap" : m)) as [Move, Move];
    const moods = outs.map((o) => (o >> 3) & 3) as [number, number];
    const power = moods.map((m, i) => m - 1 + fighters[i]!.level) as [number, number];
    const hits: [number, number] = [0, 0];
    const heal: [number, number] = [0, 0];
    for (const i of [0, 1] as const) {
      const j = (1 - i) as 0 | 1;
      const me = sides[i];
      const m = moves[i];
      const cost = m === "pounce" ? 3 : m === "dodge" || m === "charm" ? 2 : m === "guard" || m === "snack" || m === "gift" ? 1 : 0;
      me.stamina = Math.max(0, me.stamina - cost);
      if (m === "rest") me.stamina = Math.min(MAX_STAMINA, me.stamina + 4);
      if (m === "snack") heal[i] += 12 + power[i] * 2;
      if (m === "gift") {
        heal[i] += 6;
        heal[j] += 6;
      }
      if (m === "charm") sides[j].weakened = 2;
      if (m === "pounce" || m === "tap") {
        let dmg = m === "tap" ? 5 + power[i] + (rnd() % 3) : 12 + power[i] * 3 + (rnd() % 5) + (rnd() % 6 === 0 ? 8 : 0);
        if (me.weakened > 0) dmg = Math.floor(dmg / 2);
        const def = moves[j];
        if (def === "guard") dmg = Math.floor(dmg / 3);
        else if (def === "dodge" && rnd() % 3 !== 0) dmg = 0;
        else if (def === "rest") dmg += 4;
        hits[i] = Math.max(0, dmg);
      }
    }
    for (const i of [0, 1] as const) {
      const j = (1 - i) as 0 | 1;
      sides[j].hp = Math.max(0, sides[j].hp - hits[i]);
      sides[i].hp = Math.min(MAX_HP, sides[i].hp + heal[i]);
      sides[i].weakened = Math.max(0, sides[i].weakened - 1);
      sides[i].last = moves[i];
    }
    for (const i of [0, 1] as const) {
      const j = (1 - i) as 0 | 1;
      const swing = Math.sign(hits[i] - hits[j]);
      sides[i].momentum = Math.max(-1, Math.min(2, sides[i].momentum + swing));
    }
    hitHard = [hits[1] >= 18, hits[0] >= 18];
    rounds.push({ n, words, moves, moods, hp: [sides[0].hp, sides[1].hp], stamina: [sides[0].stamina, sides[1].stamina], hits });
    if (sides[0].hp === 0 || sides[1].hp === 0) break;
  }
  const [h0, h1] = [sides[0].hp, sides[1].hp];
  const winner: 0 | 1 | -1 = h0 === h1 ? -1 : h0 > h1 ? 0 : 1;
  return { version: SPAR_VERSION, seed, rounds, winner, digest: digestOf(rounds, seed) };
}
