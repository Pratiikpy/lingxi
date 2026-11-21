/**
 * Game rules as circuits (plan 4.11). A rule is written once as plain arithmetic (its reference), compiled to NAND
 * gates from its truth table, and taped out on Lingxi's processor. The game does not run the reference: it reads its
 * answers from the compiled circuit, so the circuit is the rule. On start the page compiles every rule again and
 * compares the bytes with the netlist stored on X Layer; a rule changed locally no longer matches its circuit.
 *
 * A rule reads the low `inBits` bits of its 16-bit input word (the rest are ignored) and answers in 8 bits.
 */

import { type PetNetlist, buildCircuit, netlistBytes } from "./compile";
import { fastBrain } from "./fast";
import { N_IN, N_OUT } from "./pins";

export interface RuleCircuit {
  /** stable key, used in the deployment record and on the proof page */
  name: string;
  /** what the rule decides, for the proof page */
  about: { en: string; zh: string };
  /** how many low input bits it reads */
  inBits: number;
  /** the rule as plain arithmetic: input word to 8-bit answer */
  reference: (word: number) => number;
  /** what each input and answer bit means, for the circuit catalogue other projects read (H6) */
  fields: { inputs: readonly RuleField[]; outputs: readonly RuleField[] };
}

/** A field of a rule's input word or answer: its low bit, its width, and what its values mean. */
export interface RuleField {
  name: string;
  lo: number;
  bits: number;
  meaning: { en: string; zh: string };
}

export const RULE_VERSION = "LX-RULE/1";
export const MAX_RULE_BITS = 12;

// keyed by the rule itself, never by its name: a rule changed under the same name must compile afresh
const compiled = new WeakMap<RuleCircuit, PetNetlist>();

/** The rule compiled to gates: one truth table per output bit over the bits it reads, shared where they agree. */
export function ruleNetlist(rule: RuleCircuit): PetNetlist {
  const hit = compiled.get(rule);
  if (hit) return hit;
  if (rule.inBits < 1 || rule.inBits > MAX_RULE_BITS) throw new Error(`${rule.name}: a rule reads 1 to ${MAX_RULE_BITS} bits`);
  const size = 1 << rule.inBits;
  const answers = Array.from({ length: size }, (_, w) => {
    const a = rule.reference(w);
    if (!Number.isInteger(a) || a < 0 || a > 255) throw new Error(`${rule.name}: answer ${a} for ${w} is not 8 bits`);
    return a;
  });
  const net = buildCircuit(N_IN, `${RULE_VERSION} ${rule.name}`, (b) => {
    const vars = Array.from({ length: rule.inBits }, (_, i) => b.input(i));
    return Array.from({ length: N_OUT }, (_, k) => b.fn(vars, answers.map((a) => (a >> k) & 1)));
  });
  compiled.set(rule, net);
  return net;
}

/** The bytes taped out for a rule. */
export const ruleBytes = (rule: RuleCircuit): Uint8Array => netlistBytes(ruleNetlist(rule));

/** Every answer the compiled circuit gives, indexed by input word (the bits the rule reads). */
export function ruleTable(rule: RuleCircuit): Uint8Array {
  const brain = fastBrain(ruleNetlist(rule));
  const state = new Uint8Array(0);
  const out = new Uint8Array(1 << rule.inBits);
  for (let w = 0; w < out.length; w++) out[w] = brain.step(state, w) & 0xff;
  return out;
}

/** A rule's answers as a function, read from its circuit; the table is built on first use. */
export function ruleFromCircuit(rule: RuleCircuit): (word: number) => number {
  let table: Uint8Array | null = null;
  const mask = (1 << rule.inBits) - 1;
  return (word) => {
    table ??= ruleTable(rule);
    return table[word & mask]!;
  };
}
