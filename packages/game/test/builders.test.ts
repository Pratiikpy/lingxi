import { describe, expect, it } from "vitest";
import { keccak256 } from "viem";
import { type Rule, STARTERS, compileProgram, gateCount } from "@lingxi/brain";
import { BEHEMOTH_NETLIST, BEHEMOTH_NETLIST_KECCAK, BEHEMOTH_PINS, BUILDER_PETS, FIBONACCI, behemothAt, behemothCircuit, behemothFighter, behemothMoment, behemothTape, daysSinceBehemoth, laneParty, tapboyDay } from "../src/builders";
import { LESSON_CAPACITY, MAX_GATES, composeProgram } from "../src/lessons";
import { PARTNERS } from "../src/partners";
import { coach, fighterFrom, fighterOfMind } from "../src/coach";
const partnerFighter = (p: (typeof PARTNERS)[number]) => fighterFrom(p.name.en, p.program, p.level);
import type { Fighter } from "../src/spar";
import { CURRENT_SPAR, fight } from "../src/spar2";
/** the fight the game fights today */
const spar = (a: Fighter, b: Fighter, seed: number) => fight(CURRENT_SPAR, a, b, seed);

describe("Behemoth, the founder's CPU", () => {
  it("is the circuit saved from BNB Chain, unchanged", () => {
    expect(keccak256(BEHEMOTH_NETLIST as `0x${string}`)).toBe(BEHEMOTH_NETLIST_KECCAK);
    const c = behemothCircuit();
    expect([c.nIn, c.nOut, c.nState, c.nGates]).toEqual([0, 47, 47, BEHEMOTH_PINS.gates]);
  });

  it("computes Fibonacci in its accumulator, then repeats forever", () => {
    const { frames, loopFrom } = behemothTape();
    const firsts: number[] = [];
    for (const f of frames) if (f.acc === FIBONACCI[firsts.length]) firsts.push(f.acc);
    expect(firsts).toEqual([1, 2, 3, 5, 8, 13]);
    const period = frames.length - loopFrom;
    expect(period).toBeGreaterThan(50);
    // far in the future it is on the same frame as one period earlier
    expect(behemothAt(loopFrom + 7 + period * 1000).acc).toBe(behemothAt(loopFrom + 7).acc);
    expect(behemothAt(10_000_000).outputs).toEqual(behemothAt(10_000_000 + period).outputs);
  });

  it("names its moments: boot, counting up, the peak at 13, then overflow", () => {
    const { frames } = behemothTape();
    const kinds = frames.map((_, k) => behemothMoment(k).kind);
    expect(kinds[0]).toBe("boot");
    const order = kinds.filter((k, i) => k !== kinds[i - 1]);
    expect(order.slice(0, 4)).toEqual(["boot", "count", "peak", "overflow"]);
    const counts = frames.map((_, k) => behemothMoment(k)).flatMap((m) => (m.kind === "count" ? [m.n] : []));
    expect([...new Set(counts)]).toEqual([1, 2, 3, 5, 8]);
  });

  it("fights the same fight every time, and can be beaten", () => {
    const a = spar(partnerFighter(PARTNERS[1]!), behemothFighter("Behemoth"), 7);
    const b = spar(partnerFighter(PARTNERS[1]!), behemothFighter("Behemoth"), 7);
    expect(a.digest).toBe(b.digest);
    const moves = a.rounds.map((r) => r.moves[1]);
    expect(new Set(moves).size).toBeGreaterThan(2);
    // a hard partner, not an unbeatable one: starters mostly lose, and a pet the coach teaches to read it wins
    // (its moves are a fixed sequence, so a pet can learn it; G2's coach suggests only what wins on fresh seeds too)
    const rate = (f: () => ReturnType<typeof partnerFighter>) => Array.from({ length: 20 }, (_, s) => spar(f(), behemothFighter("Behemoth"), s * 31 + 5).winner === 0).filter(Boolean).length;
    for (const line of ["gentle", "bold", "curious"] as const) expect(rate(() => fighterFrom("starter", STARTERS[line], 0)), line).toBeLessThan(8);
    const coached = (["gentle", "bold", "curious"] as const).map((line) => {
      const lessons: Rule[] = [];
      for (let k = 0; k < LESSON_CAPACITY.adult; k++) {
        let note: ReturnType<typeof coach> | null = null;
        for (let s = 0; s < 6 && !note?.lesson; s++) {
          const r = spar(fighterOfMind("me", { line, lessons }, 1), behemothFighter("Behemoth"), 1000 + s);
          if (r.winner !== 0) note = coach({ result: r, side: 0, line, stage: "adult", lessons, level: 1, opponent: behemothFighter("Behemoth") });
        }
        if (!note?.lesson) break;
        lessons.unshift(note.lesson.rule);
      }
      return rate(() => fighterOfMind("me", { line, lessons }, 1));
    });
    expect(Math.max(...coached)).toBeGreaterThanOrEqual(15);
    // thousands of practice spars: the coach fights 96 per lesson, lesson after lesson
  }, 120_000);
});

describe("the residents of Builders' Lane", () => {
  it("each has its own room, lines in both languages, and a mind that fits a pet's brain", () => {
    expect(new Set(BUILDER_PETS.map((b) => b.room)).size).toBe(BUILDER_PETS.length);
    for (const b of BUILDER_PETS) {
      expect(b.lines.length).toBeGreaterThanOrEqual(3);
      for (const l of [...b.lines, b.about, b.name, b.tribute.as]) expect(l.en && l.zh).toBeTruthy();
      if (b.mind.kind === "pet") expect(gateCount(compileProgram(composeProgram(b.look.line, b.mind.lessons)))).toBeLessThanOrEqual(MAX_GATES);
    }
  });

  it("keeps the calendar: day 100 is 2026-11-23, and Tapboy's count moves a day at a time", () => {
    expect(daysSinceBehemoth(new Date(2026, 10, 23, 9))).toBe(100);
    expect(laneParty(new Date(2026, 10, 23, 23))).toBe(100);
    expect(laneParty(new Date(2026, 10, 22))).toBeNull();
    expect(laneParty(new Date(2027, 2, 3))).toBe(200);
    expect(tapboyDay(new Date(2026, 10, 15))).toBe(91);
    expect(tapboyDay(new Date(2026, 10, 18))).toBe(94);
  });
});
