import { describe, expect, it } from "vitest";
import { compileSeal, sealReference, sealWord } from "../src/seal";
import { gateCount, netlistBytes } from "../src/compile";
import { beat, bitsToWord, load, wordToBits } from "../src/tap02";

describe("LX-SEAL/1", () => {
  const net = compileSeal();
  const c = load(netlistBytes(net), 16, 8);

  it("is stateless, small, and gives the reference answer on every one of 65,536 inputs", () => {
    expect(net.latches.length).toBe(0);
    expect(gateCount(net)).toBeLessThan(400);
    for (let w = 0; w < 65536; w++) {
      const [, out] = beat(c, [], wordToBits(w, 16));
      expect(Number(bitsToWord(out))).toBe(sealReference(w));
    }
  });

  it("allows only inside the window, and only pet owners when asked", () => {
    const base = { index: 0, seed: 0x5a, open: true, member: false, lucky: false, petOwnersOnly: false };
    expect(sealReference(sealWord(base)) & 1).toBe(1);
    expect(sealReference(sealWord({ ...base, open: false })) & 1).toBe(0);
    expect(sealReference(sealWord({ ...base, petOwnersOnly: true })) & 1).toBe(0);
    expect(sealReference(sealWord({ ...base, petOwnersOnly: true, member: true })) & 1).toBe(1);
  });

  it("even splits weigh 8; lucky weights stay in 1..15 and average near 8.5", () => {
    expect((sealReference(sealWord({ index: 3, seed: 200, open: true, member: true, lucky: false, petOwnersOnly: false })) >> 1) & 15).toBe(8);
    let sum = 0;
    for (let s = 0; s < 256; s++) {
      const w = (sealReference(sealWord({ index: 0, seed: s, open: true, member: true, lucky: true, petOwnersOnly: false })) >> 1) & 15;
      expect(w).toBeGreaterThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(15);
      sum += w;
    }
    expect(sum / 256).toBeGreaterThan(8);
    expect(sum / 256).toBeLessThan(9);
  });
});

describe("LX-SEAL/1 eligibility", () => {
  it("whether a claim is allowed never depends on the luck seed", () => {
    for (let w = 0; w < 65536; w += 1) {
      const noSeed = w & ~(0xff << 4);
      expect(sealReference(w) & 1).toBe(sealReference(noSeed) & 1);
    }
  });
});
