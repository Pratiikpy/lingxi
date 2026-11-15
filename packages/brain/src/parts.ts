/**
 * A circuit kept as the bytes it was taped out with, together with every circuit
 * it REFs, so it can be rebuilt with no network (an adopted brain, an owned
 * instinct). Parts are keyed by processor and circuit number.
 */

import { type Circuit, load, refKey } from "./tap02";

export interface CircuitPart {
  processor: string;
  id: string;
  nIn: number;
  nOut: number;
  hex: string;
}

/** How deep REFs are followed when a kept circuit is rebuilt. */
export const PARTS_MAX_DEPTH = 4;

const fromHex = (h: string) => Uint8Array.from((h.replace(/^0x/, "").match(/../g) ?? []).map((x) => parseInt(x, 16)));

/** Rebuild the first part, resolving its REFs from the others. Throws when a REF target is missing or too deep. */
export function circuitFromParts(parts: readonly CircuitPart[]): Circuit {
  const byKey = new Map(parts.map((p) => [refKey(p.processor, BigInt(p.id)), p]));
  const built = new Map<string, Circuit>();
  const build = (p: CircuitPart, depth: number): Circuit => {
    const key = refKey(p.processor, BigInt(p.id));
    const done = built.get(key);
    if (done) return done;
    if (depth > PARTS_MAX_DEPTH) throw new Error("circuit parts nest too deeply");
    const c = load(fromHex(p.hex), p.nIn, p.nOut, (cpu, id) => {
      const sub = byKey.get(refKey(cpu, id));
      return sub ? build(sub, depth + 1) : null;
    });
    built.set(key, c);
    return c;
  };
  if (!parts[0]) throw new Error("no circuit");
  return build(parts[0], 0);
}
