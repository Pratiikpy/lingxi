/**
 * `pnpm share:cards`: the card each page shows when its link is posted in a chat (P6), 1200 by 630, made from the
 * game's own art: the clearing, the pet drawn by the game's own sprite code, and the page's title in English and Chinese
 * in the game's fonts. Writes apps/web/public/cards/<page>.png, and the card tags into each page's head
 * (scripts/shareCards.test.mts checks every page carries them). Run after a page's title or the art changes.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import { drawPet, toRgba } from "@lingxi/art";
import { CARDS, SITE, cardTags } from "./lib/shareCards.mts";
import { PALETTE_OF } from "../apps/web/src/scene/palette.ts";

const root = join(import.meta.dirname, "..");
const web = join(root, "apps", "web");
const out = join(web, "public", "cards");
mkdirSync(out, { recursive: true });
const font = (pkg: string, file: string) => pathToFileURL(join(web, "node_modules", "@fontsource-variable", pkg, "files", file)).href;
const art = pathToFileURL(join(web, "public", "art", "rooms", "49_clearing", "backgrounds", "playtest-a.png")).href;

/** The pet as a PNG file, drawn by the game's own sprite code. */
function petFile(line: "gentle" | "bold" | "curious"): string {
  const c = drawPet(line, "adult", { expression: "happy" });
  const png = new PNG({ width: c.w, height: c.h });
  png.data = Buffer.from(toRgba(c, PALETTE_OF[line], 1));
  const file = join(tmpdir(), `lingxi-card-pet-${line}.png`);
  writeFileSync(file, PNG.sync.write(png));
  return pathToFileURL(file).href;
}

const html = (c: (typeof CARDS)[number]) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "Pixelify Sans Variable"; src: url("${font("pixelify-sans", "pixelify-sans-latin-wght-normal.woff2")}") format("woff2"); font-weight: 400 700; }
@font-face { font-family: "Baloo 2 Variable"; src: url("${font("baloo-2", "baloo-2-latin-wght-normal.woff2")}") format("woff2"); font-weight: 400 800; }
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
body { background: #8ec27a; position: relative; }
/* the clearing twice, the second copy mirrored, as the game's own hero lays it, so the edges meet cleanly */
.bg { position: absolute; bottom: 0; width: 640px; height: 640px; background: url("${art}") 0 0 / 640px 640px; image-rendering: pixelated; }
.bg.b { left: 640px; transform: scaleX(-1); }
.panel { position: absolute; left: 56px; top: 56px; width: 640px; padding: 34px 38px; border: 4px solid #2b2140; border-radius: 28px; background: #fffdf8; box-shadow: 0 8px 0 #2b2140; }
.brand { margin: 0 0 14px; font: 700 26px "Pixelify Sans Variable", sans-serif; color: #b34624; letter-spacing: 0.02em; }
h1 { margin: 0; font: 700 56px/1.02 "Pixelify Sans Variable", sans-serif; color: #2b2140; }
.zh { margin: 10px 0 0; font: 700 40px/1.2 "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif; color: #2b2140; }
.line { margin: 18px 0 0; font: 600 25px/1.35 "Baloo 2 Variable", sans-serif; color: #5b4e73; }
.pet { position: absolute; right: 120px; bottom: 54px; width: 300px; image-rendering: pixelated; filter: drop-shadow(0 8px 0 rgba(43,33,64,0.35)); }
</style></head><body>
<div class="bg"></div><div class="bg b"></div>
<div class="panel"><p class="brand">Lingxi · 灵犀</p><h1>${c.en}</h1><p class="zh">${c.zh}</p><p class="line">${c.line}</p></div>
<img class="pet" src="${petFile(c.pet)}" alt="">
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  for (const c of CARDS) {
    const file = join(tmpdir(), `lingxi-card-${c.page}.html`);
    writeFileSync(file, html(c));
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => document.fonts.ready);
    if (!(await page.evaluate(() => document.fonts.check('700 56px "Pixelify Sans Variable"')))) throw new Error(`the card for ${c.page} was drawn without its font`);
    await page.screenshot({ path: join(out, `${c.page.replace(/\.html$/, "")}.png`) });
    // the page's card tags, between two marks in its head, written fresh each time
    const pageFile = c.page === "circuits.html" ? join(web, "public", "circuits.html") : join(web, c.page);
    const text = readFileSync(pageFile, "utf8");
    const tags = cardTags(c);
    const marked = /\n?\s*<!-- share card -->[\s\S]*?<!-- \/share card -->/;
    const next = marked.test(text) ? text.replace(marked, `\n    ${tags}`) : text.replace("</head>", `  ${tags}\n  </head>`);
    writeFileSync(pageFile, next);
    process.stdout.write(`${c.page}: card and tags written\n`);
  }
} finally {
  await browser.close();
}
process.stdout.write(`cards in ${out}, served from ${SITE}/cards/\n`);
