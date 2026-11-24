/**
 * Sparring TapeFly-format brains (PRD A1b). A Lingxi pet can face any brain
 * written for TapeFly's brawl: one of TapeFly's own ladder rivals, a chip list,
 * or a `p1.` program code pasted from a TapeFly link. The brain is compiled to
 * NAND exactly as TapeFly compiles it and runs as that circuit, reading the
 * fight through the DUEL-12x3/1 pins (see spar.ts).
 */

import {
  type FlyProgram,
  circuitBrain,
  compileFlyProgram,
  decodeFlyProgram,
  flyCircuit,
  programOfChips,
} from "@lingxi/brain";
import type { Fighter } from "./spar";

export interface FlyRival {
  id: string;
  name: string;
  /** TapeFly's chips, top to bottom, as its /api/v1/brawl ladder lists them */
  chips: string[];
  /** written by TapeFly's search rather than by hand */
  ai: boolean;
}

/** TapeFly's brawl ladder (fights 1-8), as published on 2026-11-15. */
export const FLY_RIVALS: readonly FlyRival[] = [
  { id: "ada", name: "Ada", chips: ["berserk"], ai: false },
  { id: "bo", name: "Bo", chips: ["bite"], ai: false },
  { id: "cyd", name: "Cyd", chips: ["breathe", "block", "flank", "bite"], ai: true },
  { id: "dex", name: "Dex", chips: ["punish", "block", "bite", "flank", "kite"], ai: true },
  { id: "eve", name: "Eve", chips: ["punish", "block", "bite"], ai: true },
  { id: "fox", name: "Fox", chips: ["punish", "block", "berserk", "finisher", "bite", "kite"], ai: true },
  { id: "gus", name: "Gus", chips: ["breathe", "block", "finisher", "bite"], ai: true },
  { id: "hal", name: "Hal", chips: ["block", "breathe", "finisher", "bite"], ai: true },
];

export class FlyLinkError extends Error {
  override name = "FlyLinkError";
}

/**
 * Reads what a player pasted: a TapeFly link carrying `program=p1.…` or
 * `chips=a,b,c`, a bare `p1.` code, or a comma-separated chip list.
 */
export function parseFlyBrain(text: string): FlyProgram {
  const t = text.trim();
  if (!t || t.length > 600) throw new FlyLinkError("empty");
  try {
    let program: string | null = null;
    let chips: string | null = null;
    if (/^https?:\/\//i.test(t)) {
      const u = new URL(t);
      const params = new URLSearchParams(u.search || u.hash.replace(/^#\??/, ""));
      program = params.get("program");
      chips = params.get("chips");
    } else if (t.startsWith("p1.")) program = t;
    else chips = t;
    if (program) return decodeFlyProgram(program);
    if (chips)
      return programOfChips(
        chips
          .split(",")
          .map((c) => c.trim().toLowerCase())
          .filter(Boolean),
      );
  } catch (e) {
    throw new FlyLinkError((e as Error).message);
  }
  throw new FlyLinkError("no brain in the link");
}

export function flyFighter(name: string, program: FlyProgram, level = 0): Fighter & { gates: number } {
  const gates = compileFlyProgram(program);
  return {
    name,
    brain: circuitBrain(flyCircuit(gates)),
    memory: [],
    level,
    profile: "DUEL-12x3/1",
    gates: gates.length,
  };
}
