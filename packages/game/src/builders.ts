/**
 * Builders' Lane (PRD R2): five resident pets that are fan tributes to people
 * who build TapeOut, each in a room of its own. They are drawn from what those
 * people made and say in public, never from their likeness, and every card says
 * the pet is a tribute and not affiliated.
 *
 * Behemoth is different from every other pet in the game: its mind is not a
 * Lingxi brain at all. It is the founder's own 4-bit CPU, circuit #1 on
 * processor #1 ("Blonskr_No1") of BNB Chain, read gate for gate. It takes no
 * input, so nothing here can steer it: it computes Fibonacci (1, 2, 3, 5, 8, 13),
 * overflows its four bits, and starts again, exactly as the chain's copy does.
 */

import { type Circuit, type FastBrain, type Rule, type RuleCircuit, beat, hexToBytes, load, ruleFromCircuit, timeOfDay } from "@lingxi/brain";
import { BEHEMOTH_NETLIST, BEHEMOTH_PINS } from "./behemoth.generated";
import type { Fighter } from "./spar";

export { BEHEMOTH_CIRCUIT, BEHEMOTH_NETLIST, BEHEMOTH_NETLIST_KECCAK, BEHEMOTH_PINS, BEHEMOTH_PROCESSOR, BEHEMOTH_PROCESSOR_NAME } from "./behemoth.generated";

/* ── Behemoth's CPU ──────────────────────────────────────────────────────── */

let cpu: Circuit | null = null;
export function behemothCircuit(): Circuit {
  return (cpu ??= load(hexToBytes(BEHEMOTH_NETLIST), BEHEMOTH_PINS.nIn, BEHEMOTH_PINS.nOut));
}

/** The CPU's output pins, as found by running it: the accumulator and the program counter, low bit first. */
const ACC = [0, 1, 2, 3] as const;
const PC = [8, 9, 10, 11, 12, 13, 14, 15] as const;
const num = (bits: readonly number[], pins: readonly number[]) => pins.reduce((n, p, i) => n | ((bits[p] ?? 0) << i), 0);

export interface CpuFrame {
  /** how many steps after power-on */
  step: number;
  /** the four accumulator lamps, low bit first */
  lamps: [number, number, number, number];
  /** the number the accumulator holds (0..15) */
  acc: number;
  pc: number;
  /** the LATCH state before this step and the outputs it gives, for checking against the chain */
  state: number[];
  outputs: number[];
}

/** One step of the CPU: the next LATCH state and the outputs. */
export function behemothStep(state: readonly number[]): { next: number[]; outputs: number[] } {
  const [next, outputs] = beat(behemothCircuit(), state, []);
  return { next, outputs };
}

let tape: CpuFrame[] | null = null;
/** The CPU's whole run from power-on until it returns to a state it has been in: it then repeats forever. */
export function behemothTape(): { frames: readonly CpuFrame[]; loopFrom: number } {
  if (!tape) {
    const frames: CpuFrame[] = [];
    const seen = new Map<string, number>();
    let state: number[] = new Array<number>(BEHEMOTH_PINS.nState).fill(0);
    for (let step = 0; step < 4096; step++) {
      const key = state.join("");
      if (seen.has(key)) {
        tape = frames;
        loop = seen.get(key)!;
        moments = labelMoments(frames, loop);
        break;
      }
      seen.set(key, step);
      const { next, outputs } = behemothStep(state);
      const lamps = ACC.map((p) => outputs[p] ?? 0) as CpuFrame["lamps"];
      frames.push({ step, lamps, acc: num(outputs, ACC), pc: num(outputs, PC), state, outputs });
      state = next;
    }
    if (!tape) throw new Error("Behemoth did not settle into a loop");
  }
  return { frames: tape, loopFrom: loop };
}
let loop = 0;

/** The frame the CPU is on after `step` steps, however large. */
export function behemothAt(step: number): CpuFrame {
  const { frames, loopFrom } = behemothTape();
  const s = Math.max(0, Math.floor(step));
  return s < frames.length ? frames[s]! : frames[loopFrom + ((s - loopFrom) % (frames.length - loopFrom))]!;
}

/** The founder's first post gave its speed: one step per BNB Chain block of the time, 0.45 s. */
export const BEHEMOTH_STEP_MS = 450;
/** Everyone watching sees the same step at the same moment. */
export const behemothStepNow = (ms: number): number => Math.floor(ms / BEHEMOTH_STEP_MS);

export const FIBONACCI: readonly number[] = [1, 2, 3, 5, 8, 13];

export type CpuMoment =
  | { kind: "count"; n: number; index: number }
  | { kind: "peak" }
  | { kind: "overflow"; n: number }
  | { kind: "boot" };

