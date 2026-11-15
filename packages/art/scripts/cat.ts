import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { CAT, CAT_H, CAT_POSES, CAT_W, drawCat } from "../src/residents";
import { hexToRgba, toRgba } from "../src/pixel";
const S = 10, pad = 2;
const png = new PNG({ width: CAT_POSES.length * (CAT_W + pad) * S, height: CAT_H * S });
const bg = hexToRgba("#FFE9D6");
for (let i = 0; i < png.data.length; i += 4) { png.data.set(bg, i); }
CAT_POSES.forEach((p, k) => {
  const rgba = toRgba(drawCat(p), CAT, S); const W = CAT_W * S;
  for (let y = 0; y < CAT_H * S; y++) for (let x = 0; x < W; x++) { const s = (y * W + x) * 4, a = rgba[s + 3]! / 255; if (!a) continue; const d = (y * png.width + k * (CAT_W + pad) * S + x) * 4; for (let ch = 0; ch < 3; ch++) png.data[d + ch] = Math.round(rgba[s + ch]! * a + png.data[d + ch]! * (1 - a)); }
});
writeFileSync(new URL("../out/cat.png", import.meta.url), PNG.sync.write(png));
