/** Builds the art-sample page for Prateek's approval: every frame as one atlas. */
import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { EXPRESSIONS } from "../src/faces";
import { CORAL, SHELL } from "../src/palettes";
import { type PixelCanvas, type Palette, toRgba } from "../src/pixel";
import { SIZE, drawEgg, drawPet } from "../src/pets";

const frames: Array<{ id: string; c: PixelCanvas; pal: Palette }> = [];
const eggPal = { ...SHELL, x: CORAL.m, X: CORAL.d };
for (const w of [0, -1, 0, 1] as const) frames.push({ id: `egg-w${w}`, c: drawEgg("coral", w), pal: eggPal });
for (let k = 0; k < 4; k++) frames.push({ id: `egg-crack${k}`, c: drawEgg("coral", 0, k), pal: eggPal });
for (const st of ["baby", "child", "teen", "adult"] as const) {
  frames.push({ id: `${st}-b0`, c: drawPet("gentle", st), pal: CORAL });
  frames.push({ id: `${st}-b1`, c: drawPet("gentle", st, { breath: 1 }), pal: CORAL });
  frames.push({ id: `${st}-blink`, c: drawPet("gentle", st, { expression: "asleep" }), pal: CORAL });
  frames.push({ id: `${st}-hop`, c: drawPet("gentle", st, { squash: 1, expression: "happy", lit: true }), pal: CORAL });
  frames.push({ id: `${st}-land`, c: drawPet("gentle", st, { squash: -1, expression: "happy", lit: true }), pal: CORAL });
  for (const e of EXPRESSIONS) frames.push({ id: `${st}-${e}`, c: drawPet("gentle", st, { expression: e, lit: e === "sparkly" || e === "proud" || e === "happy" }), pal: CORAL });
}
const cols = 16;
const rows = Math.ceil(frames.length / cols);
const png = new PNG({ width: cols * SIZE, height: rows * SIZE });
png.data.fill(0);
const index: Record<string, [number, number]> = {};
frames.forEach((f, k) => {
  const ox = (k % cols) * SIZE, oy = Math.floor(k / cols) * SIZE;
  index[f.id] = [ox, oy];
  const rgba = toRgba(f.c, f.pal, 1);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const s = (y * SIZE + x) * 4, d = ((oy + y) * png.width + ox + x) * 4;
    for (let ch = 0; ch < 4; ch++) png.data[d + ch] = rgba[s + ch]!;
  }
});
const b64 = PNG.sync.write(png).toString("base64");
writeFileSync(new URL("../out/sample-atlas.json", import.meta.url), JSON.stringify({ size: SIZE, index, png: b64, expressions: EXPRESSIONS }));
writeFileSync(new URL("../out/sample-atlas.png", import.meta.url), PNG.sync.write(png));
console.log(frames.length, "frames", b64.length, "b64 chars");