/**
 * What the CPU is doing on a step, in a pet's terms: counting up the Fibonacci
 * numbers, reaching 13 (the largest that fits in four bits), then spilling over
 * (21 does not fit) until it starts again.
 */
export function behemothMoment(step: number): CpuMoment {
  behemothTape();
  return moments![behemothAt(step).step]!;
}
let moments: CpuMoment[] | null = null;

function labelMoments(frames: readonly CpuFrame[], loopFrom: number): CpuMoment[] {
  const out: CpuMoment[] = [];
  let index = -1;
  let peakAt = -1;
  frames.forEach((f, k) => {
    // the loop begins again from the same state: the count starts over
    if (k === loopFrom) {
      index = -1;
      peakAt = -1;
    }
    if (peakAt < 0 && f.acc === FIBONACCI[index + 1]) {
      index++;
      if (index === FIBONACCI.length - 1) peakAt = k;
    }
    out.push(index < 0 ? { kind: "boot" } : peakAt < 0 ? { kind: "count", n: FIBONACCI[index]!, index } : k - peakAt < BEHEMOTH_STEPS_PER_ROUND ? { kind: "peak" } : { kind: "overflow", n: f.acc });
  });
  return out;
}

/** How many steps one fight round takes: one pass of the CPU's Fibonacci loop. */
export const BEHEMOTH_STEPS_PER_ROUND = 9;
/** The level Behemoth fights at. */
export const BEHEMOTH_LEVEL = 2;

/**
 * Behemoth as a sparring partner. It does not look at the fight: each round its
 * CPU runs nine steps and the three low lamps of the accumulator pick the move.
 * The same fight every time, so a pet can be taught to read it.
 */
export function behemothFighter(name: string): Fighter {
  const brain: FastBrain = {
    nIn: 16,
    nOut: 8,
    nState: BEHEMOTH_PINS.nState,
    step(state) {
      let st = Array.from(state);
      let out: number[] = [];
      for (let i = 0; i < BEHEMOTH_STEPS_PER_ROUND; i++) {
        const r = behemothStep(st);
        st = r.next;
        out = r.outputs;
      }
      st.forEach((b, i) => (state[i] = b));
      return (num(out, ACC) & 7) | (2 << 3);
    },
  };
  // G2: level 2, a boss's. LX-SPAR/2 counts half a power a level, so at its old level 1 an untaught gentle pet beat it in
  // 16 of 20 spars; at 2 the starters lose most and a pet the coach teaches to read it wins (builders.test.ts)
  return { name, brain, memory: new Array<number>(BEHEMOTH_PINS.nState).fill(0), level: BEHEMOTH_LEVEL };
}

/* ── the calendar ────────────────────────────────────────────────────────── */

/** Behemoth first ran on 2026-08-15 (the founder's post, 08:26 UTC). */
export const BEHEMOTH_BORN_UTC = Date.UTC(2026, 7, 15);
/** Whole days since Behemoth first ran, by the viewer's own calendar date. */
export function daysSinceBehemoth(now: Date): number {
  return Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - BEHEMOTH_BORN_UTC) / 86_400_000);
}
/** Every hundredth day is a party on the lane (day 100 is 2026-11-23). */
export function laneParty(now: Date): number | null {
  const d = daysSinceBehemoth(now);
  return d > 0 && d % 100 === 0 ? d : null;
}

/* ── the residents ───────────────────────────────────────────────────────── */

export type BuilderId = "behemoth" | "mars" | "tapboy" | "builder" | "diver";

export interface BuilderPet {
  id: BuilderId;
  name: { en: string; zh: string };
  /** the person this is a tribute to, by public handle */
  tribute: { handle: string; as: { en: string; zh: string } };
  room: number;
  /** where it stands in its room, in room pixels (128 wide) */
  spot: { x: number; y: number };
  look: { line: "gentle" | "bold" | "curious"; stage: "child" | "teen" | "adult"; palette: "silicon" | "mars" | "sky" | "sunny" | "mint"; outfit: { head?: string; face?: string; held?: string } };
  /** what it says, in its person's own public words where quoted */
  lines: Array<{ en: string; zh: string }>;
  about: { en: string; zh: string };
  /** Behemoth runs the founder's CPU; the others are Lingxi pets with these lessons */
  mind: { kind: "cpu" } | { kind: "pet"; lessons: Rule[] };
}

const rule = (label: string, when: Rule["when"], want: number, mood: number): Rule => ({ label, when, then: { want, mood } });

