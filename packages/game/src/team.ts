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
import { type SparRules, V3_RULES } from "./spar2";

/**
 * Team battle versions. LX-TEAM/1 (teamSparV1) is kept exactly, so every team battle fought in it replays. LX-TEAM/2
 * (row B3c) fights by the spar's own rules, LX-SPAR/3 (spar2.ts V3_RULES): every move apart on the action pins, strict
 * stamina, mood as a trade, the soft triangle at the front (a guard answers a pounce with a stagger and a throw-back, a
 * clean dodge with a counter-hit, a charm slips past a guard, a pounce punishes a rest, a snack or a charm). The back
 * line supports as before, and a guard's throw-back or a dodge's counter-hit only reaches an attacker at the front.
 */
export type TeamVersion = "LX-TEAM/1" | "LX-TEAM/2";
export const TEAM_VERSION = "LX-TEAM/1";
export const TEAM_V2 = "LX-TEAM/2";
/** The version new team battles are fought in. */
export const CURRENT_TEAM: TeamVersion = TEAM_V2;
/** The spar rules each team version's moves follow (for a checker re-applying the stamina rule). */
export const TEAM_SPAR: Record<TeamVersion, "LX-SPAR/1" | "LX-SPAR/3"> = {
  "LX-TEAM/1": "LX-SPAR/1",
  "LX-TEAM/2": "LX-SPAR/3",
};
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
  /** per side, per unit: the 16-bit senses word its brain read (-1 when fainted) */
  words: [number[], number[]];
  /** per side, per unit: stamina before the round */
  stamina: [number[], number[]];
  /** per side, per unit: the move (null when fainted) */
  moves: [Array<Move | null>, Array<Move | null>];
  /** per side, per unit: health after the round */
  hp: [number[], number[]];
  /** damage dealt to each side's front this round */
  hits: [number, number];
}

export interface TeamResult {
  version: TeamVersion;
  seed: number;
  rounds: TeamRound[];
  winner: 0 | 1 | -1;
  digest: string;
}

const MOVE_AS_ACTION: Record<Move, number> = {
  tap: 0,
  snack: 1,
  pounce: 2,
  rest: 0,
  dodge: 0,
  guard: 0,
  charm: 5,
  gift: 7,
};
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

/** A team battle in the version given (the current one by default); each version replays as it was fought. */
export function teamSpar(
  a: readonly TeamUnit[],
  b: readonly TeamUnit[],
  seed: number,
  version: TeamVersion = CURRENT_TEAM,
): TeamResult {
  return version === TEAM_V2 ? teamSparRules(V3_RULES, a, b, seed) : teamSparV1(a, b, seed);
}

