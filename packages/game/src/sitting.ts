/**
 * Pet-sitting, the sitter's side (PRD C10, M2). The owner sends the pet to a
 * friend with everything it is; the friend cares for it (and may save it on
 * chain, as PetRegistry lets the named sitter do) but cannot teach, rename, breed
 * or give it away. When the pet comes home, the owner's game accepts it only if
 * it is provably the same pet, continued: every thought it had while away must
 * extend the owner's own log exactly, the log's keccak chain must reach the hash
 * the returned pet claims, and replaying those thoughts through its brain must
 * end at exactly the memory it came back with.
 *
 * What cannot be proven from thoughts alone (how full its tummy is, what it ate)
 * is taken as the sitter reports it, within the game's own limits.
 */

import { chainAll } from "./log";
import type { Brain, Pet } from "./sim";
import { METER_MAX, SUB } from "./pet";

export interface SitChain {
  petId: string;
  owner: string;
  bornChain: number;
  brains?: Record<string, string>;
  brainKey?: string;
  lastDay: number;
}

export interface SitPack {
  v: 1;
  pet: Pet;
  chain: SitChain | null;
  /** the friend's wallet the owner named on chain, if any */
  sitter: string | null;
  /** when the sitting ends (ms) */
  until: number;
  /** the owner's player id, so the stay counts toward the pets' friendship */
  host?: string;
}

export type ReturnCheck = { ok: true } | { ok: false; reason: "notSame" | "taught" | "logRewritten" | "hashMismatch" | "brainMismatch" | "timeBackwards" | "badState" };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Whether `back` is `home` continued by honest care. `brain` is the pet's brain (the same before and after, since sitters cannot teach). */
export function checkReturn(home: Pet, back: Pet, brain: Brain): ReturnCheck {
  if (home.bornAt !== back.bornAt || home.line !== back.line || home.name !== back.name || !same(home.family, back.family) || (home.instincts ?? 0) !== (back.instincts ?? 0)) {
    return { ok: false, reason: "notSame" };
  }
  if (!same(home.lessons, back.lessons)) return { ok: false, reason: "taught" };
  if (back.beat < home.beat) return { ok: false, reason: "timeBackwards" };
  const n = home.pendingLog.length;
  if (back.pendingLog.length < n || back.pendingLog.slice(0, n).some((w, i) => w !== home.pendingLog[i])) return { ok: false, reason: "logRewritten" };
  const added = back.pendingLog.slice(n);
  if (added.some((w) => !Number.isInteger(w) || w < 0 || w > 0xffff)) return { ok: false, reason: "badState" };
  if (chainAll(home.logHash, added) !== back.logHash) return { ok: false, reason: "hashMismatch" };
  // replay the thoughts it had away through the same brain, from the memory it left with
  const mem = Uint8Array.from(home.brain);
  for (const w of added) brain.fast.step(mem, w);
  if (mem.length !== back.brain.length || Array.from(mem).some((b, i) => b !== (back.brain[i] ? 1 : 0))) return { ok: false, reason: "brainMismatch" };
  for (const v of Object.values(back.meters)) if (!Number.isInteger(v) || v < 0 || v > METER_MAX * SUB) return { ok: false, reason: "badState" };
  return { ok: true };
}