export const BUILDER_PETS: readonly BuilderPet[] = [
  {
    id: "behemoth",
    name: { en: "Behemoth", zh: "巨兽" },
    tribute: { handle: "Blonskr", as: { en: "the founder's first on-chain computer", zh: "创始人的第一台链上计算机" } },
    room: 66,
    spot: { x: 102, y: 104 },
    look: { line: "gentle", stage: "adult", palette: "silicon", outfit: { head: "b:lamps" } },
    lines: [
      { en: "全力以赴💪 All in!", zh: "全力以赴💪" },
      { en: "1, 2, 3, 5, 8, 13… and 21 doesn't fit. Again!", zh: "1、2、3、5、8、13……21 装不下。再来！" },
      { en: "Nobody can unplug me.", zh: "没有人能拔掉我的电源。" },
      { en: "What's the use case? Come closer, I'll show you.", zh: "有什么用？靠近点，我给你看。" },
    ],
    about: {
      en: "Behemoth thinks with the founder's real 4-bit CPU, read gate for gate from BNB Chain. It takes no input, so nobody steers it, not even us.",
      zh: "巨兽用的是创始人那台真实的 4 位处理器，从 BNB Chain 上一门一门读下来的。它没有输入，所以谁也左右不了它，包括我们。",
    },
    mind: { kind: "cpu" },
  },
  {
    id: "mars",
    name: { en: "Little Mars", zh: "小火星" },
    tribute: { handle: "bitcoin2themars", as: { en: "Mars, who cheers every builder on", zh: "为每个建设者加油的火星大哥" } },
    room: 29,
    spot: { x: 26, y: 108 },
    look: { line: "bold", stage: "adult", palette: "mars", outfit: { held: "b:telescope" } },
    lines: [
      { en: "Did you TapeOut today?", zh: "今天，你 TapeOut 了吗？" },
      { en: "👀", zh: "👀" },
      { en: "gBEM!", zh: "gBEM！" },
      { en: "I watch the sky for new circuits.", zh: "我守着天空，等新的电路出现。" },
    ],
    about: { en: "Little Mars keeps watch over the misty path and counts the circuits taped out on X Layer today.", zh: "小火星守在雾蒙蒙的小路上，数着今天 X Layer 上流片了多少块电路。" },
    mind: { kind: "pet", lessons: [rule("cheer when a friend comes", { event: [1] }, 2, 3), rule("look when you're here", { owner: [1], event: [0] }, 4, 2)] },
  },
  {
    id: "tapboy",
    name: { en: "Tapboy", zh: "掌机仔" },
    tribute: { handle: "BruceBlue", as: { en: "Bruce, who put a TapeOut CPU in a handheld", zh: "把 TapeOut 处理器装进掌机的 Bruce" } },
    room: 55,
    spot: { x: 102, y: 106 },
    look: { line: "curious", stage: "teen", palette: "sky", outfit: { held: "b:handheld" } },
    lines: [
      { en: "GMGM!", zh: "GMGM！" },
      { en: "Build. Prove. Grow.", zh: "Build. Prove. Grow." },
      { en: "Shut out the noise. Focus on now.", zh: "摒弃杂音，专注当下。" },
    ],
    about: { en: "Tapboy studies quietly in the shade and counts its days out of a thousand.", zh: "掌机仔在树荫下安静修炼，数着一千天里的第几天。" },
    mind: { kind: "pet", lessons: [rule("stay calm when startled", { event: [3] }, 0, 2), rule("play in the evening", { time: [3], energy: [1, 2, 3] }, 2, 2)] },
  },
  {
    id: "builder",
    name: { en: "Hardhat", zh: "安全帽" },
    tribute: { handle: "zakk_okx", as: { en: "Zakk, who builds X Layer", zh: "建设 X Layer 的 Zakk" } },
    room: 63,
    spot: { x: 102, y: 110 },
    look: { line: "bold", stage: "child", palette: "sunny", outfit: { head: "b:hardhat" } },
    lines: [
      { en: "It's the product, period.", zh: "It's the product, period." },
      { en: "On we go.", zh: "On we go." },
      { en: "Builders attract builders.", zh: "Builders attract builders." },
    ],
    about: { en: "Hardhat ignores the noise and goes to work.", zh: "安全帽不理会噪音，只管开工。" },
    mind: { kind: "pet", lessons: [rule("go to work when startled", { event: [3] }, 4, 2), rule("start early", { time: [1] }, 4, 3)] },
  },
  {
    id: "diver",
    name: { en: "Diver", zh: "潜水员" },
    tribute: { handle: "connectfarm1", as: { en: "the diving observer and his daily diary", zh: "每天写观察日记的潜水观察员" } },
    room: 57,
    spot: { x: 26, y: 108 },
    look: { line: "curious", stage: "child", palette: "mint", outfit: { face: "b:snorkel", held: "b:notebook" } },
    lines: [
      { en: "Observation diary, today: slow building beats quick money.", zh: "今日观察日记：慢慢建设，胜过快钱。" },
      { en: "I watch first. Then I write it down.", zh: "我先看，再记下来。" },
      { en: "Blub.", zh: "咕噜。" },
    ],
    about: { en: "Diver watches the river crossing and writes one line in its diary a day.", zh: "潜水员守着渡口看河水，每天在日记里写一行。" },
    mind: { kind: "pet", lessons: [rule("watch a visitor first", { event: [1] }, 0, 1), rule("explore by day", { time: [2], energy: [2, 3] }, 4, 2)] },
  },
];

