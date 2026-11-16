/** Writes the sprites the launch teaser uses (lingxi/video/public/sprites), one PNG per pose at 1×. */
import { mkdirSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { MARS, SILICON } from "../src/builders";
import { CORAL, MINT, SKY, SUNNY } from "../src/palettes";
import { type Palette, type PixelCanvas, toRgba } from "../src/pixel";
import { drawEgg, drawPet } from "../src/pets";
import { CAT, drawCat } from "../src/residents";
import { type Outfit, paintOverlay, wearOverlay } from "../src/wear";
import type { Expression } from "../src/faces";

const out = new URL("../../../video/public/sprites/", import.meta.url);
mkdirSync(out, { recursive: true });
const save = (name: string, c: PixelCanvas, pal: Palette, paint?: (rgba: Uint8ClampedArray) => void) => {
  const rgba = toRgba(c, pal, 1);
  paint?.(rgba);
  const png = new PNG({ width: c.w, height: c.h });
  png.data.set(rgba);
  writeFileSync(new URL(`${name}.png`, out), PNG.sync.write(png));
};
const pet = (name: string, line: "gentle" | "bold" | "curious", stage: "baby" | "child" | "teen" | "adult", pal: Palette, expression: Expression, o: { breath?: 0 | 1; squash?: -1 | 0 | 1; lit?: boolean; outfit?: Outfit } = {}) => {
  const c = drawPet(line, stage, { expression, breath: o.breath ?? 0, squash: o.squash ?? 0, lit: o.lit ?? false });
  save(name, c, pal, o.outfit ? (rgba) => paintOverlay(rgba, c.w, wearOverlay(c, line, stage, o.outfit!, o.squash ?? 0)) : undefined);
};

for (const w of [-1, 0, 1] as const) for (const k of [0, 1, 2, 3]) save(`egg_${w + 1}_${k}`, drawEgg("coral", w, k), CORAL);
for (const e of ["neutral", "happy", "sparkly", "munch", "munchShut", "sneeze", "love", "proud", "startled"] as const) {
  pet(`mochi_${e}`, "gentle", "baby", CORAL, e);
  pet(`mochi_${e}_lit`, "gentle", "baby", CORAL, e, { lit: true });
}
pet("mochi_happy_up", "gentle", "baby", CORAL, "happy", { squash: 1 });
pet("mochi_happy_down", "gentle", "baby", CORAL, "happy", { squash: -1 });
pet("mochi_love_up", "gentle", "baby", CORAL, "love", { squash: 1 });
pet("hoshi_happy", "bold", "child", SUNNY, "happy");
pet("sora_happy", "curious", "child", SKY, "happy");
for (const v of [0, 1, 2, 3, 5, 8, 13]) pet(`behemoth_${v}`, "gentle", "adult", SILICON, v === 13 ? "sparkly" : "happy", { lit: true, outfit: { head: `b:lamps${v}` } });
pet("mars", "bold", "adult", MARS, "happy", { outfit: { held: "b:telescope" } });
pet("tapboy", "curious", "teen", SKY, "happy", { outfit: { held: "b:handheld" } });
pet("hardhat", "bold", "child", SUNNY, "happy", { outfit: { head: "b:hardhat" } });
pet("diver", "curious", "child", MINT, "happy", { outfit: { face: "b:snorkel", held: "b:notebook" } });
for (const p of ["sit0", "sit1", "walk0", "walk1", "look"] as const) save(`cat_${p}`, drawCat(p), CAT);
console.log("sprites written to", out.pathname);
