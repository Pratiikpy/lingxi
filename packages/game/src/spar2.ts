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
export const SPAR_V3 = "LX-SPAR/3";
export const SPAR_V4 = "LX-SPAR/4";
/** The version new fights are fought in. */
export const CURRENT_SPAR: SparVersion = SPAR_V4;

/** A fight in the version given: each version replays with its own engine, so past spars verify as they were fought. */
export function fight(version: SparVersion, a: Fighter, b: Fighter, seed: number, cheer?: (round: number) => [boolean, boolean]): SparResult {
  const r = rulesOf(version);
  return r ? sparWith(r, a, b, seed, cheer) : spar(a, b, seed, cheer);
}

/**
 * The numbers a fight version is played by. LX-SPAR/2 (V2_RULES) is kept exactly, so every spar fought in it replays;
 * a later version is another table, played by the same engine.
 */
export interface SparRules {
  version: SparVersion;
  /** each move's number on the other pet's action pins */
  moveAsAction: Readonly<Record<Move, number>>;
  /** what each move costs in stamina */
  moveCost: Readonly<Record<Move, number>>;
  /** power by mood: grumpy, calm, happy, excited */
  moodPower: readonly [number, number, number, number];
  /** stamina by mood added to any move that costs stamina */
  moodCost: readonly [number, number, number, number];
  /** damage by mood added to every hit the pet takes while it is not guarding or dodging (a reckless mood is easier to hurt) */
  moodTaken: readonly [number, number, number, number];
  /** how many times its power a pounce adds (a tap adds its power once) */
  pouncePower: number;
  /** stamina a calm pet wins back on a beat it only taps */
  calmRecover: number;
  /** what a rest gives back, what a snack heals, the base of a tap and a pounce */
  restGain: number;
  snackHeal: number;
  tapHit: number;
  pounceHit: number;
  /** a guard lets through a pounce divided by this, a tap by guardTap; a grumpy guard divides by grumpyGuard more */
  guardPounce: number;
  guardTap: number;
  grumpyGuard: number;
  /** a guarded pounce: the attacker staggers, takes a recoil of 0 to recoilMax, more when the guard was timed */
  stagger: number;
  recoilMax: number;
  timedRecoil: number;
  /** a clean dodge of a pounce: the dodger's counter-hit; a dodge misses below dodgeMiss on a roll of 200 */
  riposte: number;
  dodgeMiss: number;
  /** stamina a guard or a clean dodge wins back when it answers a pounce */
  steady: number;
  /** a pounce on a pet resting, snacking or charming; a charm slipping past a guard */
  punish: number;
  feint: number;
  /** level is divided by this to give power */
  levelDivisor: number;
  /** how the Spar skills are read */
  skillPowerTenths: number;
  skillHpShare: number;
  skillStaminaShare: number;
  skillGuardShare: number;
  skillDodgeShare: number;
  /** the share of the snack skills' heal a snack adds (LX-SPAR/2 and /3: all of it) */
  skillHealShare: number;
  /** D14: a bag item's bonus is applied at face value (`Fighter.boost`); before LX-SPAR/4 it was folded into the skills */
  boostAtFaceValue?: true;
}

/**
 * LX-SPAR/2. Every move apart on the action pins; mood power -1/0/+1/+2 with excited paying one stamina more. The Spar
 * skills: each point of skill power adds two tenths of a damage to every pounce, carried from pounce to pounce; a tenth
 * of the skills' health and half their stamina count; a guard skill stops a quarter of its percent of what gets through
 * a guard, carried; a dodge point is a quarter of a percent.
 */
