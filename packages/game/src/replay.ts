/**
 * Rewind (PRD F11): scrub back through the pet's day and see, moment by moment,
 * what it sensed, which rule of its own circuit fired, what it decided and what it
 * remembered. Nothing is reconstructed by guesswork: the logged input words are
 * replayed through the brain the pet had at the time, from the very start of the
 * log, so memory is exactly what it was. The fast compiled brain carries memory up
 * to the window; inside it the rule reader (proven equal to the circuit) also
 * names the rule that fired.
 */

import { type DayChoices, HABIT_LINES } from "./personality";
import type { Trait } from "./pet";
import type { OutsideInstinct } from "./pet";
import { instinctBrain } from "./family";
import { type Program, type Rule, STARTERS, type Senses, decodeSenses, fastBrain, compileProgram, inputField, runBeat, stateBits } from "@lingxi/brain";
import { logSegments } from "./lessons";
import { BEAT_MS } from "./pet";
import { ACTION, EVENT, type Pet, WANT } from "./sim";

/** One brain the log ran on: a single program, or a child's two halves. */
export type Mind = ({ program: Program } | { halves: [Program, Program] }) & { outside?: OutsideInstinct };

export interface Frame {
  /** position in the whole log */
  index: number;
  /** when it happened (ms since 1970), or null for words logged before times were kept */
  at: number | null;
  senses: Senses;
  want: number;
  mood: number;
  nudge: number;
  /** which half of a child decided (0 by day, 1 by night) */
  half?: 0 | 1;
  /** the rule that fired, by position in the deciding program, or -1 for its "otherwise" */
  rule: number;
  /** the deciding program, so the screen can show the rule in words */
  program: Program;
  /** memory bits as they were going into this moment */
  memory: number[];
  /** the owned instinct circuit answered this moment, not a rule */
  outside?: true;
}

const TIME = inputField("time");

/** The beat of every log word that has one, from the sparse marks. */
export function beatsOfLog(p: Pick<Pet, "pendingLog" | "logMarks">): Array<number | null> {
  const out: Array<number | null> = new Array(p.pendingLog.length).fill(null);
  const marks = p.logMarks ?? [];
  for (let m = 0; m < marks.length; m++) {
    const [from, beat] = marks[m]!;
    const to = marks[m + 1]?.[0] ?? p.pendingLog.length;
    for (let i = from; i < to; i++) out[i] = beat + (i - from);
  }
  return out;
}

/**
 * `count` moments of the log ending `back` moments before its newest, oldest
 * first (back 0 is the latest day, 1440 the day before). `mindFor` returns the
 * brain the pet had for a stretch of lessons (the same one the game ran).
 */
