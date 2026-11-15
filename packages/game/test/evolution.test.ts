import { describe, expect, it } from "vitest";
import { compileProgram, fastBrain, gateCount, runBeat } from "@lingxi/brain";
import { EVOLUTION, FORMS, evolve, evolutionWord } from "../src/evolution";

describe("evolution circuit", () => {
  it("is small, stateless, and equals its rules on all 65,536 words", () => {
    const net = compileProgram(EVOLUTION);
    expect(net.latches).toHaveLength(0);
    expect(gateCount(net)).toBeLessThan(200);
    const f = fastBrain(net);
    for (let w = 0; w < 65536; w++) {
      if (f.step(new Uint8Array(0), w) !== runBeat(EVOLUTION, [], w).out) throw new Error(`word ${w}`);
    }
  });
  it("gives the documented forms", () => {
    expect(evolve({ diet: 3, care: 1, trust: 0, lessons: 0, trait: 0 }).form).toBe("puff");
    expect(evolve({ diet: 1, care: 2, trust: 1, lessons: 0, trait: 6 }).form).toBe("blossom");
    expect(evolve({ diet: 2, care: 2, trust: 1, lessons: 1, trait: 3 }).form).toBe("dumpling");
    expect(evolve({ diet: 0, care: 2, trust: 1, lessons: 2, trait: 2 }).form).toBe("scholar");
    const rare = evolve({ diet: 0, care: 3, trust: 3, lessons: 3, trait: 4 });
    expect(rare.form).toBe("moonpetal");
    expect(rare.rare).toBe(true);
  });
  it("every form is reachable", () => {
    const seen = new Set<string>();
    for (let diet = 0; diet < 4; diet++)
      for (let care = 0; care < 4; care++)
        for (let trust = 0; trust < 4; trust++)
          for (let lessons = 0; lessons < 4; lessons++)
            for (let trait = 0; trait < 8; trait++) seen.add(evolve({ diet, care, trust, lessons, trait }).form);
    expect([...seen].sort()).toEqual([...FORMS].sort());
    expect(evolutionWord({ diet: 3, care: 0, trust: 0, lessons: 0, trait: 7 })).toBe(3 | (7 << 10));
  });
});
