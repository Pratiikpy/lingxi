/**
 * Friendly spars, version 2 (LX-SPAR/2, G2): the same 16 rounds and the same pins as LX-SPAR/1 (spar.ts), with a fight
 * worth reading. LX-SPAR/1 stays exactly as it was, so every spar already fought replays and verifies under it.
 *
 * What changed, and why (38-PLAN-GAME-DESIGN.md G2):
 *   - Every move has its own number on the other pet's action pins, so a brain can tell a guard from a rest and answer
 *     it (in LX-SPAR/1 tap, rest, dodge and guard all read as 0).
 *   - A soft triangle. A guard answers a pounce: a quarter of it gets through (a fifth when grumpy), the attacker
 *     staggers (two stamina) and takes a recoil, a heavier one when the guard was timed (thrown up after a different
 *     move), and the guard steadies (three stamina back). A clean dodge of a pounce (two in three) answers with a
 *     counter-hit and steadies too, but a missed one eats the whole pounce: the guard is the steady answer, the dodge
 *     the risky one. A charm answers a guard: it slips past for a light hit and weakens it. A pounce punishes resting,
 *     snacking and charming (+4). Soft, not hard: measured over 400 fights each, a guard-only pet beats a pounce-only
 *     one 56 to 33 and a dodge-only one 47 to 53 (G2's balance targets keep both inside 40 to 60%).
 *   - Mood is a cost. Excited hits hardest (+2) and every move that costs stamina costs one more; happy +1; calm
 *     recovers one stamina a round while it only taps; grumpy hits softer (-1) but guards better.
 *   - Stamina is strict: a move the pet cannot pay for in full becomes a rest.
 *   - Level tilts, never decides: half a point of power a level, where LX-SPAR/1 gave a whole point.
 *
 * TapeFly-format brains (DUEL-12x3/1) read their 12 pins as before (spar.ts duelWord, duelAnswer).
 */

import { encodeSenses } from "@lingxi/brain";
import { type Fighter, MAX_HP, MAX_STAMINA, MOVES, type Move, ROUNDS, type Round, type Side, type SparResult, type SparVersion, bucketUp, digestOf, duelAnswer, duelWord, spar, xorshift } from "./spar";

export const SPAR_V2 = "LX-SPAR/2";
/** The version new fights are fought in. */
export const CURRENT_SPAR: SparVersion = SPAR_V2;

/** A fight in the version given: each version replays with its own engine, so past spars verify as they were fought. */
export function fight(version: SparVersion, a: Fighter, b: Fighter, seed: number, cheer?: (round: number) => [boolean, boolean]): SparResult {
  return version === SPAR_V2 ? spar2(a, b, seed, cheer) : spar(a, b, seed, cheer);
}

/** Each move's number on the other pet's action pins: all eight apart (pounce, snack, charm and gift as in LX-SPAR/1). */
const MOVE_AS_ACTION: Record<Move, number> = { tap: 0, snack: 1, pounce: 2, guard: 3, rest: 4, charm: 5, dodge: 6, gift: 7 };
/** What each move costs in stamina. */
export const MOVE_COST: Record<Move, number> = { tap: 0, snack: 1, pounce: 3, rest: 0, dodge: 2, guard: 1, charm: 2, gift: 1 };
/** Power by mood: grumpy, calm, happy, excited. */
const MOOD_POWER = [-1, 0, 1, 2] as const;
/** What a rest gives back, what a snack heals, and the base of a tap and a pounce. */
const REST_GAIN = 3;
const SNACK_HEAL = 16;
const TAP_HIT = 6;
const POUNCE_HIT = 12;
/** A guard lets a quarter of a pounce through (a fifth when grumpy) and a third of a tap. */
const GUARD_POUNCE = 4;
/** A guarded pounce: the attacker staggers (stamina), takes a recoil, more when the guard was timed. */
const STAGGER = 2;
/** The recoil is anything from 0 to RECOIL_MAX: a fixed one made a guard-only pet against a pounce-only one a knife edge (2 lost every fight, 3 won 60%, 4 won 93%). */
const RECOIL_MAX = 6;
const TIMED_RECOIL = 8;
/** A clean dodge of a pounce: the dodger's counter-hit. */
const RIPOSTE = 13;
/** Stamina a guard or a clean dodge wins back when it answers a pounce. */
const STEADY = 3;
/** A pounce on a pet resting, snacking or charming; a charm slipping past a guard. */
const PUNISH = 4;
/** what a pounce adds on a pet resting, snacking or charming, for the rewind to say */
export const SPAR_PUNISH = PUNISH;
const FEINT = 8;
/**
 * How LX-SPAR/2 reads the Spar skills (skills.ts sparMods; LX-SPAR/1 reads them as it always did): each point of skill
 * power adds two tenths of a damage to every pounce, carried from pounce to pounce, rather than multiplying like mood;
 * a tenth of the skills' health counts, and half their stamina; a guard skill stops a quarter of its percent of what
 * gets through a guard, carried from guard to guard; a dodge point is a quarter of a percent. Tuned so skills tilt a
 * fight and never decide it: one full guard or dodge skill moves its own matchup by under 10 points, and a full
 * Spar tree on a fight-reading brain beats the same brain unskilled in about 75% of spars, and every rank skill at
 * five points changes the result (spar2.test.ts).
 */
