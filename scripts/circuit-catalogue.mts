/**
 * The circuit catalogue (H6): every Lingxi circuit on X Layer that another project can call, with its pins, what each
 * bit means, its netlist's hash and test vectors, written to apps/web/public/circuits.json for the catalogue page and
 * the repository. Before anything is written, every vector is run on X Layer itself (processor.eval for a rule,
 * processor.step for a brain) and must give the catalogue's answer, and every netlist read from chain must hash to the
 * one written; a catalogue that disagrees with the chain is never published.
 *
 *   npx tsx scripts/circuit-catalogue.mts            write the catalogue (after checking it on X Layer)
 *   npx tsx scripts/circuit-catalogue.mts --check    check the written catalogue against X Layer, write nothing
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, http, keccak256, type Address, type Hex } from "viem";
import { INPUT_FIELDS, MOODS, NUDGES, STARTERS, WANTS, beat, bitsToWord, compileProgram, load, netlistBytes, ruleBytes, stateBits, wordToBits } from "@lingxi/brain";
import { RULES, processorAbi, xLayer, type Deployment } from "@lingxi/chain";

const OUT = new URL("../apps/web/public/circuits.json", import.meta.url);
const RPCS = ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"];
/** Every input of a rule up to this many bits is a vector; a wider one gets VECTORS_WIDE spread across its range. */
const ALL_UP_TO_BITS = 8;
const VECTORS_WIDE = 96;
/** Vectors for each brain: input words from a fresh (all-zero) memory. */
const BRAIN_VECTORS = 48;
const CATALOGUE = "LX-CIRCUITS/1";

const d = JSON.parse(readFileSync(new URL("../packages/chain/deployments/xlayer.json", import.meta.url), "utf8")) as Deployment & {
  circuits: Record<string, { id: string }>;
  rules: Record<string, { id: string; tx: string; gates: number }>;
};
const pub = createPublicClient({ chain: { ...xLayer, rpcUrls: { default: { http: [RPCS[0]!] } } }, transport: http(RPCS[0]) });

/** Inputs as the processor takes them: little-endian bytes, bit 0 of the word in bit 0 of the first byte. */
const packWord = (word: number, bits: number): Hex => {
  const n = Math.max(1, Math.ceil(bits / 8));
  let h = "0x";
  for (let i = 0; i < n; i++) h += ((word >> (8 * i)) & 0xff).toString(16).padStart(2, "0");
  return h as Hex;
};
const unpackWord = (h: Hex): number => {
  let w = 0;
  for (let i = 0; i < (h.length - 2) / 2; i++) w |= parseInt(h.slice(2 + 2 * i, 4 + 2 * i), 16) << (8 * i);
  return w >>> 0;
};
/** A deterministic spread of a wide input range: both ends, then evenly apart. */
const spread = (bits: number, n: number): number[] => {
  const top = 2 ** bits - 1;
  return [...new Set([0, top, ...Array.from({ length: n - 2 }, (_, i) => Math.round(((i + 1) * top) / (n - 1)))])].sort((a, b) => a - b);
};

const rules = RULES.map((rule) => {
  const rec = d.rules[rule.name];
  if (!rec) throw new Error(`rule ${rule.name} has no circuit on record`);
  const bytes = ruleBytes(rule);
  const inputs = rule.inBits <= ALL_UP_TO_BITS ? Array.from({ length: 2 ** rule.inBits }, (_, i) => i) : spread(rule.inBits, VECTORS_WIDE);
  return {
    name: rule.name,
    about: rule.about,
    id: rec.id,
    tx: rec.tx,
    // a rule circuit has the brain's 16 input pins and reads only the low inBits of them (circuitInfo says nIn 16)
    nIn: 16,
    inBits: rule.inBits,
    outBits: 8,
    gates: rec.gates,
    netlistBytes: bytes.length,
    netlistKeccak: keccak256(bytes),
    // what each input and answer bit means (declared beside the rule's reference, so it cannot drift from it)
    fields: rule.fields,
    vectors: inputs.map((i) => [i, rule.reference(i)] as [number, number]),
  };
});

