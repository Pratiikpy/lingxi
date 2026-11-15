import { compileProgram, cost, gateCount, netDepth, netlistBytes } from "../src/compile";
import { fastBrain } from "../src/fast";
import { STARTERS } from "../src/starters";
import { stateBits } from "../src/program";

// A day = one beat per minute (1,440) plus care events; we time 1,440 and 14,400.
for (const [name, p] of Object.entries(STARTERS)) {
  const net = compileProgram(p);
  const f = fastBrain(net);
  const st = new Uint8Array(stateBits(p));
  let w = 12345;
  const t0 = performance.now();
  for (let i = 0; i < 14_400; i++) { w = (w * 1103515245 + 12345) & 0xffff; f.step(st, w); }
  const ms = performance.now() - t0;
  console.log(`${name}: ${gateCount(net)} gates (${net.latches.length} latch), depth ${netDepth(net)}, cost ${cost(net)}, ${netlistBytes(net).length} bytes; 14,400 beats in ${ms.toFixed(2)} ms`);
}
