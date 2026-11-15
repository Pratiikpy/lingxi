/** Renders every adult form on every line to out/forms.png for review. */
import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { CORAL, SKY, SUNNY } from "../src/palettes";
import { hexToRgba, toRgba } from "../src/pixel";
import { FORMS, SIZE, drawPet } from "../src/pets";

const SCALE = 5;
const PAD = 8;
const BG = hexToRgba("#FFF7E8");
const lines = [
  ["gentle", CORAL],
  ["bold", SUNNY],
  ["curious", SKY],
] as const;
const cw = SIZE * SCALE + PAD * 2;
const png = new PNG({ width: FORMS.length * cw, height: lines.length * cw });
for (let i = 0; i < png.data.length; i += 4) png.data.set(BG, i);
lines.forEach(([line, pal], r) =>
  FORMS.forEach((form, k) => {
    const rgba = toRgba(drawPet(line, "adult", { form, expression: "happy" }), pal, SCALE);
    const W = SIZE * SCALE;
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const s = (y * W + x) * 4;
        const al = rgba[s + 3]! / 255;
        if (al === 0) continue;
        const d = ((r * cw + PAD + y) * png.width + k * cw + PAD + x) * 4;
        for (let ch = 0; ch < 3; ch++) png.data[d + ch] = Math.round(rgba[s + ch]! * al + png.data[d + ch]! * (1 - al));
      }
  }),
);
writeFileSync(new URL("../out/forms.png", import.meta.url), PNG.sync.write(png));
console.log("forms written");
