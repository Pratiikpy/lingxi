/**
 * Takes the README's page shots from the live site (A93): each page at 1600 x 1000, once its own content has loaded,
 * set in the dark window frame the README's images share, and written to `docs/readme/`. Run with `pnpm readme:shots`
 * after a page's words or look change, so the README never shows wording the site no longer says.
 */
import { join } from "node:path";
import { recordShots } from "./lib/sites.mts";
import { chromium, type Page } from "@playwright/test";
import { LINGXI_SITE } from "../packages/chain/src/site.ts";

const SITE = process.env.LINGXI_SITE ?? LINGXI_SITE;
const out = join(import.meta.dirname, "..", "docs", "readme");

/** Each shot: its file, its page, and what must be on screen before it is taken. */
const SHOTS: Array<{ file: string; path: string; ready: (page: Page) => Promise<unknown> }> = [
  // pet #1's proof, read from X Layer: its picture checked and its record shown
  { file: "proof.png", path: "/verify.html#1", ready: (page) => page.getByText("Pixel for pixel", { exact: false }).first().waitFor({ timeout: 120_000 }) },
  // the tree of life, read from X Layer: its numbers shown, nothing still loading
  { file: "tree.png", path: "/tree.html", ready: (page) => page.waitForFunction(() => !!document.querySelector(".tl-stats") && !document.querySelector(".tl-loading"), undefined, { timeout: 120_000 }) },
  // every number read: no row still waiting
  { file: "numbers.png", path: "/numbers.html", ready: (page) => page.waitForFunction(() => document.querySelectorAll(".nb-row").length > 0 && !document.querySelector(".tl-loading"), undefined, { timeout: 120_000 }) },
];

const FRAME = (shot: string) => `<!doctype html><html><head><style>
  html, body { margin: 0; width: 1620px; height: 1056px; background: #2a2140; }
  .dots { position: absolute; top: 11px; left: 18px; display: flex; gap: 10px; }
  .dots i { width: 16px; height: 16px; border-radius: 50%; display: block; }
  img { position: absolute; left: 10px; top: 46px; width: 1600px; height: 1000px; display: block; }
</style></head><body><div class="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div><img src="data:image/png;base64,${shot}"></body></html>`;

const browser = await chromium.launch();
try {
  for (const s of SHOTS) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, colorScheme: "light" });
    await page.addInitScript(() => localStorage.setItem("lingxi.lang", "en"));
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${SITE}${s.path}`, { waitUntil: "networkidle" });
    await s.ready(page);
    await page.waitForTimeout(800);
    if (errors.length) throw new Error(`${s.path}: console errors, no shot taken: ${errors.join("; ")}`);
    const shot = (await page.screenshot()).toString("base64");
    const frame = await browser.newPage({ viewport: { width: 1620, height: 1056 }, deviceScaleFactor: 1 });
    await frame.setContent(FRAME(shot));
    await frame.screenshot({ path: join(out, s.file) });
    process.stdout.write(`docs/readme/${s.file} taken from ${SITE}${s.path}\n`);
    await page.close();
    await frame.close();
  }
} finally {
  await browser.close();
}
// which live build these images show, for the status check (A100)
await recordShots(join(import.meta.dirname, ".."), SITE, SHOTS.map((s) => s.file));
