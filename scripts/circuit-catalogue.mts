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
import {
  INPUT_FIELDS,
  MOODS,
  NUDGES,
  STARTERS,
  WANTS,
  beat,
  bitsToWord,
  compileProgram,
  load,
  netlistBytes,
  ruleBytes,
  stateBits,
  wordToBits,
} from "@lingxi/brain";
import { RULES, processorAbi, xLayer, type Deployment } from "@lingxi/chain";
import { BUILDER_PETS } from "@lingxi/game";
import { CHARACTERS } from "../packages/world/src/characters";
import { MOOD_NAMES, VALUE_NAMES, WANT_NAMES } from "../apps/web/src/play/ruleText";

/** Each input pin's name in Chinese, as the game's screens speak of it (C5). */
const FIELD_ZH: Record<string, string> = {
  hunger: "饱饿",
  joy: "快乐",
  energy: "精力",
  clean: "干净",
  time: "时间",
  action: "你做的事",
  event: "身边发生的事",
  owner: "你在不在",
};
/**
 * Each rule's input and answer fields named in Chinese (R75), by the rule's family (the part of its name before a colon),
 * in the words of each field's own Chinese meaning, so the catalogue page in Chinese reads a run's answer in Chinese.
 */
const RULE_FIELD_ZH: Record<string, Record<string, string>> = {
  drop: {
    tier: "稀有度",
    home: "房间相合",
    exponent: "权重指数",
    weighted: "有权重",
    rare: "稀有",
    familiarity: "熟悉度",
  },
  trust: {
    points: "信任点数",
    taste: "口味",
    counted: "今天已算过",
    level: "信任等级",
    gain: "加的点数",
    refused: "被拒收",
  },
  skills: { held: "已投入点数", tier: "层", open: "已开放", needs: "需要的点数" },
  folk: {
    time: "时间",
    trust: "信任等级",
    gift: "今天的礼物",
    petHappy: "宠物开心",
    petHungry: "宠物饿了",
    questReady: "任务可交",
    mood: "心情",
    line: "说哪句",
  },
  builder: { slot: "时段", time: "时间", met: "见过", mood: "心情", line: "说哪句" },
};
/** A rule's own name in Chinese: what it decides, and whose it is for a resident's or a builder pet's (R75). */
function ruleNameZh(name: string): string {
  const [family, who] = name.split(":");
  if (family === "drop") return "找东西";
  if (family === "trust") return "信任";
  if (family === "skills") return "技能树";
  if (family === "folk") {
    const c = CHARACTERS.find((x) => x.id === who);
    if (c) return `居民问候 · ${c.name.zh}`;
  }
  if (family === "builder") {
    const b = BUILDER_PETS.find((x) => x.id === who);
    if (b) return `建造者宠物 · ${b.name.zh}`;
  }
  throw new Error(`rule ${name} has no Chinese name: give it one in circuit-catalogue.mts`);
}
/** A rule's fields with their Chinese names; a field without one stops the catalogue being written. */
function fieldsZh(rule: (typeof RULES)[number]) {
  const family = rule.name.split(":")[0]!;
  const named = (list: typeof rule.fields.inputs) =>
    list.map((f) => {
      const nameZh = RULE_FIELD_ZH[family]?.[f.name];
      if (!nameZh) throw new Error(`rule ${rule.name}'s field ${f.name} has no Chinese name`);
      return { ...f, nameZh };
    });
  return { inputs: named(rule.fields.inputs), outputs: named(rule.fields.outputs) };
}
/** A starter brain's memory in Chinese: the names are the Mind sheet's own (ruleText.ts), the labels said the same way. */
const MEMORY_ZH: Record<string, { nameZh: string; labelZh: string }> = {
  trust: { nameZh: "信任", labelZh: "它有多信任你" },
  likesToys: { nameZh: "喜欢玩具", labelZh: "记得玩具很好玩" },
  scared: { nameZh: "还在害怕", labelZh: "还没从吓人的事里缓过来" },
  awake: { nameZh: "醒了", labelZh: "上次睡觉以后过了几拍" },
};

/** The nudge pin's values in Chinese: "none", then the game's own words for the seven natures (the duel screen's). */
const NUDGE_ZH = ["没有", "勇敢", "好奇", "嘴馋", "沉稳", "贪玩", "温柔", "害羞"];

const OUT = new URL("../apps/web/public/circuits.json", import.meta.url);
const RPCS = ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"];
/** Every input of a rule up to this many bits is a vector; a wider one gets VECTORS_WIDE spread across its range. */
const ALL_UP_TO_BITS = 8;
const VECTORS_WIDE = 96;
/** Vectors for each brain: input words from a fresh (all-zero) memory. */
const BRAIN_VECTORS = 48;
const CATALOGUE = "LX-CIRCUITS/1";

