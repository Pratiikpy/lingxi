/**
 * Breeding by circuit composition (TAP-02 REF).
 *
 * A child's brain is a new circuit that contains a REF to each parent's brain
 * plus a little glue. Both parents see the child's 16 input pins and each keeps
 * its own memory as a block of the child's state (parent A first). The glue
 * decides whose answer the child gives:
 *   want   from parent A in the morning and day, from parent B in the evening and night
 *   mood   always from parent A
 *   nudge  always from parent B
 * so a child really does "take after" both, in a way anyone can read and check.
 * REF'd gates burn no transistors; only the glue is new.
 *
 * Layout (signal numbers): 0,1 constants · 2..17 inputs · 18..25 parent A's
 * outputs · 26..33 parent B's outputs · glue gates · the last 8 gates are the
 * child's outputs.
 */

import { type Element, NAND, REF, encode } from "./tap02";
import { N_IN, N_OUT, inputField } from "./pins";

export interface RefTarget {
  /** processor address, 0x-prefixed */
  cpu: string;
  id: bigint;
}

export interface ChildCircuit {
  bytes: Uint8Array;
  elements: Element[];
  nIn: number;
  nOut: number;
}

export const CHILD_VERSION = "LX-CHILD/1";

class Glue {
  readonly els: Element[];
  private next: number;
  constructor(head: Element[], firstFree: number) {
    this.els = head.slice();
    this.next = firstFree;
  }
  nand(a: number, b: number): number {
    const s = this.next++;
    this.els.push({ op: NAND, ins: [a, b], nOut: 1, firstOut: s });
    return s;
  }
  not(a: number): number {
    return this.nand(a, a);
  }
  /** sel ? a : b */
  mux(sel: number, a: number, b: number, notSel: number): number {
    return this.nand(this.nand(sel, a), this.nand(notSel, b));
  }
}

export function composeChild(a: RefTarget, b: RefTarget): ChildCircuit {
  const inputs = Array.from({ length: N_IN }, (_, i) => 2 + i);
  const aOut = 2 + N_IN; // 18
  const bOut = aOut + N_OUT; // 26
  const head: Element[] = [
    { op: REF, ins: inputs, cpu: a.cpu.toLowerCase(), id: a.id, nOut: N_OUT, firstOut: aOut },
    { op: REF, ins: inputs, cpu: b.cpu.toLowerCase(), id: b.id, nOut: N_OUT, firstOut: bOut },
  ];
  const g = new Glue(head, bOut + N_OUT);
  // time is 2 bits: 1 morning, 2 day → parent A. That is exactly "bit0 XOR bit1".
  const time = inputField("time");
  const t0 = 2 + time.lo;
  const t1 = t0 + 1;
  const nt = g.nand(t0, t1);
  const xor = g.nand(g.nand(t0, nt), g.nand(t1, nt)); // 1 for times 1 and 2
  const notXor = g.not(xor);
  const outs: number[] = [];
  for (let k = 0; k < 3; k++) outs.push(g.mux(xor, aOut + k, bOut + k, notXor)); // want
  for (let k = 3; k < 5; k++) outs.push(aOut + k); // mood
  for (let k = 5; k < 8; k++) outs.push(bOut + k); // nudge
  // the outputs must be the last 8 signals: invert all, then 8 consecutive final NOTs
  const inv = outs.map((s) => g.not(s));
  for (const s of inv) g.not(s);
  return { bytes: encode(g.els), elements: g.els, nIn: N_IN, nOut: N_OUT };
}