/** LX-TEAM/1, exactly as it was fought. */
function teamSparV1(a: readonly TeamUnit[], b: readonly TeamUnit[], seed: number): TeamResult {
  if (a.length < 1 || b.length < 1 || a.length > MAX_TEAM || b.length > MAX_TEAM)
    throw new Error("a team has 1 to 5 units");
  const rnd = xorshift(seed);
  const units: [readonly TeamUnit[], readonly TeamUnit[]] = [a, b];
  const sides: [UnitState[], UnitState[]] = [
    a.map((u) => ({
      hp: u.hp,
      max: u.hp,
      stamina: MAX_STAMINA,
      weakened: 0,
      memory: u.memory.slice(),
      last: "tap" as Move,
    })),
    b.map((u) => ({
      hp: u.hp,
      max: u.hp,
      stamina: MAX_STAMINA,
      weakened: 0,
      memory: u.memory.slice(),
      last: "tap" as Move,
    })),
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
    const words: [number[], number[]] = [[], []];
    const stamina: [number[], number[]] = [sides[0].map((u) => u.stamina), sides[1].map((u) => u.stamina)];
    for (const s of [0, 1] as const) {
      const o = (1 - s) as 0 | 1;
      const foe = sides[o][fronts[o]]!;
      const opening = foe.last === "rest" || foe.last === "snack";
      const friendly = foe.last === "charm" || foe.last === "gift";
      sides[s].forEach((u, i) => {
        if (u.hp <= 0) {
          moves[s].push(null);
          moods[s].push(0);
          words[s].push(-1);
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
        words[s].push(word);
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
        const cost =
          m === "pounce"
            ? 3
            : m === "dodge" || m === "charm"
              ? 2
              : m === "guard" || m === "snack" || m === "gift"
                ? 1
                : 0;
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
    for (const s of [0, 1] as const)
      momentum[s] = Math.max(-1, Math.min(2, momentum[s] + Math.sign(hits[1 - s]! - hits[s]!)));
    hitHard = [hits[0] >= 18, hits[1] >= 18];
    rounds.push({ n, fronts, words, stamina, moves, hp: [sides[0].map((u) => u.hp), sides[1].map((u) => u.hp)], hits });
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

const costOf = (r: SparRules, m: Move, mood: number) => r.moveCost[m] + (r.moveCost[m] > 0 ? r.moodCost[mood]! : 0);

/** LX-TEAM/2: the team battle played by a spar version's rules. */
function teamSparRules(r: SparRules, a: readonly TeamUnit[], b: readonly TeamUnit[], seed: number): TeamResult {
  if (a.length < 1 || b.length < 1 || a.length > MAX_TEAM || b.length > MAX_TEAM)
    throw new Error("a team has 1 to 5 units");
  const rnd = xorshift(seed);
  const units: [readonly TeamUnit[], readonly TeamUnit[]] = [a, b];
  const sides: [UnitState[], UnitState[]] = [
    a.map((u) => ({
      hp: u.hp,
      max: u.hp,
      stamina: MAX_STAMINA,
      weakened: 0,
      memory: u.memory.slice(),
      last: "tap" as Move,
    })),
    b.map((u) => ({
      hp: u.hp,
      max: u.hp,
      stamina: MAX_STAMINA,
      weakened: 0,
      memory: u.memory.slice(),
      last: "tap" as Move,
    })),
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
    const words: [number[], number[]] = [[], []];
    const stamina: [number[], number[]] = [sides[0].map((u) => u.stamina), sides[1].map((u) => u.stamina)];
    for (const s of [0, 1] as const) {
      const o = (1 - s) as 0 | 1;
      const foe = sides[o][fronts[o]]!;
      const opening = foe.last === "rest" || foe.last === "snack";
      const friendly = foe.last === "charm" || foe.last === "gift";
      sides[s].forEach((u, i) => {
        if (u.hp <= 0) {
          moves[s].push(null);
          moods[s].push(0);
          words[s].push(-1);
          return;
        }
        const word = encodeSenses({
          hunger: 3 - bucket(u.hp, u.max),
          joy: Math.max(0, Math.min(3, momentum[s] + 1)),
          energy: bucket(u.stamina, MAX_STAMINA),
          clean: bucket(foe.hp, foe.max),
          time: phase,
          action: n > 0 ? r.moveAsAction[foe.last] : 0,
          event: hitHard[s] && i === fronts[s] ? 3 : opening && n > 0 ? 2 : friendly ? 1 : 0,
          owner: 0,
        });
        words[s].push(word);
        const st = Uint8Array.from(u.memory);
        const out = units[s][i]!.brain.step(st, word);
        u.memory = Array.from(st);
        const mood = (out >> 3) & 3;
        // strict stamina: a move it cannot pay for in full becomes a rest; now and then a pounce slips into a tap
        let m = MOVES[out & 7]!;
        if (costOf(r, m, mood) > u.stamina) m = "rest";
        if (m === "pounce" && rnd() % 8 === 0) m = "tap";
        moves[s].push(m);
        moods[s].push(mood);
      });
    }
    const hits: [number, number] = [0, 0];
    /** hits that landed on each front, for the mood it was in */
    const landed: [number, number] = [0, 0];
    const stagger: [number[], number[]] = [sides[0].map(() => 0), sides[1].map(() => 0)];
    const heal: [number[], number[]] = [sides[0].map(() => 0), sides[1].map(() => 0)];
    for (const s of [0, 1] as const) {
      const o = (1 - s) as 0 | 1;
      const def = moves[o][fronts[o]];
      sides[s].forEach((u, i) => {
        const m = moves[s][i];
        if (!m) return;
        const mood = moods[s][i]!;
        const front = i === fronts[s];
        const power = r.moodPower[mood]! + Math.floor(units[s][i]!.level / r.levelDivisor);
        u.stamina = Math.max(0, u.stamina - costOf(r, m, mood));
        if (m === "rest") u.stamina = Math.min(MAX_STAMINA, u.stamina + r.restGain);
        else if (mood === 1 && r.moveCost[m] === 0) u.stamina = Math.min(MAX_STAMINA, u.stamina + r.calmRecover);
        if (m === "snack") heal[s][i]! += r.snackHeal + power * 2;
        if (m === "gift") {
          // the giver shares with the front of its own line (itself when it is the front)
          heal[s][fronts[s]]! += 6;
          heal[s][i]! += front ? 0 : 3;
        }
        if (m === "charm") {
          sides[o][fronts[o]]!.weakened = 2;
          // a feint from the front slips past a guard
          if (front && def === "guard") {
            hits[o] += r.feint + Math.max(0, power);
            landed[o]++;
          }
        }
        if (m === "pounce" || m === "tap") {
          let dmg =
            m === "tap"
              ? r.tapHit + power + (rnd() % 3)
              : r.pounceHit + power * r.pouncePower + (rnd() % 5) + (rnd() % 6 === 0 ? 8 : 0);
          if (u.weakened > 0) dmg = Math.floor(dmg / 2);
          if (!front) dmg = Math.floor(dmg / 2);
          if (def === "guard") {
            dmg = Math.floor(
              dmg / ((m === "pounce" ? r.guardPounce : r.guardTap) + (moods[o][fronts[o]] === 0 ? r.grumpyGuard : 0)),
            );
            // a guarded pounce from the front staggers the attacker and throws it back, harder when the guard was timed
            if (m === "pounce" && front) {
              const timed = sides[o][fronts[o]]!.last !== "guard";
              stagger[s][i]! += r.stagger;
              stagger[o][fronts[o]]! -= r.steady;
              hits[s] += (rnd() % (r.recoilMax + 1)) + (timed ? r.timedRecoil : 0);
              landed[s]++;
            }
          } else if (def === "dodge") {
            if (rnd() % 200 >= r.dodgeMiss) {
              dmg = 0;
              // a dodged pounce from the front overreaches: the dodger answers it
              if (m === "pounce" && front) {
                hits[s] += r.riposte;
                landed[s]++;
                stagger[o][fronts[o]]! -= r.steady;
              }
            }
          } else if (m === "pounce" && (def === "rest" || def === "snack" || def === "charm")) dmg += r.punish;
          if (dmg > 0) {
            hits[o] += dmg;
            landed[o]++;
          }
        }
      });
    }
    // a reckless mood is easier to hurt: each hit on a front is heavier, unless it is braced in a guard or a dodge
    for (const s of [0, 1] as const) {
      const m = moves[s][fronts[s]];
      if (landed[s] > 0 && m !== "guard" && m !== "dodge")
        hits[s] = Math.max(0, hits[s] + landed[s] * r.moodTaken[moods[s][fronts[s]]!]!);
    }
    for (const s of [0, 1] as const) {
      const f = sides[s][fronts[s]]!;
      f.hp = Math.max(0, f.hp - hits[s]);
      sides[s].forEach((u, i) => {
        u.stamina = Math.max(0, Math.min(MAX_STAMINA, u.stamina - stagger[s][i]!));
        if (u.hp > 0) u.hp = Math.min(u.max, u.hp + heal[s][i]!);
        u.weakened = Math.max(0, u.weakened - 1);
        const m = moves[s][i];
        if (m) u.last = m;
      });
    }
    for (const s of [0, 1] as const)
      momentum[s] = Math.max(-1, Math.min(2, momentum[s] + Math.sign(hits[1 - s]! - hits[s]!)));
    hitHard = [hits[0] >= 18, hits[1] >= 18];
    rounds.push({ n, fronts, words, stamina, moves, hp: [sides[0].map((u) => u.hp), sides[1].map((u) => u.hp)], hits });
  }
  const alive = (s: 0 | 1) => sides[s].filter((u) => u.hp > 0).length;
  const total = (s: 0 | 1) => sides[s].reduce((t, u) => t + u.hp, 0);
  const [a0, a1] = [alive(0), alive(1)];
  const winner: 0 | 1 | -1 = a0 !== a1 ? (a0 > a1 ? 0 : 1) : total(0) === total(1) ? -1 : total(0) > total(1) ? 0 : 1;
  return { version: r === V3_RULES ? TEAM_V2 : TEAM_VERSION, seed, rounds, winner, digest: digestOf(rounds, seed) };
}
