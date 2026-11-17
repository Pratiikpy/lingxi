import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { type Circuit, type PetNetlist, STARTERS, circuitBrain, compileProgram, composeChild, fastBrain, load, netlistBytes, refKey } from "@lingxi/brain";
import { type Brain } from "@lingxi/game";
import { HandheldCore } from "../src/core";
import type { BrainPart, TripBrain } from "../src/trip";

export const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
export const coreBytes = () => readFileSync(`${root}/wasm/lingxi-core.wasm`);
export const loadCore = () => HandheldCore.load(coreBytes());
export const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

/** Lingxi's processor on X Layer, as the starters were taped out on it (ids 1, 2, 3). */
export const PROCESSOR = "0xf70d324da8c1c4cb0de3ff147e53e7e9db543c4e";
export const STARTER_ID = { gentle: 1n, bold: 2n, curious: 3n } as const;

/** A tiny seeded random source, so a failure can be replayed. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
  return { next, int: (n: number) => next() % n, pick: <T>(a: readonly T[]) => a[next() % a.length]! };
}

export interface TestBrain {
  brain: Brain;
  trip: TripBrain;
  netlist?: PetNetlist;
}

export function starterBrain(line: keyof typeof STARTERS): TestBrain {
  const n = compileProgram(STARTERS[line]);
  const bytes = netlistBytes(n);
  return { brain: { fast: fastBrain(n), nState: n.latches.length }, trip: { processor: PROCESSOR, id: STARTER_ID[line], bytes, parts: [] }, netlist: n };
}

/** A child of two starters: its circuit REFs both parents, as a bred pet's does. */
export function childBrain(a: keyof typeof STARTERS, b: keyof typeof STARTERS): TestBrain {
  const parts: BrainPart[] = [a, b].map((l) => ({ processor: PROCESSOR, id: STARTER_ID[l as keyof typeof STARTER_ID], nIn: 16, nOut: 8, bytes: netlistBytes(compileProgram(STARTERS[l as keyof typeof STARTERS])) }));
  const child = composeChild({ cpu: PROCESSOR, id: STARTER_ID[a] }, { cpu: PROCESSOR, id: STARTER_ID[b] });
  const subs = new Map<string, Circuit>(parts.map((q) => [refKey(q.processor, q.id), load(q.bytes, 16, 8)]));
  const c = load(child.bytes, 16, 8, (cpu, id) => subs.get(refKey(cpu, id)));
  // a child's id is its own; any id the packet names is fine for the handheld, which checks the bytes' keccak
  return { brain: { fast: circuitBrain(c), nState: c.nState }, trip: { processor: PROCESSOR, id: 1000n, bytes: child.bytes, parts } };
}
