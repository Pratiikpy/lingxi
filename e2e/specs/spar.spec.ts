/**
 * A friendly spar, as a player starts one: pick a partner, watch the rounds play out, read the result. The outcome is
 * checked in the spar record the game keeps, and a win pays its coins into the world's save.
 */
import { dismiss, expect, hatch, savedWorld, sheet, test } from "../fixtures";

type Records = Record<string, { w: number; l: number; d: number }>;

for (const look of [
  { lang: "en", scheme: "light", size: "phone" },
  { lang: "zh", scheme: "dark", size: "desktop" },
] as const) {
  test(`a friendly spar (${look.lang}, ${look.scheme}, ${look.size})`, async ({ player }) => {
    const p = await player(look);
    const { page, t } = p;
    await hatch(p, "Pip");
    const coins0 = Number((await savedWorld(page)).coins ?? 0);

    await sheet(page, "spar");
    const partner = page.locator(".sp-partners .sp-partner").nth(1);
    await partner.scrollIntoViewIfNeeded();
    await partner.click();
    await expect(page.locator(".sp-fight"), "the fight plays").toBeVisible();
    const result = page.locator(".sp-result");
    await result.waitFor({ timeout: 90_000 });
    const title = await result.locator("h2, h3, .sp-title, p").first().innerText();
    expect(title.length, "the result names who won").toBeGreaterThan(0);

    const records = await page.evaluate(() => JSON.parse(localStorage.getItem("lingxi.spar.v1") ?? "{}") as Records);
    const all = Object.values(records);
    expect(all.length, "one partner in the spar record").toBe(1);
    const r = all[0]!;
    expect(r.w + r.l + r.d, "one spar counted").toBe(1);
    const coins1 = Number((await savedWorld(page)).coins ?? 0);
    if (r.w === 1) expect(coins1, "a win pays coins").toBeGreaterThan(coins0);
    else expect(coins1, "a draw or a loss pays at most a little").toBeGreaterThanOrEqual(coins0);
    await expect(result).toContainText(r.w === 1 ? t("won", "赢了") : r.l === 1 ? t("won", "赢了") : t("draw", "平手"));
    await page.screenshot({ path: test.info().outputPath(`spar-${look.lang}-${look.scheme}-${look.size}.png`) });
    await page.keyboard.press("Escape");
    await dismiss(page);
  });
}