const SKILL_POWER_TENTHS = 2;
const SKILL_HP_SHARE = 0.1;
const SKILL_STAMINA_SHARE = 0.5;
/** a quarter of the guard skills' percent, carried from guard to guard; half a dodge point is half a percent on a 200 roll */
const SKILL_GUARD_SHARE = 0.25;
const SKILL_DODGE_SHARE = 0.5;

const healthPin = (hp: number, max: number) => 3 - bucketUp(hp, max);

function word2(me: Side, them: Side, round: number, cheering: boolean, hitHard: boolean): number {
  const phase = round < 3 ? 1 : round < ROUNDS - 4 ? 2 : 3;
  const opening = them.last === "rest" || them.last === "snack";
  const friendly = them.last === "charm" || them.last === "gift";
  return encodeSenses({
    hunger: healthPin(me.hp, me.maxHp),
    joy: Math.max(0, Math.min(3, me.momentum + 1)),
    energy: bucketUp(me.stamina, me.maxStamina),
    clean: bucketUp(them.hp, them.maxHp),
    time: phase,
    action: round > 0 ? MOVE_AS_ACTION[them.last] : 0,
    event: hitHard ? 3 : opening && round > 0 ? 2 : friendly ? 1 : 0,
    owner: cheering ? 1 : 0,
  });
}

/** The full cost of a move at a mood: an excited pet pays one more for anything that costs stamina. */
const costAt = (m: Move, mood: number) => MOVE_COST[m] + (mood === 3 && MOVE_COST[m] > 0 ? 1 : 0);

/**
 * The move a brain's answer (want | mood << 3) becomes with this much stamina, before a pounce's chance of slipping
 * into a tap: LX-SPAR/1 lets a pet with no stamina only rest or tap; LX-SPAR/2 turns any move it cannot pay for in full
 * into a rest. A checker that asks the chain for the brain's answer applies this to compare it with the move made.
 */
export function allowedMove(version: SparVersion, out: number, stamina: number): Move {
  const want = MOVES[out & 7]!;
  if (version === SPAR_V2) return costAt(want, (out >> 3) & 3) > stamina ? "rest" : want;
  return stamina <= 0 && want !== "rest" && want !== "tap" ? "rest" : want;
}