const d = JSON.parse(
  readFileSync(new URL("../packages/chain/deployments/xlayer.json", import.meta.url), "utf8"),
) as Deployment & {
  circuits: Record<string, { id: string }>;
  rules: Record<string, { id: string; tx: string; gates: number }>;
};
const pub = createPublicClient({
  chain: { ...xLayer, rpcUrls: { default: { http: [RPCS[0]!] } } },
  transport: http(RPCS[0]),
});

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
  return [...new Set([0, top, ...Array.from({ length: n - 2 }, (_, i) => Math.round(((i + 1) * top) / (n - 1)))])].sort(
    (a, b) => a - b,
  );
};

const rules = RULES.map((rule) => {
  const rec = d.rules[rule.name];
  if (!rec) throw new Error(`rule ${rule.name} has no circuit on record`);
  const bytes = ruleBytes(rule);
  const inputs =
    rule.inBits <= ALL_UP_TO_BITS
      ? Array.from({ length: 2 ** rule.inBits }, (_, i) => i)
      : spread(rule.inBits, VECTORS_WIDE);
  return {
    name: rule.name,
    nameZh: ruleNameZh(rule.name),
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
    // what each input and answer bit means (declared beside the rule's reference, so it cannot drift from it), each
    // field with its name in Chinese
    fields: fieldsZh(rule),
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
    const step = {
      state: Number(bitsToWord(state)),
      input,
      output: Number(bitsToWord(outs)),
      nextState: Number(bitsToWord(next)),
    };
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
    memory: program.memory.reduce<
      Array<{ name: string; nameZh: string; label?: string; labelZh: string; kind: string; lo: number; bits: number }>
    >((acc, m) => {
      const lo = acc.reduce((n, x) => n + x.bits, 0);
      const zh = MEMORY_ZH[m.name];
      if (!zh) throw new Error(`brain ${line}'s memory ${m.name} has no Chinese name`);
      return [
        ...acc,
        {
          name: m.name,
          nameZh: zh.nameZh,
          ...(m.label ? { label: m.label } : {}),
          labelZh: zh.labelZh,
          kind: m.kind,
          lo,
          bits: m.kind === "flag" ? 1 : (m as { bits: number }).bits,
        },
      ];
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
    inputs:
      "bytes, little-endian: bit 0 of the input word is bit 0 of the first byte; ceil(nIn / 8) bytes (2 for every circuit here: each has 16 input pins, and a rule reads only its low inBits, the rest 0)",
    outputs: "bytes, little-endian, the same way: the first byte holds output bits 0 to 7",
    state: "a brain's memory, packed the same way as inputs (processor.step takes and returns it)",
    eval: "processor.eval(uint256 id, bytes inputs) view returns (bytes outputs)",
    step: "processor.step(uint256 id, bytes state, bytes inputs) view returns (bytes newState, bytes outputs)",
  },
  // the same notes in Chinese (C5), beside the English so a reader of either can call a circuit; keys match `encoding`
  encodingZh: {
    abi: "标准 Solidity ABI：eval 的调用数据依次是 4 字节选择器、32 字节的 id、inputs 的偏移量（0x40）、inputs 的字节长度，再是补齐到 32 字节的 inputs；step 的依次是选择器、id、state 的偏移量（0x60）、inputs 的偏移量（0x60 加上 state 长度占的 32 字节和补齐后的 state），然后是 state 的长度和补齐后的字节，再是 inputs 的长度和补齐后的字节。返回值也按同样方式 ABI 编码：eval 返回一个 bytes（偏移量、长度、数据）；step 返回两个，先 newState 后 outputs。选择器：eval 0x934d06ea，step 0xe8281a1a（签名的 keccak256）。",
    ids: "这里每个电路的 id 都是 uint256，写成十进制字符串",
    nState: "nState 数的是位数；state 占 ceil(nState / 8) 个字节（初始大脑是 1 个字节）",
    brains: "大脑按它的系别列出（gentle 温柔、bold 勇敢、curious 好奇）；name 只是标签",
    inputs:
      "字节，小端序：输入字的第 0 位就是第一个字节的第 0 位；共 ceil(nIn / 8) 个字节（这里每个电路都是 2 个：每个都有 16 个输入引脚，规则只读低 inBits 位，其余为 0）",
    outputs: "字节，小端序，方式相同：第一个字节存输出的第 0 到 7 位",
    state: "大脑的记忆，按和 inputs 一样的方式打包（processor.step 传入并返回它）",
    eval: "processor.eval(uint256 id, bytes inputs) view returns (bytes outputs)，只读调用，免费",
    step: "processor.step(uint256 id, bytes state, bytes inputs) view returns (bytes newState, bytes outputs)，只读调用，免费",
  },
  brainPins: {
    standard: "LX-PET/1",
    // the Chinese names are the game's own (ruleText.ts, the duel's natures), so the catalogue says what the game says
    inputs: INPUT_FIELDS.map((f) => ({
      name: f.name,
      lo: f.lo,
      bits: f.bits,
      values: [...f.values],
      nameZh: FIELD_ZH[f.name]!,
      valuesZh: [...VALUE_NAMES[f.name]!.zh],
    })),
    outputs: [
      { name: "want", lo: 0, bits: 3, values: [...WANTS], nameZh: "想做", valuesZh: [...WANT_NAMES.zh] },
      { name: "mood", lo: 3, bits: 2, values: [...MOODS], nameZh: "心情", valuesZh: [...MOOD_NAMES.zh] },
      { name: "nudge", lo: 5, bits: 3, values: [...NUDGES], nameZh: "性格推动", valuesZh: NUDGE_ZH },
    ],
  },
  rules,
  brains,
};

/** Runs every vector on X Layer and reads every netlist back: the list of disagreements (empty when all agree). */
async function onChain(c: typeof catalogue): Promise<string[]> {
  const wrong: string[] = [];
  for (const r of c.rules) {
    const stored = (await pub.readContract({
      address: c.processor,
      abi: processorAbi,
      functionName: "netlist",
      args: [BigInt(r.id)],
    })) as Hex;
    if (keccak256(stored) !== r.netlistKeccak)
      wrong.push(`rule ${r.name} (#${r.id}): the netlist on chain hashes to ${keccak256(stored)}`);
    const got = (await pub.multicall({
      allowFailure: false,
      batchSize: 1 << 20,
      contracts: r.vectors.map(([i]) => ({
        address: c.processor,
        abi: processorAbi,
        functionName: "eval",
        args: [BigInt(r.id), packWord(i, r.nIn)],
      })),
    })) as Hex[];
    got.forEach((h, k) => {
      const [i, want] = r.vectors[k]!;
      if ((unpackWord(h) & 0xff) !== want)
        wrong.push(`rule ${r.name}: input ${i} gives ${unpackWord(h) & 0xff} on chain, ${want} here`);
    });
  }
  for (const b of c.brains) {
    const stored = (await pub.readContract({
      address: c.processor,
      abi: processorAbi,
      functionName: "netlist",
      args: [BigInt(b.id)],
    })) as Hex;
    if (keccak256(stored) !== b.netlistKeccak)
      wrong.push(`brain ${b.line} (#${b.id}): the netlist on chain hashes to ${keccak256(stored)}`);
    const all = [...b.vectors.map((v) => ({ ...v, state: 0 })), ...b.walk];
    const got = (await pub.multicall({
      allowFailure: false,
      batchSize: 1 << 20,
      contracts: all.map((v) => ({
        address: c.processor,
        abi: processorAbi,
        functionName: "step",
        args: [BigInt(b.id), packWord(v.state, b.nState), packWord(v.input, 16)],
      })),
      // viem types a multicall over this ABI as the union of every function's result; every call here is `step`,
      // which returns (bytes newState, bytes outputs)
    })) as unknown as Array<readonly [Hex, Hex]>;
    got.forEach(([next, out], k) => {
      const v = all[k]!;
      if ((unpackWord(out) & 0xff) !== v.output || unpackWord(next) !== v.nextState)
        wrong.push(
          `brain ${b.line}: state ${v.state} input ${v.input} gives ${unpackWord(out)}/${unpackWord(next)} on chain, ${v.output}/${v.nextState} here`,
        );
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
const vectorCount =
  target.rules.reduce((n, r) => n + r.vectors.length, 0) +
  target.brains.reduce((n, b) => n + b.vectors.length + b.walk.length, 0);
if (wrong.length) {
  console.error(`${wrong.length} disagreement(s) with X Layer:\n${wrong.slice(0, 20).join("\n")}`);
  process.exit(1);
}
console.log(
  `${target.rules.length} rule circuits and ${target.brains.length} brains, ${vectorCount} vectors: every one agrees with X Layer, every netlist hash matches`,
);
if (!checking) {
  writeFileSync(OUT, `${JSON.stringify(catalogue, null, 1)}\n`);
  console.log(`written ${OUT.pathname}`);
}