const BRAINS = ["gentle", "bold", "curious"] as const;
/** Beats in each brain's documented walk. */
const WALK_BEATS = 24;
/** A walk through a pet's minutes: a fixed, varied sequence of inputs (a scare, a toy, food, the owner coming and going). */
function walkOf(circuit: ReturnType<typeof load>, nState: number) {
  let state = new Array<number>(nState).fill(0);
  return Array.from({ length: WALK_BEATS }, (_, k) => {
    const input = (k * 40503 + 0x6a5) & 0xffff;
    const [next, outs] = beat(circuit, state, wordToBits(input, 16));
    const step = { state: Number(bitsToWord(state)), input, output: Number(bitsToWord(outs)), nextState: Number(bitsToWord(next)) };
    state = next;
    return step;
  });
}
const brains = BRAINS.map((line) => {
  const program = STARTERS[line];
  const bytes = netlistBytes(compileProgram(program));
  const circuit = load(bytes, 16, 8);
  const nState = stateBits(program);
  const zero = new Array<number>(nState).fill(0);
  const vectors = spread(16, BRAIN_VECTORS).map((w) => {
    const [next, outs] = beat(circuit, zero, wordToBits(w, 16));
    return { input: w, output: Number(bitsToWord(outs)), nextState: Number(bitsToWord(next)) };
  });
  return {
    name: `${line} starter brain`,
    line,
    id: d.circuits[line]!.id,
    nIn: 16,
    nOut: 8,
    nState,
    netlistBytes: bytes.length,
    netlistKeccak: keccak256(bytes),
    // memory bits in declaration order from bit 0 of the state
    memory: program.memory.reduce<Array<{ name: string; label?: string; kind: string; lo: number; bits: number }>>((acc, m) => {
      const lo = acc.reduce((n, x) => n + x.bits, 0);
      return [...acc, { name: m.name, ...(m.label ? { label: m.label } : {}), kind: m.kind, lo, bits: m.kind === "flag" ? 1 : (m as { bits: number }).bits }];
    }, []),
    stateFromZero: 0,
    vectors,
    // a short life: each beat starts from the memory the last one left, so memory carried between beats is documented too
    walk: walkOf(circuit, nState),
  };
});

const catalogue = {
  catalogue: CATALOGUE,
  about: {
    en: "Every Lingxi circuit on X Layer that another project can call: rule circuits (one answer from a few input bits) and the starter pet brains (16 input pins, 8 output pins, memory). Each is a TapeOut netlist on Lingxi's processor; eval and step are free view calls. Every test vector here was checked on X Layer when this file was made.",
    zh: "X Layer 上所有可以被别的项目调用的灵犀电路：规则电路（几个输入位，得出一个答案）和初始宠物大脑（16 个输入引脚、8 个输出引脚，带记忆）。每一个都是灵犀处理器上的 TapeOut 网表；eval 和 step 都是免费的只读调用。这个文件生成时，里面每一条测试向量都在 X Layer 上核对过。",
  },
  chainId: 196,
  rpcs: RPCS,
  explorer: "https://www.oklink.com/xlayer",
  processor: d.processor as Address,
  encoding: {
    abi: "standard Solidity ABI: eval's calldata is its 4-byte selector, then id as a 32-byte word, then the offset of inputs (0x40), then inputs' length in bytes, then inputs padded to 32 bytes; step's is the selector, id, the offset of state (0x60), the offset of inputs (0x60 plus 32 for state's length plus state padded to 32 bytes), then state's length and padded bytes, then inputs' length and padded bytes. Answers are ABI-encoded the same way: eval returns one bytes (offset, length, data); step returns two, newState first and outputs second. Selectors: eval 0x934d06ea, step 0xe8281a1a (keccak256 of the signature).",
    ids: "every circuit id here is a uint256 written as a decimal string",
    nState: "nState counts bits; the state is ceil(nState / 8) bytes (1 byte for the starter brains)",
    brains: "brains are listed by their line (gentle, bold, curious); name is a label",
    inputs: "bytes, little-endian: bit 0 of the input word is bit 0 of the first byte; ceil(nIn / 8) bytes (2 for every circuit here: each has 16 input pins, and a rule reads only its low inBits, the rest 0)",
    outputs: "bytes, little-endian, the same way: the first byte holds output bits 0 to 7",
    state: "a brain's memory, packed the same way as inputs (processor.step takes and returns it)",
    eval: "processor.eval(uint256 id, bytes inputs) view returns (bytes outputs)",
    step: "processor.step(uint256 id, bytes state, bytes inputs) view returns (bytes newState, bytes outputs)",
  },
  brainPins: {
    standard: "LX-PET/1",
    inputs: INPUT_FIELDS.map((f) => ({ name: f.name, lo: f.lo, bits: f.bits, values: [...f.values] })),
    outputs: [
      { name: "want", lo: 0, bits: 3, values: [...WANTS] },
      { name: "mood", lo: 3, bits: 2, values: [...MOODS] },
      { name: "nudge", lo: 5, bits: 3, values: [...NUDGES] },
    ],
  },
  rules,
  brains,
};

