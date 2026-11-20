/**
 * A68: the proof table's check, the column that matters most, is readable on a phone. Each circuit's name and check
 * come first, inside the card, and the table no longer scrolls sideways; a desktop keeps the full table.
 */
import { expect, test } from "../fixtures";

for (const look of [
  { lang: "en", scheme: "light", size: "phone", match: "✓ matches X Layer" },
  { lang: "zh", scheme: "dark", size: "phone", match: "✓ 与 X Layer 一致" },
  { lang: "en", scheme: "dark", size: "desktop", match: "✓ matches X Layer" },
] as const) {
  test(`the proof table's check reads on the page (${look.lang}, ${look.scheme}, ${look.size}) (A68)`, async ({ player }) => {
    test.setTimeout(240_000);
    const p = await player({ lang: look.lang, scheme: look.scheme, size: look.size });
    const { page } = p;
    await page.goto(`${p.web}/verify.html#1`);
    const card = page.locator("section[aria-labelledby=proof-table-h]");
    await card.scrollIntoViewIfNeeded();
    const checks = card.locator("tbody tr td:last-child");
    await expect(checks).toHaveCount(5);
    for (let i = 0; i < 5; i++) await expect(checks.nth(i), "each circuit is checked against X Layer").toHaveText(look.match, { timeout: 90_000 });
    // the proof table, and the two other tables of the same build (the rule circuits, the contracts): their last column,
    // the check, inside the card, and none scrolling sideways
    for (const sel of ["section[aria-labelledby=proof-table-h]", "#rules", "#contracts"]) {
      const sec = page.locator(sel);
      await sec.scrollIntoViewIfNeeded();
      const box = (await sec.boundingBox())!;
      const last = sec.locator("tbody tr td:last-child");
      const n = await last.count();
      expect(n, `${sel} has rows`).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) {
        const c = (await last.nth(i).boundingBox())!;
        expect(c.x >= box.x - 0.5 && c.x + c.width <= box.x + box.width + 0.5, `${sel} row ${i}'s last column is inside the card`).toBe(true);
      }
      for (const wrap of await sec.locator(".v-table-wrap").all()) expect(await wrap.evaluate((el) => el.scrollWidth - el.clientWidth), `${sel} does not scroll sideways`).toBeLessThanOrEqual(1);
    }
    if (look.size === "desktop") await expect(card.locator("thead"), "a desktop keeps the table's header").toBeVisible();
    await card.screenshot({ path: test.info().outputPath(`proof-table-${look.lang}-${look.scheme}-${look.size}.png`) });
  });
}
