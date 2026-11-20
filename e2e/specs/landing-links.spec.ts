/**
 * A60: the landing page links the contracts on X Layer and the source code. The contracts link opens the proof page's
 * contract table (A72); the source link points at the public repository.
 */
import { expect, test } from "../fixtures";

for (const look of [
  { lang: "en", scheme: "light", size: "phone", contracts: "The contracts on X Layer, and their verified source", source: "The source code, on GitHub" },
  { lang: "zh", scheme: "dark", size: "desktop", contracts: "X Layer 上的合约及其已验证的源码", source: "源代码，在 GitHub 上" },
] as const) {
  test(`the landing links the contracts and the source code (${look.lang}, ${look.scheme}, ${look.size})`, async ({ player }) => {
    test.setTimeout(180_000);
    const p = await player({ lang: look.lang, scheme: look.scheme, size: look.size });
    const { page } = p;
    await page.goto(`${p.web}/`);
    const source = page.locator("footer.l-foot").getByRole("link", { name: look.source });
    await expect(source).toHaveAttribute("href", "https://github.com/Pratiikpy/lingxi");
    const contracts = page.locator("footer.l-foot").getByRole("link", { name: look.contracts });
    await contracts.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`landing-links-${look.lang}-${look.scheme}-${look.size}.png`) });
    await contracts.click();
    await expect(page.locator("section#contracts h2"), "it opens the proof page's contract table").toBeVisible({ timeout: 60_000 });
    await expect(page.locator("section#contracts")).toBeInViewport({ timeout: 10_000 });
  });
}
