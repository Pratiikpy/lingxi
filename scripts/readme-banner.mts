/**
 * Renders the README banner (`docs/readme/banner.png`) from its source, `docs/readme/banner.html` (A86): the art with
 * no English lines, and the words set in the game's own font. Run with `pnpm readme:banner` after changing the words.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const dir = join(import.meta.dirname, "..", "docs", "readme");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 640 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(join(dir, "banner.html")).href);
  await page.evaluate(() => document.fonts.ready);
  const font = await page.evaluate(() => document.fonts.check('600 30px "Baloo 2 Variable"'));
  if (!font) throw new Error("the banner's font did not load");
  await page.screenshot({ path: join(dir, "banner.png") });
  process.stdout.write("docs/readme/banner.png rendered\n");
} finally {
  await browser.close();
}