export const V2_RULES: SparRules = {
  version: "LX-SPAR/2",
  moveAsAction: { tap: 0, snack: 1, pounce: 2, guard: 3, rest: 4, charm: 5, dodge: 6, gift: 7 },
  moveCost: { tap: 0, snack: 1, pounce: 3, rest: 0, dodge: 2, guard: 1, charm: 2, gift: 1 },
  moodPower: [-1, 0, 1, 2],
  moodCost: [0, 0, 0, 1],
  moodTaken: [0, 0, 0, 0],
  pouncePower: 3,
  calmRecover: 1,
  restGain: 3,
  snackHeal: 16,
  tapHit: 6,
  pounceHit: 12,
  guardPounce: 4,
  guardTap: 3,
  grumpyGuard: 1,
  stagger: 2,
  recoilMax: 6,
  timedRecoil: 8,
  riposte: 13,
  dodgeMiss: 66,
  steady: 3,
  punish: 4,
  feint: 8,
  levelDivisor: 2,
  skillPowerTenths: 2,
  skillHpShare: 0.1,
  skillStaminaShare: 0.5,
  skillGuardShare: 0.25,
  skillDodgeShare: 0.5,
  skillHealShare: 1,
};

/**
 * LX-SPAR/3 (Milestone B review, row B1). Two things LX-SPAR/2 got wrong. Mood was free power: a happy pet hit harder
 * for nothing and an excited one paid a single stamina, so an excited pacer beat a calm one 342 to 34; now mood is how
 * hard a pet plays, a trade both ways, and calm still recovers while it taps. The action pins are kept as LX-SPAR/2 has
 * them, every move apart: hiding rest and dodge again (they read as "lights off" and "medicine" to a pet's care rules)
 * was measured, and it took from the fight-reading brain what it reads (its share of the field fell from 87% to 62%).
 */
export const V3_RULES: SparRules = {
  ...V2_RULES,
  version: "LX-SPAR/3",
  // each step of mood hits one harder and takes one more, grumpy one softer and one less; a pet braced in a guard or a
  // dodge takes no more; measured (row B1): a pacer, a pouncer and a tapper at every mood score 41-52% against the same
  // brain calm, and no guard-only against pounce-only pairing at any two moods falls outside 35-89%
  moodPower: [-1, 0, 1, 2],
  moodCost: [0, 0, 0, 0],
  moodTaken: [-1, 0, 1, 2],
  pouncePower: 1,
  grumpyGuard: 0,
};

/** What each move costs in stamina (the same in every version this engine plays so far). */
export const MOVE_COST: Readonly<Record<Move, number>> = V2_RULES.moveCost;
/** what a pounce adds on a pet resting, snacking or charming, for the rewind to say */
export const SPAR_PUNISH = V2_RULES.punish;

const healthPin = (hp: number, max: number) => 3 - bucketUp(hp, max);

function wordOf(r: SparRules, me: Side, them: Side, round: number, cheering: boolean, hitHard: boolean): number {
  const phase = round < 3 ? 1 : round < ROUNDS - 4 ? 2 : 3;
  const opening = them.last === "rest" || them.last === "snack";
  const friendly = them.last === "charm" || them.last === "gift";
  return encodeSenses({
    hunger: healthPin(me.hp, me.maxHp),
    joy: Math.max(0, Math.min(3, me.momentum + 1)),
    energy: bucketUp(me.stamina, me.maxStamina),
    clean: bucketUp(them.hp, them.maxHp),
    time: phase,
    action: round > 0 ? r.moveAsAction[them.last] : 0,
    event: hitHard ? 3 : opening && round > 0 ? 2 : friendly ? 1 : 0,
    owner: cheering ? 1 : 0,
  });
}

/** The full cost of a move at a mood. */
const costAt = (r: SparRules, m: Move, mood: number) => r.moveCost[m] + (r.moveCost[m] > 0 ? r.moodCost[mood]! : 0);

/**
 * LX-SPAR/4 (row D8). The Spar skills decided fights: a pet with the whole tree that snacks once it is hurt (the coach's
 * own "eats when very hungry" lesson) beat the same brain unskilled in 86 to 92% of spars, where the plan says skills
 * tilt and never decide. Half the skills' health and a fifth of their snack heal (their power left as it was: at half, a
 * rank of Strong Paws gave nothing in a fight): measured over 1,200 fights, the whole tree with either pair of capstones
 * now wins 77 to 78% for that brain and 67 to 69% for one that snacks only when nearly beaten, and every rank skill at
 * five points still changes the result. Everything else is LX-SPAR/3's; a
 * fight without skills is the same fight.
 */