export function spar2(a: Fighter, b: Fighter, seed: number, cheer: (round: number) => [boolean, boolean] = () => [false, false]): SparResult {
  const rnd = xorshift(seed);
  const start = (f: Fighter): Side => {
    const maxHp = MAX_HP + Math.floor((f.mods?.hp ?? 0) * SKILL_HP_SHARE);
    const maxStamina = MAX_STAMINA + Math.floor((f.mods?.stamina ?? 0) * SKILL_STAMINA_SHARE);
    return { hp: maxHp, stamina: maxStamina, maxHp, maxStamina, weakened: 0, memory: f.memory.slice(), last: "tap", momentum: 0 };
  };
  const sides: [Side, Side] = [start(a), start(b)];
  const fighters: [Fighter, Fighter] = [a, b];
  const rounds: Round[] = [];
  let hitHard: [boolean, boolean] = [false, false];
  // skill power builds up pounce by pounce: each pounce adds its share, and every whole point is one more damage
  const carry: [number, number] = [0, 0];
  // the guard skills stop their share of what gets through a guard, carried from guard to guard the same way
  const stopped: [number, number] = [0, 0];
  const guardStops = (j: 0 | 1, through: number): number => {
    stopped[j] += through * Math.min(90, (fighters[j]!.mods?.guard ?? 0) * SKILL_GUARD_SHARE);
    const whole = Math.min(through, Math.floor(stopped[j] / 100));
    stopped[j] -= whole * 100;
    return whole;
  };
  const skillHit = (i: 0 | 1): number => {
    carry[i] += (fighters[i]!.mods?.power ?? 0) * SKILL_POWER_TENTHS;
    const whole = Math.floor(carry[i] / 10);
    carry[i] -= whole * 10;
    return whole;
  };
  for (let n = 0; n < ROUNDS; n++) {
    const cheering = cheer(n);
    const words = [0, 1].map((i) => {
      const [me, them] = i === 0 ? [sides[0], sides[1]] : [sides[1], sides[0]];
      return fighters[i]!.profile === "DUEL-12x3/1" ? duelWord(me, them, n) : word2(me, them, n, cheering[i]!, hitHard[i]!);
    }) as [number, number];
    const outs = [0, 1].map((i) => {
      const st = Uint8Array.from(sides[i]!.memory);
      const out = fighters[i]!.brain.step(st, words[i]!);
      sides[i]!.memory = Array.from(st);
      return fighters[i]!.profile === "DUEL-12x3/1" ? duelAnswer(out) : out;
    });
    const moods = outs.map((o) => (o >> 3) & 3) as [number, number];
    // strict stamina: a move the pet cannot pay for in full becomes a rest; now and then an eager pounce slips to a tap
    let moves = outs.map((o, i) => allowedMove(SPAR_V2, o, sides[i]!.stamina)) as [Move, Move];
    moves = moves.map((m) => (m === "pounce" && rnd() % 8 === 0 ? "tap" : m)) as [Move, Move];
    // level tilts: half a point of power a level
    const power = moods.map((m, i) => MOOD_POWER[m]! + Math.floor(fighters[i]!.level / 2)) as [number, number];
    const hits: [number, number] = [0, 0];
    const heal: [number, number] = [0, 0];
    const stagger: [number, number] = [0, 0];
    for (const i of [0, 1] as const) {
      const j = (1 - i) as 0 | 1;
      const me = sides[i];
      const m = moves[i];
      me.stamina = Math.max(0, me.stamina - costAt(m, moods[i]));
      if (m === "rest") me.stamina = Math.min(me.maxStamina, me.stamina + REST_GAIN);
      // calm recovers, while it only taps
      else if (moods[i] === 1 && MOVE_COST[m] === 0) me.stamina = Math.min(me.maxStamina, me.stamina + 1);
      if (m === "snack") heal[i] += SNACK_HEAL + power[i] * 2 + (fighters[i]!.mods?.heal ?? 0);
      if (m === "gift") {
        heal[i] += 6;
        heal[j] += 6;
      }
      const def = moves[j];
      if (m === "charm") {
        sides[j].weakened = 2;
        // a feint: past a guard for a light hit
        if (def === "guard") hits[i] = FEINT + Math.max(0, power[i]);
      }
      if (m === "pounce" || m === "tap") {
        let dmg = m === "tap" ? TAP_HIT + power[i] + (rnd() % 3) : POUNCE_HIT + power[i] * 3 + skillHit(i) + (rnd() % 5) + (rnd() % 6 === 0 ? 8 : 0);
        if (me.weakened > 0) dmg = Math.floor(dmg / 2);
        const them = fighters[j]!.mods;
        if (def === "guard") {
          // a guard takes the sting out of a pounce (a quarter gets through, a fifth when grumpy), a tap a third
          dmg = Math.floor(dmg / ((m === "pounce" ? GUARD_POUNCE : 3) + (moods[j] === 0 ? 1 : 0)));
          dmg -= guardStops(j, dmg);
          // a guarded pounce staggers the attacker and costs it a recoil; a guard thrown up in time (after a different
          // move) throws it back harder than one held round after round, so a pet that reads beats one that only guards
          if (m === "pounce") {
            const timed = sides[j].last !== "guard";
            stagger[i] += STAGGER;
            stagger[j] -= STEADY;
            hits[j] += (rnd() % (RECOIL_MAX + 1)) + (timed ? TIMED_RECOIL : 0);
          }
        } else if (def === "dodge") {
          const r = rnd();
          if (r % 200 >= Math.max(0, 66 - Math.floor((them?.dodge ?? 0) * SKILL_DODGE_SHARE))) {
            dmg = 0;
            // a dodged pounce overreaches: the dodger answers it
            if (m === "pounce") {
              hits[j] += RIPOSTE;
              stagger[j] -= STEADY;
            }
          }
        } else if (m === "pounce" && (def === "rest" || def === "snack" || def === "charm")) dmg += PUNISH;
        hits[i] += Math.max(0, dmg);
      }
    }
    for (const i of [0, 1] as const) {
      const j = (1 - i) as 0 | 1;
      sides[i].stamina = Math.max(0, Math.min(sides[i].maxStamina, sides[i].stamina - stagger[i]));
      sides[j].hp = Math.max(0, sides[j].hp - hits[i]);
      sides[i].hp = Math.min(sides[i].maxHp, sides[i].hp + heal[i]);
      sides[i].weakened = Math.max(0, sides[i].weakened - 1);
      sides[i].last = moves[i];
    }
    for (const i of [0, 1] as const) {
      const j = (1 - i) as 0 | 1;
      sides[i].momentum = Math.max(-1, Math.min(2, sides[i].momentum + Math.sign(hits[i] - hits[j])));
    }
    hitHard = [hits[1] >= 18, hits[0] >= 18];
    rounds.push({ n, words, moves, moods, hp: [sides[0].hp, sides[1].hp], stamina: [sides[0].stamina, sides[1].stamina], hits });
    if (sides[0].hp === 0 || sides[1].hp === 0) break;
  }
  const [h0, h1] = [sides[0].hp, sides[1].hp];
  const winner: 0 | 1 | -1 = h0 === h1 ? -1 : h0 > h1 ? 0 : 1;
  return { version: SPAR_V2, seed, rounds, winner, digest: digestOf(rounds, seed) };
}
