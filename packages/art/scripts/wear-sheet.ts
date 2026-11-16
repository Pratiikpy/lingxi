/** A preview of every line and stage (and the adult forms) wearing each outfit, at 4×, to out/wear.png. `--story` previews the quest keepsakes instead, to out/story.png. */
import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { CORAL, SKY, SUNNY } from "../src/palettes";
import { toRgba } from "../src/pixel";
import { FORMS, drawPet } from "../src/pets";
import { type Outfit, paintOverlay, wearOverlay } from "../src/wear";
import "../src/builders";

const S = 4;
const lines = [["gentle", CORAL], ["bold", SUNNY], ["curious", SKY]] as const;
const story = process.argv.includes("--story");
const outfits: Outfit[] = story
  ? [{ head: "charm", held: "net" }, { head: "ribbon", face: "goggles", held: "whistle" }, { head: "ranger", held: "seal" }, { head: "nurse" }, { head: "headband", held: "whistle" }, { head: "dream", face: "goggles", held: "net" }, { head: "b:hardhat", held: "b:telescope" }]
  : [{}, { head: "sunhat", face: "hearts", held: "balloon" }, { head: "beanie", held: "flag" }, { head: "crown", face: "shades", held: "lantern" }, { face: "glasses", held: "sunflower", head: "bow" }, { head: "laurel" }];
const rows: Array<[typeof lines[number], "baby" | "child" | "teen" | "adult", (typeof FORMS)[number]]> = [];
for (const l of lines) {
  for (const st of ["baby", "child", "teen", "adult"] as const) rows.push([l, st, "puff"]);
  for (const f of ["blossom", "dumpling", "scholar", "moonpetal"] as const) rows.push([l, "adult", f]);
}
const png = new PNG({ width: outfits.length * 50 * S, height: rows.length * 50 * S });
for (let i = 0; i < png.data.length; i += 4) png.data.set([255, 247, 232, 255], i);
rows.forEach(([[line, pal], stage, form], r) => {
  outfits.forEach((o, k) => {
    const c = drawPet(line, stage, { form, expression: "happy" });
    const rgba = toRgba(c, pal, 1);
    paintOverlay(rgba, c.w, wearOverlay(c, line, stage, o, 0, form));
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
const out = story ? "story.png" : "wear.png";
writeFileSync(new URL(`../out/${out}`, import.meta.url), PNG.sync.write(png));
console.log(`wrote out/${out}`, png.width, png.height);
