/** Writes the garden's item sprites (24×24) into the web app, and a 6× preview sheet to out/. */
import { mkdirSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { COMPOST, PACKET, PEPPER, PLOT_COLORS, RICE, type Sprite24, plotRows } from "../src/garden";
import { hexToRgba } from "../src/pixel";

export const SEEDS: Record<string, [string, string]> = {
  apple: ["#E8C14A", "#C98A00"],
  rice: ["#FFE08A", "#E0A21F"],
  pepper: ["#E8604A", "#B24A45"],
  clover: ["#FF9FC0", "#E5486C"],
};

function png(s: Sprite24, scale = 1): PNG {
  const p = new PNG({ width: 24 * scale, height: 24 * scale });
  s.rows.forEach((row, y) => {
    for (let x = 0; x < 24; x++) {
      const ch = row[x]!;
      if (ch === ".") continue;
      const rgba = hexToRgba(s.colors[ch]!);
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) p.data.set(rgba, ((y * scale + dy) * p.width + x * scale + dx) * 4);
    }
  });
  return p;
}

const dir = new URL("../../../apps/web/public/art/items/garden/", import.meta.url);
mkdirSync(dir, { recursive: true });
const all: Array<[string, Sprite24]> = [
  ["compost", COMPOST],
  ["rice_sheaf", RICE],
  ["garden_pepper", PEPPER],
  ...Object.entries(SEEDS).map(([k, [c, C]]) => [`seed_${k}`, PACKET(c, C)] as [string, Sprite24]),
  ...([0, 1, 2, 3] as const).map(
    (st) => [`plot_${st}`, { rows: plotRows(st), colors: PLOT_COLORS("#E8604A", "#B24A45") }] as [string, Sprite24],
  ),
];
for (const [name, s] of all)
  if (!name.startsWith("plot")) writeFileSync(new URL(`${name}.png`, dir), PNG.sync.write(png(s)));
// preview
const S = 6;
const sheet = new PNG({ width: all.length * 26 * S, height: 26 * S });
for (let i = 0; i < sheet.data.length; i += 4) sheet.data.set([255, 247, 232, 255], i);
all.forEach(([, s], k) => {
  const p = png(s, S);
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const a = p.data[(y * p.width + x) * 4 + 3]!;
      if (!a) continue;
      const d = ((y + S) * sheet.width + k * 26 * S + S + x) * 4;
      for (let ch = 0; ch < 3; ch++)
        sheet.data[d + ch] = Math.round(
          (p.data[(y * p.width + x) * 4 + ch]! * a + sheet.data[d + ch]! * (255 - a)) / 255,
        );
    }
});
mkdirSync(new URL("../out/", import.meta.url), { recursive: true });
writeFileSync(new URL("../out/garden.png", import.meta.url), PNG.sync.write(sheet));
console.log("wrote", all.length - 4, "items and the preview");
