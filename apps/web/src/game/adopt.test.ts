import { describe, expect, it } from "vitest";
import { REF, compileFlyProgram, compileProgram, encode, flyCircuitBytes, programOfChips, toElements } from "@lingxi/brain";
import type { CircuitPart } from "@lingxi/chain";
import { PARTNERS, composeProgram, fighterFrom, fighterOfPartner, flyFighter, spar } from "@lingxi/game";
import { fighterOf, profileOf } from "./adoptBrain";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const CPU = "0x00000000000000000000000000000000000000aa";
const pip = fighterOfPartner(PARTNERS.find((p) => p.id === "pip")!);
const fight = (me: ReturnType<typeof fighterFrom>) => [1, 2, 3, 4, 5].map((s) => spar(me, pip, s).digest);

describe("adopted outside brains", () => {
  it("only fight-shaped circuits are accepted", () => {
    expect(profileOf(12, 3)).toBe("DUEL-12x3/1");
    expect(profileOf(16, 8)).toBe("PET-16x8/1");
    expect(profileOf(16, 4)).toBeNull();
  });

  it("a pet-format circuit read as bytes fights exactly as the program it was compiled from", () => {
    const program = composeProgram("bold", [{ when: { event: [2] }, then: { want: 2, mood: 3 } }]);
    const parts: CircuitPart[] = [{ processor: CPU, id: "7", nIn: 16, nOut: 8, hex: hex(encode(toElements(compileProgram(program)))) }];
    expect(fight(fighterOf({ source: { kind: "chain", processor: CPU, id: "7", parts }, profile: "PET-16x8/1" }, "Mochi", 1))).toEqual(fight(fighterFrom("Mochi", program, 1)));
  });

  it("a TapeFly brain on chain fights exactly as the same brain from a brawl link", () => {
    const program = programOfChips(["punish", "block", "bite"]);
    const parts: CircuitPart[] = [{ processor: CPU, id: "9", nIn: 12, nOut: 3, hex: hex(flyCircuitBytes(compileFlyProgram(program))) }];
    const fromChain = fighterOf({ source: { kind: "chain", processor: CPU, id: "9", parts }, profile: "DUEL-12x3/1" }, "Mochi", 1);
    expect(fight(fromChain)).toEqual(fight(flyFighter("Mochi", program, 1)));
  });

  it("a circuit that REFs another is followed through the parts kept with it", () => {
    const inner = compileProgram(composeProgram("gentle", []));
    const ins = Array.from({ length: 16 }, (_, i) => 2 + i);
    const wrapper = encode([{ op: REF, cpu: CPU, id: 1n, ins, nOut: 8, firstOut: 18 } as never]);
    const parts: CircuitPart[] = [
      { processor: CPU, id: "2", nIn: 16, nOut: 8, hex: hex(wrapper) },
      { processor: CPU, id: "1", nIn: 16, nOut: 8, hex: hex(encode(toElements(inner))) },
    ];
    const viaRef = fighterOf({ source: { kind: "chain", processor: CPU, id: "2", parts }, profile: "PET-16x8/1" }, "Mochi", 1);
    expect(fight(viaRef)).toEqual(fight(fighterFrom("Mochi", composeProgram("gentle", []), 1)));
    // without the part it REFs, it does not load
    expect(() => fighterOf({ source: { kind: "chain", processor: CPU, id: "2", parts: parts.slice(0, 1) }, profile: "PET-16x8/1" }, "x", 1)).toThrow();
  });
});
