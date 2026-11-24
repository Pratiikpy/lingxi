/**
 * A111: every page says its language, title and description in the reader's language. Verify and the handheld kept
 * `lang="en"` and English titles in Chinese, and every page's description stayed English.
 */
import { PAGE_META, type Page } from "../../apps/web/src/i18n/pageMeta";
import { expect, test } from "../fixtures";

const PAGES: Array<[Page, string]> = [
  ["index", "/"],
  ["play", "/play.html"],
  ["verify", "/verify.html#1"],
  ["handheld", "/handheld.html"],
  ["numbers", "/numbers.html"],
  ["tree", "/tree.html"],
  ["agents", "/agents.html"],
];

for (const lang of ["zh", "en"] as const)
  test(`every page's language, title and description are the reader's (${lang}) (A111)`, async ({ player }) => {
    test.setTimeout(240_000);
    const p = await player({
      lang,
      scheme: lang === "zh" ? "dark" : "light",
      size: lang === "zh" ? "phone" : "desktop",
    });
    const { page } = p;
    for (const [name, path] of PAGES) {
      await page.goto(`${p.web}${path}`);
      await expect(page.locator("html"), `${name}: <html lang>`).toHaveAttribute(
        "lang",
        lang === "zh" ? "zh-CN" : "en",
      );
      await expect(page, `${name}: title`).toHaveTitle(PAGE_META[name].title[lang]);
      await expect(page.locator('meta[name="description"]'), `${name}: description`).toHaveAttribute(
        "content",
        PAGE_META[name].description[lang],
      );
    }
  });
