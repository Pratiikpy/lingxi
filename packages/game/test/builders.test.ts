import { describe, expect, it } from "vitest";
import { keccak256 } from "viem";
import { STARTERS, compileProgram, gateCount } from "@lingxi/brain";
import { DESIGNED_PARTNERS } from "../src/designedPartners";
import { BEHEMOTH_NETLIST, BEHEMOTH_NETLIST_KECCAK, BEHEMOTH_PINS, BUILDER_PETS, FIBONACCI, behemothAt, behemothCircuit, behemothFighter, behemothMoment, behemothTape, daysSinceBehemoth, laneParty, tapboyDay } from "../src/builders";
import { MAX_GATES, composeProgram } from "../src/lessons";
import { PARTNERS } from "../src/partners";
import { fighterFrom } from "../src/coach";
const partnerFighter = (p: (typeof PARTNERS)[number]) => fighterFrom(p.name.en, p.program, p.level);
import { spar } from "../src/spar";

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
    // a hard partner, not an unbeatable one: starters mostly lose, a well-built brain wins
    const rate = (f: () => ReturnType<typeof partnerFighter>) => Array.from({ length: 20 }, (_, s) => spar(f(), behemothFighter("Behemoth"), s * 31 + 5).winner === 0).filter(Boolean).length;
    expect(rate(() => fighterFrom("starter", STARTERS.gentle, 0))).toBeLessThan(8);
    const best = Math.max(...DESIGNED_PARTNERS.map((p) => rate(() => partnerFighter(p))));
    expect(best).toBeGreaterThanOrEqual(15);
  });
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
