/**
 * `tsx scripts/display-cjk-font.mts <ark-pixel-12px-proportional-zh_hans.ttf.woff2>`: R29's pixel face for the Chinese
 * page titles. It cuts Ark Pixel Font 12px (TakWolf, SIL OFL 1.1, https://github.com/TakWolf/ark-pixel-font, the
 * release's 12px proportional zh_hans woff2) down to exactly the characters of the titles listed in
 * scripts/lib/displayCjk.mts, keeping the font's own names and copyright, checks the cut holds every one of them, and
 * writes the cut font and its @font-face (apps/web/src/styles/fonts/lingxi-pixel-cjk.woff2, display-cjk.css). Run it
 * again whenever a title in that list changes, then format the stylesheet with prettier. Needs Python with fontTools
 * (pip install fonttools brotli).
 */
import { spawnSync } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { displayCjkChars, unicodeRange } from "./lib/displayCjk.mts";

const source = process.argv[2];
if (!source || !existsSync(source) || !/ark-pixel-12px-proportional-zh_hans\.ttf\.woff2$/.test(basename(source)))
  throw new Error("give the path of Ark Pixel Font's ark-pixel-12px-proportional-zh_hans.ttf.woff2");

const styles = join(import.meta.dirname, "..", "apps", "web", "src", "styles");
const out = join(styles, "fonts", "lingxi-pixel-cjk.woff2");
const chars = displayCjkChars();
const text = chars.join("");

const python = (args: string[]) => {
  const r = spawnSync("python", args, { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  if (r.status !== 0) throw new Error(`python ${args[0]} failed:\n${r.stderr}`);
  return r.stdout;
};
python([
  "-m",
  "fontTools.subset",
  source,
  `--text=${text}`,
  "--flavor=woff2",
  `--output-file=${out}`,
  "--layout-features=*",
  "--name-IDs=*",
  "--name-languages=*",
  "--name-legacy",
]);
// the cut must draw every character it was cut for, or a title would be drawn in two faces
const missing = python([
  "-c",
  "import sys\nfrom fontTools.ttLib import TTFont\ncmap = TTFont(sys.argv[1]).getBestCmap()\nprint(''.join(c for c in sys.argv[2] if ord(c) not in cmap))",
  out,
  text,
]).trim();
if (missing) throw new Error(`Ark Pixel Font 12px has no glyph for ${missing}: those titles cannot be drawn in it`);

const range = unicodeRange(chars);
// Pixelify Sans's own vertical metrics (ascender 0.92, descender 0.28, no gap), given to both Chinese faces: a title's
// lines are then as tall in either as in Pixelify, and its Chinese is 1 em wide in both, so nothing moves on the swap
const metrics = "  ascent-override: 92%;\n  descent-override: 28%;\n  line-gap-override: 0%;";
const fallback = (weight: number, names: string[]) =>
  `@font-face {\n  font-family: "Lingxi CJK Fallback";\n  src: ${names.map((n) => `local("${n}")`).join(", ")};\n  font-weight: ${weight};\n${metrics}\n  unicode-range: ${range};\n}`;
writeFileSync(
  join(styles, "display-cjk.css"),
  `/* R29: written by scripts/display-cjk-font.mts from scripts/lib/displayCjk.mts; run it again, do not edit by hand.
   The Chinese page titles in a pixel face, as the English ones are in Pixelify Sans: Ark Pixel Font 12px by TakWolf
   (SIL OFL 1.1, fonts/OFL.txt), cut to the ${chars.length} characters of those titles: ${text} */
@font-face {
  font-family: "Lingxi Pixel CJK";
  src: url("./fonts/lingxi-pixel-cjk.woff2") format("woff2");
  font-display: swap;
${metrics}
  unicode-range: ${range};
}
/* while it loads, the system's own Chinese face on the same metrics */
${fallback(400, ["Microsoft YaHei", "PingFang SC Regular", "PingFangSC-Regular", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC"])}
${fallback(700, ["Microsoft YaHei Bold", "PingFang SC Semibold", "PingFangSC-Semibold", "Noto Sans CJK SC Bold", "Noto Sans SC Bold", "Source Han Sans SC Bold"])}
:root {
  /* a page title's face: Pixelify Sans for Latin, the pixel face for the Chinese titles listed in displayCjk.mts */
  --display-cjk: "Pixelify Sans Variable", "Lingxi Pixel CJK", "Lingxi CJK Fallback", "Baloo 2 Variable", ui-rounded, system-ui,
    sans-serif;
}
`,
);
process.stdout.write(`${chars.length} characters, ${statSync(out).size} bytes: ${out}\n`);
