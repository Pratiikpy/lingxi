/** Renders a review sheet of the pets to out/*.png at a whole-number scale. */
import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { EXPRESSIONS } from "../src/faces";
import { CORAL, SHELL } from "../src/palettes";
import { type PixelCanvas, type Palette, hexToRgba, toRgba } from "../src/pixel";
import { SIZE, drawEgg, drawPet } from "../src/pets";

const SCALE = 5;
const PAD = 8;
const BG = hexToRgba("#FFF7E8");

function sheet(cells: Array<{ c: PixelCanvas; pal: Palette }>, cols: number, file: string) {
  const rows = Math.ceil(cells.length / cols);
  const cw = SIZE * SCALE + PAD * 2;
  const png = new PNG({ width: cols * cw, height: rows * cw });
  for (let i = 0; i < png.data.length; i += 4) png.data.set(BG, i);
  cells.forEach(({ c, pal }, k) => {
    const rgba = toRgba(c, pal, SCALE);
    const ox = (k % cols) * cw + PAD;
    const oy = Math.floor(k / cols) * cw + PAD;
    const W = SIZE * SCALE;
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const s = (y * W + x) * 4;
        const a = rgba[s + 3]! / 255;
        if (a === 0) continue;
        const d = ((oy + y) * png.width + ox + x) * 4;
        for (let ch = 0; ch < 3; ch++) png.data[d + ch] = Math.round(rgba[s + ch]! * a + png.data[d + ch]! * (1 - a));
      }
  });
  writeFileSync(new URL(`../out/${file}`, import.meta.url), PNG.sync.write(png));
}

sheet(
  [
    { c: drawEgg("coral"), pal: { ...SHELL, x: CORAL.m, X: CORAL.d } },
    { c: drawPet("gentle", "baby"), pal: CORAL },
    { c: drawPet("gentle", "child", { expression: "happy" }), pal: CORAL },
    { c: drawPet("gentle", "teen", { lit: true }), pal: CORAL },
    { c: drawPet("gentle", "adult", { lit: true, expression: "happy" }), pal: CORAL },
  ],
  5,
  "mochi-stages.png",
);
sheet(
  EXPRESSIONS.map((e) => ({ c: drawPet("gentle", "adult", { expression: e }), pal: CORAL })),
  8,
  "mochi-faces-adult.png",
);
sheet(
  EXPRESSIONS.map((e) => ({ c: drawPet("gentle", "child", { expression: e }), pal: CORAL })),
  8,
  "mochi-faces-child.png",
);
console.log("sheets written");
