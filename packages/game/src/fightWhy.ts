/**
 * Why a spar went the way it did (G2 item 7): the rule each side's own brain fired, and what the fight's rules did
 * with the two moves. The rewind on the spar screen shows both, round by round, so a pet that loses can be told why.
 */

import type { Rule } from "@lingxi/brain";
import type { DuelPet } from "./duel";
import { type MindSpec, mindBrain, parseCard } from "./family";
import type { Partner } from "./partners";
import type { Mind } from "./replay";
import type { Move, Round, SparVersion } from "./spar";
import { SPAR_V2 } from "./spar2";

/** A mind as the rewind reads it, built by the same function a fighter's brain is built with. */
export function mindOfSpec(spec: MindSpec): Mind {
  const b = mindBrain(spec);
  const own = b.halves ? { halves: b.halves } : { program: b.program! };
  return spec.outside ? { ...own, outside: spec.outside } : own;
}

/** A sparring partner's mind, or null for one whose brain is not a pet's (a fruit fly, Behemoth). */
export function partnerMind(p: Partner): Mind | null {
  if (p.look) return null;
  if (p.family || p.outside) return mindOfSpec({ line: p.line, lessons: (p.lessons ?? []) as Rule[], family: p.family, instincts: p.instincts, outside: p.outside });
  return { program: p.program };
}

/** A pet's mind from a duel link, with the memory it fought with (as duelFighter takes it). */
export function duelPetMind(p: DuelPet): { mind: Mind; memory?: number[] } | null {
  const card = parseCard(p.card);
  if (!card) return null;
  const spec = { line: p.line, lessons: card.lessons, family: card.family, instincts: card.instincts, outside: card.outside, growth: card.growth };
  const nState = mindBrain(spec).nState;
  return { mind: mindOfSpec(spec), ...(card.memory?.length === nState ? { memory: [...card.memory] } : {}) };
}

/** What the fight's rules did with one round's two moves; `by` is the side the event favoured. */
export type Exchange =
  | { kind: "guarded"; by: 0 | 1; back: number; timed: boolean }
  | { kind: "dodged"; by: 0 | 1; back: number }
  | { kind: "caught"; by: 0 | 1 }
  | { kind: "punished"; by: 0 | 1; open: Extract<Move, "rest" | "snack" | "charm"> }
  | { kind: "feint"; by: 0 | 1; hit: number };

/**
 * The exchanges of round `k`, read from the round itself. Only LX-SPAR/2 has these rules; an LX-SPAR/1 spar (fought
 * before G2) has none to show.
 */
export function exchangesOf(version: SparVersion, rounds: readonly Round[], k: number): Exchange[] {
  if (version !== SPAR_V2) return [];
  const r = rounds[k];
  if (!r) return [];
  const out: Exchange[] = [];
  for (const i of [0, 1] as const) {
    const j = (1 - i) as 0 | 1;
    const [mine, theirs] = [r.moves[i], r.moves[j]];
    if (mine === "pounce" && theirs === "guard") out.push({ kind: "guarded", by: j, back: r.hits[j], timed: k === 0 || rounds[k - 1]!.moves[j] !== "guard" });
    else if (mine === "pounce" && theirs === "dodge") out.push(r.hits[i] === 0 ? { kind: "dodged", by: j, back: r.hits[j] } : { kind: "caught", by: i });
    else if (mine === "pounce" && (theirs === "rest" || theirs === "snack" || theirs === "charm")) out.push({ kind: "punished", by: i, open: theirs });
    else if (mine === "charm" && theirs === "guard") out.push({ kind: "feint", by: i, hit: r.hits[i] });
  }
  return out;
}
