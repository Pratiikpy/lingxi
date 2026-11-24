import { describe, expect, it } from "vitest";
import { STARTERS, compileProgram, toVerilog } from "../src/index";

describe("Verilog export", () => {
  it("has one NAND per gate, one next-state per latch, eight outputs and both modules", () => {
    const net = compileProgram(STARTERS.gentle);
    const v = toVerilog(net, "lingxi_gentle");
    expect(v.match(/^ {2}wire g\d+ = ~\(/gm)).toHaveLength(net.gates.length);
    expect(v.match(/^ {2}assign next\[\d+\]/gm)).toHaveLength(net.latches.length);
    expect(v.match(/^ {2}assign out\[\d+\]/gm)).toHaveLength(8);
    expect(v).toContain("module lingxi_gentle_step (");
    expect(v).toContain("module lingxi_gentle (");
    expect(v).toContain("always @(posedge clk) mem <= reset ? 8'b0 : next;");
  });

  it("a stateless circuit gets no memory, and unsafe module names are replaced", () => {
    const net = compileProgram({
      ...STARTERS.bold,
      memory: [],
      rules: STARTERS.bold.rules.filter(
        (r) => !Object.keys(r.when).some((k) => ["trust", "likesToys", "scared", "awake"].includes(k)),
      ),
    });
    const v = toVerilog(net, "bad name; drop table");
    expect(v).toContain("module lingxi_brain_step (");
    if (net.latches.length === 0) expect(v).not.toContain("reg ");
  });
});
