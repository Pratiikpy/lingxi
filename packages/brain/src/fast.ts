/**
 * A fast evaluator for compiled pet brains, for the game loop and for replaying
 * a day. It runs the same netlist as src/tap02.ts `beat` (the tests prove they
 * agree on every beat) but over a flat Int32Array of operands and a reused
 * signal buffer, with no allocation per beat.
 */

import type { PetNetlist } from "./compile";

export interface FastBrain {
  readonly nIn: number;
  readonly nOut: number;
  readonly nState: number;
  /** step: state bits in place, returns the output word (bit k = output k) */
  step(state: Uint8Array, inputWord: number): number;
}

export function fastBrain(n: PetNetlist): FastBrain {
  const nIn = n.nIn;
  const nState = n.latches.length;
  const latchBase = 2 + nIn;
  const gateBase = latchBase + nState;
  const g = n.gates.length;
  const ops = new Int32Array(2 * g);
  n.gates.forEach(([a, b], i) => {
    ops[2 * i] = a;
    ops[2 * i + 1] = b;
  });
  const dsig = Int32Array.from(n.latches);
  const sig = new Uint8Array(gateBase + g);
  const firstOut = sig.length - n.nOut;
  return {
    nIn,
    nOut: n.nOut,
    nState,
    step(state: Uint8Array, word: number): number {
      sig[0] = 0;
      sig[1] = 1;
      for (let i = 0; i < nIn; i++) sig[2 + i] = (word >>> i) & 1;
      for (let j = 0; j < nState; j++) sig[latchBase + j] = state[j]!;
      for (let i = 0; i < g; i++) sig[gateBase + i] = sig[ops[2 * i]!]! & sig[ops[2 * i + 1]!]! ? 0 : 1;
      for (let j = 0; j < nState; j++) state[j] = sig[dsig[j]!]!;
      let out = 0;
      for (let k = 0; k < n.nOut; k++) out |= sig[firstOut + k]! << k;
      return out;
    },
  };
}
