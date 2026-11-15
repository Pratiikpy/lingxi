/** Writes the starter brains and reference beats for the Solidity tests. */
import { writeFileSync } from "node:fs";
import { bytesToHex } from "../src/tap02";
import { compileProgram, gateCount, netlistBytes } from "../src/compile";
import { fastBrain } from "../src/fast";
import { stateBits } from "../src/program";
import { STARTERS } from "../src/starters";
import { composeChild } from "../src/compose";
import { compileSeal, sealReference } from "../src/seal";

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
const child = composeChild({ cpu: "0x" + "11".repeat(20), id: 1n }, { cpu: "0x" + "22".repeat(20), id: 2n });
out.glue = bytesToHex(child.bytes.slice(158));
const seal = compileSeal();
out.seal = { netlist: bytesToHex(netlistBytes(seal)), gates: gateCount(seal), probe: [0, 4096, 0x5a5a, 0xffff, 0x7123, 0xb000].map((w) => ({ word: w, out: sealReference(w) })) };
writeFileSync(new URL("../../../contracts/test/fixtures/starters.json", import.meta.url), JSON.stringify(out, null, 1));
console.log("wrote", Object.keys(out).join(", "));
