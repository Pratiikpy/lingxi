/**
 * A72: the proof page's section links work. The README links `verify.html#contracts` and the game's rules mark links
 * `verify.html#rules`; the page read every hash as a pet number and crashed to a blank page on a word. Now a section
 * named in the address is shown and brought into view, the page reads pet #1, and a typed word is no pet, not a crash.
 */
import { expect, test } from "../fixtures";

for (const look of [
  { lang: "en", scheme: "light", size: "phone", section: "contracts", heading: "Contracts and" },
  { lang: "zh", scheme: "dark", size: "desktop", section: "rules", heading: "规则电路" },
] as const) {
  test(`verify.html#${look.section} opens on that section (${look.lang}, ${look.scheme}, ${look.size})`, async ({ player }) => {
    test.setTimeout(180_000);
    const p = await player({ lang: look.lang, scheme: look.scheme, size: look.size });
    const { page } = p;
    await page.goto(`${p.web}/verify.html#${look.section}`);
    const section = page.locator(`section#${look.section}`);
    await expect(section.locator("h2"), "the page is drawn, not blank").toContainText(look.heading, { timeout: 60_000 });
    await expect(section, "and the section is brought into view").toBeInViewport({ timeout: 10_000 });
    await expect(page.locator("#pet-id"), "the pet shown is #1").toHaveValue("1");
    await page.screenshot({ path: test.info().outputPath(`anchor-${look.section}-${look.lang}-${look.scheme}-${look.size}.png`) });
    // a word typed as a pet number is no pet, said as such
    await page.locator("#pet-id").fill("abc");
    await page.locator("#pet-id").press("Enter");
    await expect(page.locator("#pet-id")).toBeVisible();
  });
}