export const BUILDER_PET: Readonly<Record<BuilderId, BuilderPet>> = Object.fromEntries(BUILDER_PETS.map((b) => [b.id, b])) as Record<BuilderId, BuilderPet>;
export const BUILDER_ROOMS: readonly number[] = BUILDER_PETS.map((b) => b.room);
export const builderIn = (room: number): BuilderPet | null => BUILDER_PETS.find((b) => b.room === room) ?? null;
/** The lane runs along the road out of home: Hardhat first, Behemoth at the far end (65 → 63 → 57 → 56 → 55 → 2 → 29 → 66). */
export const LANE_ORDER: readonly BuilderId[] = ["builder", "diver", "tapboy", "mars", "behemoth"];

/**
 * What a builder pet says and how it looks, as a circuit each (plan 4.11), taped out with the other rules.
 *   in  bits 0-5  the four-minute slot of the day (the same for everyone, so a line is shared by all who visit)
 *       bits 6-7  time of day (0 night, 1 morning, 2 day, 3 evening)
 *       bit  8    you have met it before
 *   out bits 0-1  mood (0-3); bits 2-4 which of its lines
 * Each starts its lines at its own place for each time of day, so the same slot reads differently by morning and
 * by night; the moods follow when each is most awake.
 */
const BUILDER_TEMPER: Readonly<Record<BuilderId, { base: number; morning: number; night: number; start: readonly [number, number, number, number] }>> = {
  behemoth: { base: 1, morning: 0, night: 1, start: [3, 0, 1, 2] },
  mars: { base: 2, morning: 1, night: -1, start: [5, 0, 2, 4] },
  tapboy: { base: 2, morning: 1, night: 0, start: [4, 0, 1, 3] },
  builder: { base: 1, morning: 0, night: 0, start: [2, 1, 0, 4] },
  diver: { base: 1, morning: -1, night: 1, start: [1, 3, 0, 5] },
};

export function builderReference(b: BuilderPet, word: number): number {
  const t = BUILDER_TEMPER[b.id];
  const slot = word & 63;
  const tod = (word >> 6) & 3;
  const met = (word >> 8) & 1;
  const line = (slot + t.start[tod]!) % b.lines.length;
  const mood = Math.max(0, Math.min(3, t.base + (tod === 1 ? t.morning : 0) + (tod === 0 || tod === 3 ? t.night : 0) + met));
  return mood | (line << 2);
}

export const builderRule = (b: BuilderPet): RuleCircuit => ({
  name: `builder:${b.id}`,
  about: { en: "Which of this builder pet's lines it says now, and its mood: by the four-minute slot, the time of day and whether you have met.", zh: "这只建造者宠物现在说哪句话、心情如何：取决于四分钟一格的时段、一天中的时间，以及你们是否见过。" },
  inBits: 9,
  reference: (w) => builderReference(b, w),
});

export const BUILDER_RULES: readonly RuleCircuit[] = BUILDER_PETS.map(builderRule);
const builderAnswers = new Map(BUILDER_PETS.map((b, i) => [b.id, ruleFromCircuit(BUILDER_RULES[i]!)]));

/** The circuit's answer for a builder pet now: its line and mood. */
export function builderNow(b: BuilderPet, ms: number, hour: number, met: boolean): { line: { en: string; zh: string }; mood: number } {
  const word = (Math.floor(ms / 240_000) % 64) | (timeOfDay(hour) << 6) | (met ? 256 : 0);
  const a = builderAnswers.get(b.id)!(word);
  return { line: b.lines[(a >> 2) & 7]!, mood: a & 3 };
}

/** The line a builder pet says now: it changes every few minutes, the same for everyone at the same hour. */
export function builderLine(b: BuilderPet, ms: number, hour = new Date(ms).getHours(), met = false): { en: string; zh: string } {
  return builderNow(b, ms, hour, met).line;
}

/** Tapboy counts real days out of a thousand, as its person does each morning (day 91 was 2026-11-15). */
export function tapboyDay(now: Date): number {
  return 91 + Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(2026, 10, 15)) / 86_400_000);
}
