/**
 * Team spars (PRD A1, LX-TEAM/1): your pet and up to four companions stand in a
 * line, as in Super Auto Pets, against another team. Every round every unit's
 * own brain circuit chooses its move through the same 16 fight pins as a 1v1
 * spar (see spar.ts). The two front units fight each other; units behind them
 * support: a gift heals the front ally, a charm weakens the enemy front, a snack
 * heals itself, and a pounce or tap from the back lands at half strength. A unit
 * at zero health faints and the next steps up. Everything is integer and
 * seeded, so a battle replays identically anywhere.
 *
 * The fight on a unit's pins, as in 1v1, with the matchup at the front:
 *   hunger ← its own health · joy ← its team's momentum · energy ← its stamina
 *   clean  ← the enemy front's health · time ← round phase (opening, middle, late)
 *   action ← the enemy front's last move · event ← hit hard / opening / friendly
 *   owner  ← cheering (never in team spars, so every replay is the same)
 */

import { type FastBrain, encodeSenses } from "@lingxi/brain";
import { MAX_STAMINA, MOVES, type Move } from "./spar";

export const TEAM_VERSION = "LX-TEAM/1";
export const TEAM_ROUNDS = 24;
export const MAX_TEAM = 5;

export interface TeamUnit {
  /** stable id within the team: "pet" or a companion id with an index */
  id: string;
  name: string;
  brain: FastBrain;
  memory: readonly number[];
  /** starting health (a pet 100; companions by their balance table) */
  hp: number;
  /** small stat edge: 0..3 */
  level: number;
}

interface UnitState {
  hp: number;
  max: number;
  stamina: number;
  weakened: number;
  memory: number[];
  last: Move;
}

export interface TeamRound {
  n: number;
  /** index of each side's front unit this round */
  fronts: [number, number];
  /** per side, per unit: the move (null when fainted) */
  moves: [Array<Move | null>, Array<Move | null>];
  /** per side, per unit: health after the round */
  hp: [number[], number[]];
  /** damage dealt to each side's front this round */
  hits: [number, number];
}

export interface TeamResult {
  version: typeof TEAM_VERSION;
  seed: number;
  rounds: TeamRound[];
  winner: 0 | 1 | -1;
  digest: string;
}

const MOVE_AS_ACTION: Record<Move, number> = { tap: 0, snack: 1, pounce: 2, rest: 0, dodge: 0, guard: 0, charm: 5, gift: 7 };
const bucket = (v: number, max: number) => Math.min(3, Math.floor((v * 4) / (max + 1)));

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

const frontOf = (side: UnitState[]) => side.findIndex((u) => u.hp > 0);

