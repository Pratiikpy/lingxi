import { describe, expect, it } from "vitest";
import { MAX_CODE_LENGTH, decodeProgram, encodeProgram } from "../src/codec";
import { compileProgram } from "../src/compile";
import { fastBrain } from "../src/fast";
import { stateBits } from "../src/program";
import { STARTERS } from "../src/starters";
import { layout, traceBeat } from "../src/trace";

describe("brain links", () => {
  it("round-trips every starter, labels included", () => {
    for (const p of Object.values(STARTERS)) {
      const code = encodeProgram(p);
      expect(code.startsWith("lx1.")).toBe(true);
      expect(code.length).toBeLessThan(MAX_CODE_LENGTH);
      expect(decodeProgram(code)).toEqual(p);
    }
  });
  it("rejects damaged, foreign, oversized and hostile links", () => {
    expect(() => decodeProgram("p1.AAAA")).toThrow(/not a Lingxi/);
    expect(() => decodeProgram("lx1.!!!")).toThrow(/base64url/);
    expect(() => decodeProgram("lx1.e30")).toThrow(/version/); // "{}"
    expect(() => decodeProgram(`lx1.${"A".repeat(MAX_CODE_LENGTH)}`)).toThrow(/too long/);
    // a raw "__proto__" key survives JSON.parse as an own property and must be refused
    const raw =
      '{"version":"LX-PET/1","memory":[],"rules":[{"when":{"__proto__":[1]},"then":{"want":1,"mood":1}}],"otherwise":{"want":0,"mood":0}}';
    const evil = btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(() => decodeProgram(`lx1.${evil}`)).toThrow(/unknown field/);
  });
});

describe("visible brain", () => {
  it("a traced beat equals the fast evaluator, and every gate has a column", () => {
    const p = STARTERS.gentle;
    const net = compileProgram(p);
    const f = fastBrain(net);
    const st = new Uint8Array(stateBits(p));
    for (let w = 0; w < 65536; w += 97) {
      const before = Uint8Array.from(st);
      const t = traceBeat(net, before, w);
      const out = f.step(st, w);
      expect(t.out).toBe(out);
      expect(Array.from(t.nextState)).toEqual(Array.from(st));
    }
    const l = layout(net);
    const placed = l.columns.reduce((s, c) => s + c.length, 0);
    expect(placed).toBe(net.nIn + net.latches.length + net.gates.length);
  });
});
