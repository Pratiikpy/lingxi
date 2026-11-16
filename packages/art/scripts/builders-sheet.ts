/** A preview of the five Builders' Lane residents at 5×, to out/builders.png. */
import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { MARS, SILICON } from "../src/builders";
import { MINT, SKY, SUNNY } from "../src/palettes";
import { toRgba } from "../src/pixel";
import { drawPet } from "../src/pets";
import { type Outfit, paintOverlay, wearOverlay } from "../src/wear";

const S = 5;
const pets = [
  ["gentle", "adult", SILICON, { head: "b:lamps13" }],
  ["curious", "adult", SILICON, { head: "b:lamps5" }],
  ["bold", "child", SILICON, { head: "b:lamps10" }],
  ["gentle", "teen", MARS, { held: "b:telescope" }],
  ["curious", "teen", SKY, { held: "b:handheld" }],
  ["bold", "child", SUNNY, { head: "b:hardhat" }],
  ["gentle", "child", SUNNY, { head: "b:hardhat" }],
  ["curious", "child", MINT, { face: "b:snorkel", held: "b:notebook" }],
  ["gentle", "teen", MINT, { face: "b:snorkel", held: "b:notebook" }],
] as const;
const bgs = [[255, 247, 232], [35, 28, 61]];
const png = new PNG({ width: pets.length * 50 * S, height: 2 * 50 * S });
bgs.forEach((bg, r) => {
  for (let y = r * 50 * S; y < (r + 1) * 50 * S; y++) for (let x = 0; x < png.width; x++) png.data.set([...bg, 255], (y * png.width + x) * 4);
  pets.forEach(([line, stage, pal, o], k) => {
    const c = drawPet(line, stage, { expression: r ? "neutral" : "happy", lit: true });
    const rgba = toRgba(c, pal, 1);
    paintOverlay(rgba, c.w, wearOverlay(c, line, stage, o as Outfit, 0));
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      const s = (y * c.w + x) * 4;
      const a = rgba[s + 3]! / 255;
      if (!a) continue;
      for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
        const d = (((r * 50 + y) * S + dy) * png.width + (k * 50 + x) * S + dx) * 4;
        for (let ch = 0; ch < 3; ch++) png.data[d + ch] = Math.round(rgba[s + ch]! * a + png.data[d + ch]! * (1 - a));
      }
    }
  });
});
writeFileSync(new URL("../out/builders.png", import.meta.url), PNG.sync.write(png));
console.log("wrote", png.width, png.height);
