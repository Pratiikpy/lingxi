/**
 * Adoption papers (plan 4.8): a little one offered at the adoption centre travels to its new home as its whole
 * record, written by the breeder's game. Before a buyer pays, their game checks the papers against X Layer, so a
 * buyer always gets the pet that is on chain:
 *
 * - its brain: the child's circuit on chain must be the composition of two halves that recompile, byte for byte,
 *   from the papers' family and lessons, and the log saved on chain must be the start of the papers' log, with
 *   the rest replaying through that brain from the saved memory to the papers' memory;
 * - its record: the line and parents exactly; experience, level, traits, counts, diet, kinship and care mistakes
 *   exactly as saved when nothing happened since the save, otherwise never below the save and at most one level
 *   above it.
 *
 * What the check does not cover is stated where it is used: meters and sleep (the centre looks after the little
 * one while it waits), and the name (it is the breeder's choice and changes nothing).
 */

import { type StarterLine, bytesToHex, compileProgram, composeChild, netlistBytes } from "@lingxi/brain";
import { halvesOf, mindBrain } from "./family";
import { chainAll } from "./log";
import { unpackState } from "./pack";
import type { Pet } from "./sim";
import { legalGrowth, skillRules } from "./skills";
import { growthOf } from "./levels";
import { ZERO_HASH } from "./log";

const LINES: readonly StarterLine[] = ["gentle", "bold", "curious"];

/** What the chain says about the pet, read by the buyer's game. */
export interface ChainPetView {
  line: number;
  parentA: bigint;
  parentB: bigint;
  day: number;
  state: bigint;
  logHash: string;
  brainBits: number;
  /** the pet's brain circuit first, then each circuit it REFs, in order, as the processor stores them */
  parts: ReadonlyArray<{ processor: string; id: string; hex: string }>;
}

export type PapersProblem =
  | "notAChild"
  | "outsideInstinct"
  | "line"
  | "parents"
  | "brain"
  | "log"
  | "memory"
  | "record"
  | "growth";

/** How many words of the papers' log the chain has saved: the shortest prefix whose hash is the chain's. */
export function savedLength(log: readonly number[], chainHash: string): number | null {
  if (chainHash.toLowerCase() === ZERO_HASH) return 0;
  let h = ZERO_HASH;
  for (let i = 0; i < log.length; i++) {
    h = chainAll(h, [log[i]!]);
    if (h.toLowerCase() === chainHash.toLowerCase()) return i + 1;
  }
  return null;
}

/** Check adoption papers against the chain. Null when they match; otherwise the first thing that does not. */
export function checkPapers(papers: Pet, chain: ChainPetView): PapersProblem | null {
  const f = papers.family;
  if (!f || chain.parentA === 0n) return "notAChild";
  if (papers.outside) return "outsideInstinct";
  if (LINES[chain.line] !== papers.line) return "line";
  const [pa, pb] = f.parents;
  if ((pa.petId !== undefined && BigInt(pa.petId) !== chain.parentA) || (pb.petId !== undefined && BigInt(pb.petId) !== chain.parentB)) return "parents";

  // the brain: a child circuit over two halves, each recompiled from the papers
  if (chain.parts.length !== 3) return "brain";
  let halves;
  try {
    halves = halvesOf(f, papers.lessons, skillRules(papers.growth));
  } catch {
    return "brain";
  }
  const [glue, refA, refB] = chain.parts as [ChainPetView["parts"][0], ChainPetView["parts"][0], ChainPetView["parts"][0]];
  // compared without a 0x prefix, which some readers keep and some drop
  const norm = (h: string) => h.toLowerCase().replace(/^0x/, "");
  const hex = (b: Uint8Array) => norm(bytesToHex(b));
  if (hex(netlistBytes(compileProgram(halves[0]))) !== norm(refA.hex)) return "brain";
  if (hex(netlistBytes(compileProgram(halves[1]))) !== norm(refB.hex)) return "brain";
  const composed = composeChild({ cpu: refA.processor as `0x${string}`, id: BigInt(refA.id) }, { cpu: refB.processor as `0x${string}`, id: BigInt(refB.id) });
  if (hex(composed.bytes) !== norm(glue.hex)) return "brain";

  // the log: the chain's saved log is the start of the papers' log
  const log = papers.pendingLog;
  if (log.some((w) => !Number.isInteger(w) || w < 0 || w > 0xffff)) return "log";
  const saved = savedLength(log, chain.logHash);
  if (saved === null) return "log";
  if (chainAll(ZERO_HASH, log) !== papers.logHash) return "log";

  // the memory: the rest of the log replays from the saved memory to the papers' memory
  const onChain = unpackState(chain.state, chain.brainBits);
  const brain = mindBrain({ line: papers.line, lessons: papers.lessons, family: f, growth: papers.growth });
  if (brain.nState !== chain.brainBits || papers.brain.length !== chain.brainBits) return "memory";
  const mem = Uint8Array.from(onChain.brain);
  for (const w of log.slice(saved)) brain.fast.step(mem, w);
  if (Array.from(mem).some((b, i) => (b ? 1 : 0) !== (papers.brain[i] ? 1 : 0))) return "memory";

  // the record: exact when nothing happened since the save, otherwise only forward and at most a level further
  const growth = papers.growth ? legalGrowth(papers.growth) : true;
  if (!growth) return "growth";
  const level = growthOf(papers).level;
  const fresh = saved === log.length && chain.day > 0;
  const same = <T>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);
  const counts = { feed: papers.counts.feed, play: papers.counts.play, clean: papers.counts.clean, pet: papers.counts.pet, lessons: papers.counts.lessons };
  if (fresh) {
    if (papers.xp !== onChain.xp || level !== onChain.level || !same(papers.traits, onChain.traits) || !same(counts, onChain.counts) || !same(papers.diet, onChain.diet)) return "record";
  } else {
    if (papers.xp < onChain.xp || level < onChain.level || level > onChain.level + 1) return "record";
    for (const k of Object.keys(onChain.counts) as Array<keyof typeof counts>) if (counts[k] < onChain.counts[k]) return "record";
  }
  return null;
}