/** Runs every vector on X Layer and reads every netlist back: the list of disagreements (empty when all agree). */
async function onChain(c: typeof catalogue): Promise<string[]> {
  const wrong: string[] = [];
  for (const r of c.rules) {
    const stored = (await pub.readContract({ address: c.processor, abi: processorAbi, functionName: "netlist", args: [BigInt(r.id)] })) as Hex;
    if (keccak256(stored) !== r.netlistKeccak) wrong.push(`rule ${r.name} (#${r.id}): the netlist on chain hashes to ${keccak256(stored)}`);
    const got = (await pub.multicall({
      allowFailure: false,
      batchSize: 1 << 20,
      contracts: r.vectors.map(([i]) => ({ address: c.processor, abi: processorAbi, functionName: "eval", args: [BigInt(r.id), packWord(i, r.nIn)] })),
    })) as Hex[];
    got.forEach((h, k) => {
      const [i, want] = r.vectors[k]!;
      if ((unpackWord(h) & 0xff) !== want) wrong.push(`rule ${r.name}: input ${i} gives ${unpackWord(h) & 0xff} on chain, ${want} here`);
    });
  }
  for (const b of c.brains) {
    const stored = (await pub.readContract({ address: c.processor, abi: processorAbi, functionName: "netlist", args: [BigInt(b.id)] })) as Hex;
    if (keccak256(stored) !== b.netlistKeccak) wrong.push(`brain ${b.line} (#${b.id}): the netlist on chain hashes to ${keccak256(stored)}`);
    const all = [...b.vectors.map((v) => ({ ...v, state: 0 })), ...b.walk];
    const got = (await pub.multicall({
      allowFailure: false,
      batchSize: 1 << 20,
      contracts: all.map((v) => ({ address: c.processor, abi: processorAbi, functionName: "step", args: [BigInt(b.id), packWord(v.state, b.nState), packWord(v.input, 16)] })),
    })) as Array<readonly [Hex, Hex]>;
    got.forEach(([next, out], k) => {
      const v = all[k]!;
      if ((unpackWord(out) & 0xff) !== v.output || unpackWord(next) !== v.nextState) wrong.push(`brain ${b.line}: state ${v.state} input ${v.input} gives ${unpackWord(out)}/${unpackWord(next)} on chain, ${v.output}/${v.nextState} here`);
    });
  }
  return wrong;
}

const checking = process.argv.includes("--check");
const target = checking ? (JSON.parse(readFileSync(OUT, "utf8")) as typeof catalogue) : catalogue;
if (checking && JSON.stringify(target) !== JSON.stringify(catalogue)) {
  console.error("circuits.json is not what this repository's circuits give: run without --check to rewrite it");
  process.exit(1);
}
const wrong = await onChain(target);
const vectorCount = target.rules.reduce((n, r) => n + r.vectors.length, 0) + target.brains.reduce((n, b) => n + b.vectors.length + b.walk.length, 0);
if (wrong.length) {
  console.error(`${wrong.length} disagreement(s) with X Layer:\n${wrong.slice(0, 20).join("\n")}`);
  process.exit(1);
}
console.log(`${target.rules.length} rule circuits and ${target.brains.length} brains, ${vectorCount} vectors: every one agrees with X Layer, every netlist hash matches`);
if (!checking) {
  writeFileSync(OUT, `${JSON.stringify(catalogue, null, 1)}\n`);
  console.log(`written ${OUT.pathname}`);
}
