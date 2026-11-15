import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { CORAL } from "../src/palettes";
import { hexToRgba, toRgba } from "../src/pixel";
import { SIZE, drawPet, type Stage } from "../src/pets";
const stage = (process.argv[2] ?? "adult") as Exclude<Stage, "egg">;
const S = 12;
const c = drawPet("gentle", stage, { lit: true, expression: (process.argv[3] as never) ?? "neutral" });
const rgba = toRgba(c, CORAL, S);
const png = new PNG({ width: SIZE * S, height: SIZE * S });
const bg = hexToRgba("#FFF7E8");
for (let i = 0; i < png.data.length; i += 4) { const a = rgba[i + 3]! / 255; for (let k = 0; k < 3; k++) png.data[i + k] = Math.round(rgba[i + k]! * a + bg[k]! * (1 - a)); png.data[i + 3] = 255; }
// grid
for (let y = 0; y < SIZE * S; y++) for (let x = 0; x < SIZE * S; x++) if (x % S === 0 || y % S === 0) { const i = (y * SIZE * S + x) * 4; for (let k = 0; k < 3; k++) png.data[i + k] = Math.round(png.data[i + k]! * 0.92); }
writeFileSync(new URL(`../out/zoom-${stage}.png`, import.meta.url), PNG.sync.write(png));