export function rewind(pet: Pet, mindFor: (lessons: Rule[], outside?: OutsideInstinct, skills?: number[]) => Mind, count = 24 * 60, back = 0): Frame[] {
  const segs = logSegments(pet);
  const beats = beatsOfLog(pet);
  const total = Math.max(0, pet.pendingLog.length - back);
  const from = Math.max(0, total - count);
  const frames: Frame[] = [];
  let mem: number[] | null = null;
  let i = 0;
  for (const seg of segs) {
    const mind = mindFor(seg.lessons, seg.outside, seg.skills);
    const programs = "program" in mind ? [mind.program] : mind.halves;
    const sizes = programs.map(stateBits);
    const own = sizes.reduce((a, b) => a + b, 0);
    // an owned instinct keeps its memory after the pet's own
    const inst = mind.outside ? instinctBrain(mind.outside) : null;
    const nState = own + (inst?.nState ?? 0);
    // the log starts where the pet's memory was then: all zeros at birth, or what it was when it was kept (A66)
    if (!mem || mem.length !== nState) mem = !mem && pet.logStart?.length === nState ? pet.logStart.slice() : new Array(nState).fill(0);
    const fast = programs.map((p) => fastBrain(compileProgram(p)));
    const stepInstinct = (word: number): number => {
      if (!inst) return 0;
      const st = Uint8Array.from(mem!.slice(own));
      const out = inst.fast.step(st, word);
      for (let b = 0; b < st.length; b++) mem![own + b] = st[b]!;
      return out;
    };
    for (const word of seg.words) {
      const index = i++;
      if (index >= total) break;
      if (index < from) {
        // carry memory forward quickly; each half keeps its own bits
        let off = 0;
        programs.forEach((_, k) => {
          const st = Uint8Array.from(mem!.slice(off, off + sizes[k]!));
          fast[k]!.step(st, word);
          for (let b = 0; b < st.length; b++) mem![off + b] = st[b]!;
          off += sizes[k]!;
        });
        stepInstinct(word);
        continue;
      }
      const before = mem.slice();
      const io = stepInstinct(word);
      const parts = programs.map((p, k) => {
        const off = sizes.slice(0, k).reduce((a, b) => a + b, 0);
        return { k, off, r: runBeat(p, mem!.slice(off, off + sizes[k]!), word) };
      });
      for (const part of parts) part.r.state.forEach((v, b) => (mem![part.off + b] = v));
      const time = (word >> TIME.lo) & 3;
      // a child: want from A by morning and day, B by evening and night; mood from A; nudge from B
      const half: 0 | 1 = programs.length === 1 ? 0 : time === 1 || time === 2 ? 0 : 1;
      const deciding = parts[half]!;
      const outA = parts[0]!.r.out;
      const outB = parts[programs.length - 1]!.r.out;
      frames.push({
        index,
        at: beats[index] === null || beats[index] === undefined ? null : beats[index]! * BEAT_MS,
        senses: decodeSenses(word),
        ...(io & 7
          ? { want: io & 7, mood: (io >> 3) & 3, nudge: (io >> 5) & 7, rule: -1, outside: true as const }
          : { want: deciding.r.out & 7, mood: (outA >> 3) & 3, nudge: (outB >> 5) & 7, rule: deciding.r.rule }),
        ...(programs.length === 2 ? { half } : {}),
        program: programs[half]!,
        memory: before,
      });
    }
  }
  return frames;
}

/** The moments worth jumping to: anything the owner did, anything that happened, and every change of mind. */
export function momentsOf(frames: readonly Frame[]): number[] {
  const out: number[] = [];
  for (let k = 0; k < frames.length; k++) {
    const f = frames[k]!;
    const prev = frames[k - 1];
    if (f.senses.action !== ACTION.none || f.senses.event !== EVENT.none || !prev || prev.want !== f.want) out.push(k);
  }
  return out;
}

export type MomentKey = keyof typeof WANT;
const WANT_KEY = Object.fromEntries(Object.entries(WANT).map(([k, v]) => [v, k])) as Record<number, MomentKey>;

/** The pet's own line about a moment, in its voice: its strongest habit's when it has one (G9). */
export function momentText(f: Frame, lang: "en" | "zh", habit: Trait | null = null): string {
  const key = WANT_KEY[f.want] ?? "idle";
  if (habit) return HABIT_LINES[habit][key][lang];
  const en: Record<MomentKey, string> = {
    idle: "I just sat and thought for a bit.",
    eat: "I wanted something to eat.",
    play: "I wanted to play!",
    sleep: "I wanted to sleep.",
    explore: "I went off to look around.",
    sulk: "I sulked.",
    cuddle: "I came over for a cuddle.",
    share: "I wanted to share with a friend.",
  };
  const zh: Record<MomentKey, string> = {
    idle: "我坐着想了一会儿。",
    eat: "我想吃点东西。",
    play: "我想玩！",
    sleep: "我想睡觉。",
    explore: "我出去看看。",
    sulk: "我闹别扭了。",
    cuddle: "我过来撒娇。",
    share: "我想和朋友分享。",
  };
  return (lang === "zh" ? zh : en)[key];
}

