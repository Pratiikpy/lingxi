import { describe, expect, it } from "vitest";
import { DUEL_MANIFEST, MANIFESTS, PET_MANIFEST, decodeSenses, encodeSenses } from "../src";

describe("interface manifests", () => {
  it("cover every input and output bit exactly once, in order", () => {
    for (const m of MANIFESTS) {
      for (const [list, n] of [[m.inputs, m.nIn], [m.outputs, m.nOut]] as const) {
        const bits = list.flatMap((f) => Array.from({ length: f.bits }, (_, i) => f.lo + i));
        expect(bits).toEqual(Array.from({ length: n }, (_, i) => i));
        for (const f of list) expect(f.values.length).toBe(1 << f.bits);
      }
    }
  });

  it("the pet manifest reads a word exactly as the brain's own decoder does", () => {
    for (let w = 0; w < 65536; w += 97) {
      const s = decodeSenses(w) as unknown as Record<string, number>;
      for (const f of PET_MANIFEST.inputs) expect((w >> f.lo) & ((1 << f.bits) - 1)).toBe(s[f.name]);
    }
    expect(encodeSenses({ hunger: 3, joy: 0, energy: 0, clean: 0, time: 0, action: 0, event: 0, owner: 1 })).toBe(3 | (1 << 15));
  });

  it("the duel manifest names the profile TapeFly serves", () => {
    expect(DUEL_MANIFEST.id).toBe("DUEL-12x3/1");
    expect(DUEL_MANIFEST.inputs.map((f) => f.name)).toEqual(["dist", "foe", "myhp", "foehp", "energy", "prev"]);
  });
});
