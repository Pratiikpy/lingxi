/** B5: a newly hatched pet thinks once at hatch, so the room, the strip and the circuit show a real decision at once. */
import { describe, expect, it } from "vitest";
import { STARTERS, compileProgram, traceBeat } from "@lingxi/brain";
import { composeProgram, createPet, firstThought, mindBrain } from "../src";

const T0 = Date.UTC(2026, 10, 22, 9, 30);

describe("a new pet's first thought (B5)", () => {
  for (const line of Object.keys(STARTERS) as (keyof typeof STARTERS)[]) {
    it(`${line}: decides on its real senses, and the circuit traced on that word says the same`, () => {
      const brain = mindBrain({ line, lessons: [] });
      const born = createPet({ name: "Kiri", line, now: T0, tzOffsetMin: 0, brain });
      const p = firstThought(born, T0, brain);
      expect(p.last.word, "a real input word, not the blank record").not.toBe(0);
      const net = compileProgram(composeProgram(line, []));
      const out = traceBeat(net, p.last.before!.slice(0, net.latches.length), p.last.word).out;
      expect(out & 7).toBe(p.last.want);
      expect((out >> 3) & 3).toBe(p.last.mood);
      // nothing logged, memory unchanged
      expect(p.pendingLog).toEqual(born.pendingLog);
      expect(p.logHash).toBe(born.logHash);
      expect(p.brain).toEqual(born.brain);
      expect(p.beat).toBe(born.beat);
    });
  }
});