/**
 * A moment told for the diary and the away story (G1): one a taught lesson decided is told as the lesson's doing, so
 * the player reads what their teaching made the pet do; any other is the pet's own line.
 */
export function tellMoment(f: Frame, lang: "en" | "zh", habit: Trait | null = null): string {
  const line = momentText(f, lang, habit);
  if (ruleSource(f) !== "taught") return line;
  // every line is the pet speaking ("I ..."), so it follows the clause as it stands
  return lang === "zh" ? `因为你教过我，${line}` : `Because you taught me, ${line}`;
}

/**
 * What the pet chose today (G9): each change of mind since `fromMs` in its replayed log, by kind, and how many a
 * taught lesson made. The same replay the Rewind shows, so it is the circuit's own record.
 */
export function dayChoices(frames: readonly Frame[], fromMs: number): DayChoices {
  const counts: Partial<Record<MomentKey, number>> = {};
  let taught = 0;
  let total = 0;
  for (let k = 0; k < frames.length; k++) {
    const f = frames[k]!;
    if (f.at === null || f.at < fromMs) continue;
    const prev = frames[k - 1];
    if (prev && prev.want === f.want) continue;
    const key = WANT_KEY[f.want] ?? "idle";
    counts[key] = (counts[key] ?? 0) + 1;
    total++;
    if (ruleSource(f) === "taught") taught++;
  }
  return { counts, taught, total };
}

const BORN = new Set(Object.values(STARTERS).flatMap((p) => p.rules.map((r) => JSON.stringify([r.when, r.then]))));

/** Where the rule that decided came from: something taught, an instinct, what its egg line is born with, or nothing matched. */
export function ruleSource(f: Pick<Frame, "rule" | "program"> & { outside?: true }): "taught" | "instinct" | "born" | "default" | "outside" {
  if (f.outside) return "outside";
  const r = f.rule >= 0 ? f.program.rules[f.rule] : undefined;
  if (!r) return "default";
  if (r.label?.startsWith("instinct: ")) return "instinct";
  return BORN.has(JSON.stringify([r.when, r.then])) ? "born" : "taught";
}

/**
 * Why a pet fought the way it did: each round's word replayed through the same
 * mind from the memory it entered the spar with, naming the rule that chose the
 * move. A child's day half leads the opening and middle, its night half the late
 * rounds (a spar never reaches night), exactly as the child circuit mixes them.
 */
export function rewindFight(mind: Mind, memory: readonly number[], words: readonly number[]): Array<{ rule: number; program: Program; want: number; half?: 0 | 1; outside?: true }> {
  const programs = "program" in mind ? [mind.program] : mind.halves;
  const sizes = programs.map(stateBits);
  const own = sizes.reduce((a, b) => a + b, 0);
  const inst = mind.outside ? instinctBrain(mind.outside) : null;
  const total = own + (inst?.nState ?? 0);
  let mem = memory.length === total ? memory.slice() : new Array(total).fill(0);
  return words.map((word) => {
    let io = 0;
    if (inst) {
      const st = Uint8Array.from(mem.slice(own));
      io = inst.fast.step(st, word);
      mem = [...mem.slice(0, own), ...st];
    }
    const parts = programs.map((p, k) => {
      const off = sizes.slice(0, k).reduce((a, b) => a + b, 0);
      return { off, r: runBeat(p, mem.slice(off, off + sizes[k]!), word) };
    });
    const next = mem.slice();
    for (const part of parts) part.r.state.forEach((v, b) => (next[part.off + b] = v));
    mem = next;
    const time = (word >> TIME.lo) & 3;
    const half: 0 | 1 = programs.length === 1 ? 0 : time === 1 || time === 2 ? 0 : 1;
    const d = parts[half]!;
    if (io & 7) return { rule: -1, program: programs[half]!, want: io & 7, outside: true as const, ...(programs.length === 2 ? { half } : {}) };
    return { rule: d.r.rule, program: programs[half]!, want: d.r.out & 7, ...(programs.length === 2 ? { half } : {}) };
  });
}
