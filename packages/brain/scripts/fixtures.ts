/** Writes the starter brains and reference beats for the Solidity tests. */
import { writeFileSync } from "node:fs";
import { bytesToHex } from "../src/tap02";
import { compileProgram, gateCount, netlistBytes } from "../src/compile";
import { fastBrain } from "../src/fast";
import { stateBits } from "../src/program";
import { STARTERS } from "../src/starters";

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const out: Record<string, unknown> = {};
for (const [name, p] of Object.entries(STARTERS)) {
  const net = compileProgram(p);
  const f = fastBrain(net);
  const n = stateBits(p);
  const beats: { state: string; inputs: string; next: string; out: string }[] = [];
  for (let i = 0; i < 48; i++) {
    let s = 0n;
    const st = new Uint8Array(n);
    for (let b = 0; b < n; b++) if (rnd() < 0.5) { st[b] = 1; s |= 1n << BigInt(b); }
    const w = Math.floor(rnd() * 65536);
    const o = f.step(st, w);
    let ns = 0n;
    for (let b = 0; b < n; b++) if (st[b]) ns |= 1n << BigInt(b);
    beats.push({ state: s.toString(), inputs: w.toString(), next: ns.toString(), out: o.toString() });
  }
  out[name] = { netlist: bytesToHex(netlistBytes(net)), nState: n, gates: gateCount(net), beats };
}
writeFileSync(new URL("../../../contracts/test/fixtures/starters.json", import.meta.url), JSON.stringify(out, null, 1));
console.log("wrote", Object.keys(out).join(", "));