export const V4_RULES: SparRules = {
  ...V3_RULES,
  version: "LX-SPAR/4",
  skillHpShare: 0.05,
  skillHealShare: 0.2,
  boostAtFaceValue: true,
};

/** The rules of each version this engine plays (LX-SPAR/1 has its own engine, spar.ts). */
const RULES_OF: Partial<Record<SparVersion, SparRules>> = { "LX-SPAR/2": V2_RULES, "LX-SPAR/3": V3_RULES, "LX-SPAR/4": V4_RULES };
export const rulesOf = (version: SparVersion): SparRules | undefined => RULES_OF[version];

/**
 * The move a brain's answer (want | mood << 3) becomes with this much stamina, before a pounce's chance of slipping
 * into a tap: LX-SPAR/1 lets a pet with no stamina only rest or tap; from LX-SPAR/2 any move it cannot pay for in full
 * becomes a rest. A checker that asks the chain for the brain's answer applies this to compare it with the move made.
 */
export function allowedMove(version: SparVersion, out: number, stamina: number): Move {
  const want = MOVES[out & 7]!;
  const r = rulesOf(version);
  if (r) return costAt(r, want, (out >> 3) & 3) > stamina ? "rest" : want;
  return stamina <= 0 && want !== "rest" && want !== "tap" ? "rest" : want;
}

export function spar2(a: Fighter, b: Fighter, seed: number, cheer?: (round: number) => [boolean, boolean]): SparResult {
  return sparWith(V2_RULES, a, b, seed, cheer);
}

