/** Writes contracts/test/fixtures/designs.json: designs encoded here, so the contract test can check it accepts every one. */
import { writeFileSync } from "node:fs";
import { encodeDesign, type Design } from "../src/designs";

let s = 12345;
const rnd = (n: number) => (s = (s * 1103515245 + 12345) >>> 0) % n;
const out: string[] = [];
for (let i = 0; i < 40; i++) {
  const slot = (["head", "face", "held"] as const)[i % 3]!;
  const w = 1 + rnd(slot === "face" ? 10 : 13);
  const h = 1 + rnd(10);
  const n = 1 + rnd(3);
  const cells = Array.from({ length: h }, () => Array.from({ length: w }, () => rnd(n + 1)));
  cells[0]![0] = 1;
  cells[h - 1]![w - 1] = n;
  const d: Design = {
    slot,
    cells,
    colours: Array.from({ length: n }, () => `#${rnd(0xffffff).toString(16).padStart(6, "0")}`),
  };
  out.push("0x" + Array.from(encodeDesign(d), (b) => b.toString(16).padStart(2, "0")).join(""));
}
writeFileSync(
  new URL("../../../contracts/test/fixtures/designs.json", import.meta.url),
  JSON.stringify({ designs: out }, null, 1),
);
console.log("wrote", out.length);
