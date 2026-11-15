/**
 * The visible brain: every signal of one beat, and a layout of the gates by
 * logic depth, so the app can draw the circuit lighting up as the pet thinks.
 * Depth layout follows TapeFly's sim/netlist.ts gateDepth (MIT).
 */

import type { PetNetlist } from "./compile";

export interface BeatTrace {
  /** every signal's value this beat: constants, inputs, latch outputs, gates */
  signals: Uint8Array;
  /** state after the beat */
  nextState: Uint8Array;
  out: number;
}

export function traceBeat(n: PetNetlist, state: ArrayLike<number>, word: number): BeatTrace {
  const latchBase = 2 + n.nIn;
  const gateBase = latchBase + n.latches.length;
  const sig = new Uint8Array(gateBase + n.gates.length);
  sig[1] = 1;
  for (let i = 0; i < n.nIn; i++) sig[2 + i] = (word >>> i) & 1;
  for (let j = 0; j < n.latches.length; j++) sig[latchBase + j] = state[j] ? 1 : 0;
  n.gates.forEach(([a, b], i) => {
    sig[gateBase + i] = sig[a]! & sig[b]! ? 0 : 1;
  });
  const nextState = Uint8Array.from(n.latches, (d) => sig[d]!);
  let out = 0;
  const first = sig.length - n.nOut;
  for (let k = 0; k < n.nOut; k++) out |= sig[first + k]! << k;
  return { signals: sig, nextState, out };
}

export interface Layout {
  /** depth of every signal (inputs, constants and latch outputs are 0) */
  depth: number[];
  /** signals grouped by depth, column 0 holding inputs and latch outputs */
  columns: number[][];
}

export function layout(n: PetNetlist): Layout {
  const gateBase = 2 + n.nIn + n.latches.length;
  const depth = new Array<number>(gateBase + n.gates.length).fill(0);
  let max = 0;
  n.gates.forEach(([a, b], i) => {
    const d = 1 + Math.max(depth[a]!, depth[b]!);
    depth[gateBase + i] = d;
    if (d > max) max = d;
  });
  const columns: number[][] = Array.from({ length: max + 1 }, () => []);
  for (let s = 2; s < gateBase; s++) columns[0]!.push(s);
  for (let i = 0; i < n.gates.length; i++) columns[depth[gateBase + i]!]!.push(gateBase + i);
  return { depth, columns };
}
