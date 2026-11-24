/** The parts of an adopted brain that need no network: its shape, and a fighter from it. */

import { circuitBrain, decodeFlyProgram, encodeFlyProgram, type FlyProgram } from "@lingxi/brain";
import { type CircuitPart, circuitFromParts } from "@lingxi/chain";
import { type Fighter, flyFighter } from "@lingxi/game";

export type Profile = "DUEL-12x3/1" | "PET-16x8/1";

export interface Adopted {
  name: string;
  /** who made it: a wallet for a circuit on chain, or where the TapeFly brain came from */
  author: string;
  profile: Profile;
  gates: number;
  source: { kind: "fly"; code: string } | { kind: "chain"; processor: string; id: string; parts: CircuitPart[] };
  /** used in practice spars while on */
  on: boolean;
  at: number;
}

/** The pins a circuit must have to fight: TapeFly's brawl (12 in, 3 out) or a Lingxi pet's (16 in, 8 out). */
export function profileOf(nIn: number, nOut: number): Profile | null {
  if (nIn === 12 && nOut === 3) return "DUEL-12x3/1";
  if (nIn === 16 && nOut === 8) return "PET-16x8/1";
  return null;
}

/** A fighter from an outside brain, fighting under the pet's own name and level. */
export function fighterOf(a: Pick<Adopted, "source" | "profile">, name: string, level: number): Fighter {
  if (a.source.kind === "fly") return flyFighter(name, decodeFlyProgram(a.source.code), level);
  const c = circuitFromParts(a.source.parts);
  return {
    name,
    brain: circuitBrain(c),
    memory: new Array(c.nState).fill(0),
    level,
    ...(a.profile === "DUEL-12x3/1" ? { profile: "DUEL-12x3/1" as const } : {}),
  };
}

export const flySource = (p: FlyProgram) => ({ kind: "fly" as const, code: encodeFlyProgram(p) });
