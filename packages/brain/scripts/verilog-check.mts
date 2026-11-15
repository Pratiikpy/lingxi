/**
 * Checks the Verilog export against Lingxi's own evaluator with Yosys: every
 * starter brain's step module is evaluated on random pins and memory, and each
 * answer (outputs and next memory) must equal the evaluator's.
 *
 *   YOSYS=<path to yosys or yowasp-yosys> tsx scripts/verilog-check.mts [--vectors 200]
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STARTERS, compileProgram, fastBrain, toVerilog } from "../src/index";

const yosys = process.env.YOSYS;
if (!yosys) throw new Error("set YOSYS to a yosys (or yowasp-yosys) executable");
const vectors = Number(process.argv[process.argv.indexOf("--vectors") + 1] || 200);
let failed = 0;
for (const [line, program] of Object.entries(STARTERS)) {
  const dir = mkdtempSync(join(tmpdir(), "lingxi-v-"));
  const net = compileProgram(program);
  const name = `lingxi_${line}`;
  writeFileSync(join(dir, "brain.v"), toVerilog(net, name));
  const S = net.latches.length;
  const fast = fastBrain(net);
  let seed = 0x9e3779b9 ^ line.length;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
  let script = `read_verilog brain.v\nhierarchy -top ${name}_step\nproc\nflatten\n`;
  const expected: Array<[number, number]> = [];
  for (let k = 0; k < vectors; k++) {
    const pins = rnd() & 0xffff;
    const mem = rnd() & ((1 << S) - 1);
    const st = Uint8Array.from({ length: S }, (_, b) => (mem >> b) & 1);
    const out = fast.step(st, pins);
    expected.push([out, st.reduce((v, x, b) => v | (x << b), 0)]);
    script += `eval -set pins ${pins} -set mem ${mem} -show out -show next\n`;
  }
  writeFileSync(join(dir, "check.ys"), script);
  const log = execFileSync(yosys, ["-s", "check.ys"], { cwd: dir, encoding: "utf8", maxBuffer: 64 << 20 });
  const vals = [...log.matchAll(/Eval result: \\(out|next) = \d+'([01]+)\./g)].map((m) => Number.parseInt(m[2]!, 2));
  let same = 0;
  for (let k = 0; k < vectors; k++) if (vals[2 * k] === expected[k]![0] && vals[2 * k + 1] === expected[k]![1]) same++;
  console.log(`${line}: ${same} of ${vectors} match (${net.gates.length} gates, ${S} latches)`);
  if (same !== vectors) failed++;
}
if (failed) process.exit(1);
console.log("Verilog export agrees with the evaluator on every vector.");
