/**
 * LX-SEAL/1: the circuit that seals a red packet. The escrow contract feeds it
 * one 16-bit word per claim and enforces what it answers, so every claim can be
 * re-run by anyone with the processor's free `eval`.
 *
 *   inputs  0-3   claim index (0 = first claimer)
 *           4-11  seed byte for this claim
 *           12    open (the contract says the packet is inside its time window)
 *           13    member (the claimer has a Lingxi pet on chain)
 *           14    lucky split (else even)
 *           15    pet owners only
 *   outputs 0     allowed = open AND (member OR NOT petOwnersOnly)
 *           1-4   weight 1..15 for a lucky split (8 when even): the mean of the
 *                 seed's two nibbles, plus one, capped at 15 (a gentle triangle around 8)
 *           5     best luck (weight 15 on a lucky split)
 *           6-7   0
 */

import { buildCircuit, type PetNetlist } from "./compile";

export const SEAL_VERSION = "LX-SEAL/1";

export interface SealInput {
  index: number;
  seed: number;
  open: boolean;
  member: boolean;
  lucky: boolean;
  petOwnersOnly: boolean;
}

export const sealWord = (i: SealInput): number =>
  (i.index & 15) |
  ((i.seed & 255) << 4) |
  (i.open ? 1 << 12 : 0) |
  (i.member ? 1 << 13 : 0) |
  (i.lucky ? 1 << 14 : 0) |
  (i.petOwnersOnly ? 1 << 15 : 0);

const luckyWeight = (seed: number) => Math.min(15, (((seed & 15) + (seed >> 4)) >> 1) + 1);

/** What the seal answers, as plain arithmetic (the reference the circuit is checked against). */
export function sealReference(word: number): number {
  const seed = (word >> 4) & 255;
  const open = (word >> 12) & 1;
  const member = (word >> 13) & 1;
  const lucky = (word >> 14) & 1;
  const only = (word >> 15) & 1;
  const allowed = open & (member | (only ^ 1));
  const weight = lucky ? luckyWeight(seed) : 8;
  const best = lucky && weight === 15 ? 1 : 0;
  return allowed | (weight << 1) | (best << 5);
}

export function compileSeal(): PetNetlist {
  return buildCircuit(16, SEAL_VERSION, (b) => {
    const seed = Array.from({ length: 8 }, (_, k) => b.input(4 + k));
    const [open, member, lucky, only] = [b.input(12), b.input(13), b.input(14), b.input(15)];
    const allowed = b.and(open, b.or(member, b.not(only)));
    const weightBits = [0, 1, 2, 3].map((k) =>
      b.fn(
        seed,
        Array.from({ length: 256 }, (_, s) => (luckyWeight(s) >> k) & 1),
      ),
    );
    // even split: weight 8 = 0b1000
    const w = weightBits.map((bit, k) => b.mux(lucky, bit, k === 3 ? b.one : b.zero));
    const best = b.and(
      lucky,
      b.fn(
        seed,
        Array.from({ length: 256 }, (_, s) => (luckyWeight(s) === 15 ? 1 : 0)),
      ),
    );
    return [allowed, ...w, best, b.zero, b.zero];
  });
}