export function teamSpar(a: readonly TeamUnit[], b: readonly TeamUnit[], seed: number): TeamResult {
  if (a.length < 1 || b.length < 1 || a.length > MAX_TEAM || b.length > MAX_TEAM) throw new Error("a team has 1 to 5 units");
  const rnd = xorshift(seed);
  const units: [readonly TeamUnit[], readonly TeamUnit[]] = [a, b];
  const sides: [UnitState[], UnitState[]] = [
    a.map((u) => ({ hp: u.hp, max: u.hp, stamina: MAX_STAMINA, weakened: 0, memory: u.memory.slice(), last: "tap" as Move })),
    b.map((u) => ({ hp: u.hp, max: u.hp, stamina: MAX_STAMINA, weakened: 0, memory: u.memory.slice(), last: "tap" as Move })),
  ];
  const momentum: [number, number] = [0, 0];
  let hitHard: [boolean, boolean] = [false, false];
  const rounds: TeamRound[] = [];
  for (let n = 0; n < TEAM_ROUNDS; n++) {
    const fronts: [number, number] = [frontOf(sides[0]), frontOf(sides[1])];
    if (fronts[0] < 0 || fronts[1] < 0) break;
    const phase = n < 3 ? 1 : n < TEAM_ROUNDS - 4 ? 2 : 3;
    const moves: [Array<Move | null>, Array<Move | null>] = [[], []];
    const moods: [number[], number[]] = [[], []];
    for (const s of [0, 1] as const) {
      const o = (1 - s) as 0 | 1;
      const foe = sides[o][fronts[o]]!;
      const opening = foe.last === "rest" || foe.last === "snack";
      const friendly = foe.last === "charm" || foe.last === "gift";
      sides[s].forEach((u, i) => {
        if (u.hp <= 0) {
          moves[s].push(null);
          moods[s].push(0);
          return;
        }
        const word = encodeSenses({
          hunger: 3 - bucket(u.hp, u.max),
          joy: Math.max(0, Math.min(3, momentum[s] + 1)),
          energy: bucket(u.stamina, MAX_STAMINA),
          clean: bucket(foe.hp, foe.max),
          time: phase,
          action: MOVE_AS_ACTION[foe.last],
          event: hitHard[s] && i === fronts[s] ? 3 : opening && n > 0 ? 2 : friendly ? 1 : 0,
          owner: 0,
        });
        const st = Uint8Array.from(u.memory);
        const out = units[s][i]!.brain.step(st, word);
        u.memory = Array.from(st);
        let m = MOVES[out & 7]!;
        if (u.stamina <= 0 && m !== "rest" && m !== "tap") m = "rest";
        if (m === "pounce" && rnd() % 8 === 0) m = "tap";
        moves[s].push(m);
        moods[s].push((out >> 3) & 3);
      });
    }
    const hits: [number, number] = [0, 0];
    const heal: [number[], number[]] = [sides[0].map(() => 0), sides[1].map(() => 0)];
    for (const s of [0, 1] as const) {
      const o = (1 - s) as 0 | 1;
      sides[s].forEach((u, i) => {
        const m = moves[s][i];
        if (!m) return;
        const power = moods[s][i]! - 1 + units[s][i]!.level;
        const cost = m === "pounce" ? 3 : m === "dodge" || m === "charm" ? 2 : m === "guard" || m === "snack" || m === "gift" ? 1 : 0;
        u.stamina = Math.max(0, u.stamina - cost);
        if (m === "rest") u.stamina = Math.min(MAX_STAMINA, u.stamina + 4);
        if (m === "snack") heal[s][i]! += 12 + power * 2;
        if (m === "gift") {
          // the giver shares with the front of its own line (itself when it is the front)
          heal[s][fronts[s]]! += 6;
          heal[s][i]! += i === fronts[s] ? 0 : 3;
        }
        if (m === "charm") sides[o][fronts[o]]!.weakened = 2;
        if (m === "pounce" || m === "tap") {
          let dmg = m === "tap" ? 5 + power + (rnd() % 3) : 12 + power * 3 + (rnd() % 5) + (rnd() % 6 === 0 ? 8 : 0);
          if (u.weakened > 0) dmg = Math.floor(dmg / 2);
          if (i !== fronts[s]) dmg = Math.floor(dmg / 2);
          const def = moves[o][fronts[o]];
          if (def === "guard") dmg = Math.floor(dmg / 3);
          else if (def === "dodge" && rnd() % 3 !== 0) dmg = 0;
          else if (def === "rest") dmg += 4;
          hits[o] += Math.max(0, dmg);
        }
      });
    }
    for (const s of [0, 1] as const) {
      const f = sides[s][fronts[s]]!;
      f.hp = Math.max(0, f.hp - hits[s]);
      sides[s].forEach((u, i) => {
        if (u.hp > 0) u.hp = Math.min(u.max, u.hp + heal[s][i]!);
        u.weakened = Math.max(0, u.weakened - 1);
        const m = moves[s][i];
        if (m) u.last = m;
      });
    }
    for (const s of [0, 1] as const) momentum[s] = Math.max(-1, Math.min(2, momentum[s] + Math.sign(hits[1 - s]! - hits[s]!)));
    hitHard = [hits[0] >= 18, hits[1] >= 18];
    rounds.push({ n, fronts, moves, hp: [sides[0].map((u) => u.hp), sides[1].map((u) => u.hp)], hits });
  }
  const alive = (s: 0 | 1) => sides[s].filter((u) => u.hp > 0).length;
  const total = (s: 0 | 1) => sides[s].reduce((t, u) => t + u.hp, 0);
  const [a0, a1] = [alive(0), alive(1)];
  const winner: 0 | 1 | -1 = a0 !== a1 ? (a0 > a1 ? 0 : 1) : total(0) === total(1) ? -1 : total(0) > total(1) ? 0 : 1;
  return { version: TEAM_VERSION, seed, rounds, winner, digest: digestOf(rounds, seed) };
}

function digestOf(rounds: TeamRound[], seed: number): string {
  let h = 5381 ^ seed;
  for (const r of rounds) {
    for (const s of [0, 1] as const) {
      for (const m of r.moves[s]) h = ((h * 33) ^ (m ? MOVES.indexOf(m) + 1 : 0)) >>> 0;
      for (const v of r.hp[s]) h = ((h * 33) ^ v) >>> 0;
    }
  }
  return h.toString(16).padStart(8, "0");
}