/** A fight played by a version's rules. */
export function sparWith(r: SparRules, a: Fighter, b: Fighter, seed: number, cheer: (round: number) => [boolean, boolean] = () => [false, false]): SparResult {
  const rnd = xorshift(seed);
  const start = (f: Fighter): Side => {
    const maxHp = MAX_HP + Math.floor((f.mods?.hp ?? 0) * r.skillHpShare) + (r.boostAtFaceValue ? Math.max(0, f.boost?.hp ?? 0) : 0);
    const maxStamina = MAX_STAMINA + Math.floor((f.mods?.stamina ?? 0) * r.skillStaminaShare);
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
    stopped[j] += through * Math.min(90, (fighters[j]!.mods?.guard ?? 0) * r.skillGuardShare);
    const whole = Math.min(through, Math.floor(stopped[j] / 100));
    stopped[j] -= whole * 100;
    return whole;
  };
  const skillHit = (i: 0 | 1): number => {
    carry[i] += (fighters[i]!.mods?.power ?? 0) * r.skillPowerTenths;
    const whole = Math.floor(carry[i] / 10);
    carry[i] -= whole * 10;
    return whole;
  };
  for (let n = 0; n < ROUNDS; n++) {
    const cheering = cheer(n);
    const words = [0, 1].map((i) => {
      const [me, them] = i === 0 ? [sides[0], sides[1]] : [sides[1], sides[0]];
      return fighters[i]!.profile === "DUEL-12x3/1" ? duelWord(me, them, n) : wordOf(r, me, them, n, cheering[i]!, hitHard[i]!);
    }) as [number, number];
    const outs = [0, 1].map((i) => {
      const st = Uint8Array.from(sides[i]!.memory);
      const out = fighters[i]!.brain.step(st, words[i]!);
      sides[i]!.memory = Array.from(st);
      return fighters[i]!.profile === "DUEL-12x3/1" ? duelAnswer(out) : out;
    });
    const moods = outs.map((o) => (o >> 3) & 3) as [number, number];
    // strict stamina: a move the pet cannot pay for in full becomes a rest; now and then an eager pounce slips to a tap
    let moves = outs.map((o, i) => allowedMove(r.version, o, sides[i]!.stamina)) as [Move, Move];
    moves = moves.map((m) => (m === "pounce" && rnd() % 8 === 0 ? "tap" : m)) as [Move, Move];
    // level tilts: half a point of power a level
    const power = moods.map((m, i) => r.moodPower[m]! + Math.floor(fighters[i]!.level / r.levelDivisor) + (r.boostAtFaceValue ? Math.max(0, fighters[i]!.boost?.power ?? 0) : 0)) as [number, number];
    const hits: [number, number] = [0, 0];
    const heal: [number, number] = [0, 0];
    const stagger: [number, number] = [0, 0];
    for (const i of [0, 1] as const) {
      const j = (1 - i) as 0 | 1;
      const me = sides[i];
      const m = moves[i];
      me.stamina = Math.max(0, me.stamina - costAt(r, m, moods[i]));
      if (m === "rest") me.stamina = Math.min(me.maxStamina, me.stamina + r.restGain);
      // calm recovers, while it only taps
      else if (moods[i] === 1 && r.moveCost[m] === 0) me.stamina = Math.min(me.maxStamina, me.stamina + r.calmRecover);
      if (m === "snack") heal[i] += r.snackHeal + power[i] * 2 + Math.floor((fighters[i]!.mods?.heal ?? 0) * r.skillHealShare);
      if (m === "gift") {
        heal[i] += 6;
        heal[j] += 6;
      }
      const def = moves[j];
      if (m === "charm") {
        sides[j].weakened = 2;
        // a feint: past a guard for a light hit
        if (def === "guard") hits[i] = r.feint + Math.max(0, power[i]);
      }
      if (m === "pounce" || m === "tap") {
        let dmg = m === "tap" ? r.tapHit + power[i] + (rnd() % 3) : r.pounceHit + power[i] * r.pouncePower + skillHit(i) + (rnd() % 5) + (rnd() % 6 === 0 ? 8 : 0);
        if (me.weakened > 0) dmg = Math.floor(dmg / 2);
        const them = fighters[j]!.mods;
        if (def === "guard") {
          // a guard takes the sting out of a pounce (a quarter gets through, a fifth when grumpy), a tap a third
          dmg = Math.floor(dmg / ((m === "pounce" ? r.guardPounce : r.guardTap) + (moods[j] === 0 ? r.grumpyGuard : 0)));
          dmg -= guardStops(j, dmg);
          // a guarded pounce staggers the attacker and costs it a recoil; a guard thrown up in time (after a different
          // move) throws it back harder than one held round after round, so a pet that reads beats one that only guards
          if (m === "pounce") {
            const timed = sides[j].last !== "guard";
            stagger[i] += r.stagger;
            stagger[j] -= r.steady;
            hits[j] += (rnd() % (r.recoilMax + 1)) + (timed ? r.timedRecoil : 0);
          }
        } else if (def === "dodge") {
          const roll = rnd();
          if (roll % 200 >= Math.max(0, r.dodgeMiss - Math.floor((them?.dodge ?? 0) * r.skillDodgeShare))) {
            dmg = 0;
            // a dodged pounce overreaches: the dodger answers it
            if (m === "pounce") {
              hits[j] += r.riposte;
              stagger[j] -= r.steady;
            }
          }
        } else if (m === "pounce" && (def === "rest" || def === "snack" || def === "charm")) dmg += r.punish;
        hits[i] += Math.max(0, dmg);
      }
    }
    // a reckless mood is easier to hurt: each hit it takes is heavier, unless it is braced in a guard or a dodge
    for (const i of [0, 1] as const) if (hits[1 - i]! > 0 && moves[i] !== "guard" && moves[i] !== "dodge") hits[1 - i] = hits[1 - i]! + r.moodTaken[moods[i]]!;
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
  return { version: r.version, seed, rounds, winner, digest: digestOf(rounds, seed), maxHp: [sides[0].maxHp, sides[1].maxHp] };
}
