/**
 * P6 (carried from P4): a visited game opens with the network off. A player hatches a pet on the built site, whose
 * service worker (public/sw.js) keeps the game; with the connection gone, the game page opens again to the same pet,
 * and a note says the player is offline. Played on a site built as released, with the worker on.
 */
import { rmSync } from "node:fs";
import { dismiss, expect, liveHatch, test } from "../fixtures";
import { buildSite, serveSite, siteFolder } from "../helpers/browser";

for (const look of [
  { lang: "en", scheme: "light", size: "phone" },
  { lang: "zh", scheme: "dark", size: "desktop" },
] as const) {
  test(`a visited game opens offline to the pet (${look.lang}, ${look.scheme}, ${look.size})`, async ({ player, run }) => {
    test.setTimeout(360_000);
    const f = siteFolder(run, `offline-open-${look.lang}`);
    await buildSite(run, f.site, "A", { offline: true });
    const site = await serveSite(f.site);
    try {
      const p = await player(look);
      const { page } = p;
      await page.goto(`${site.url}/play.html`);
      await liveHatch(page, 120_000);
      await page.fill("#pet-name", "Lumi");
      await page.click(".hatch-go");
      await page.locator(".stage").waitFor({ timeout: 60_000 });
      await dismiss(page);
      // the worker is installed and has kept the game
      await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active), { message: "the worker is active", timeout: 60_000 }).toBe(true);
      await expect.poll(() => page.evaluate(async () => (await caches.keys()).some((k) => k.startsWith("lingxi-") && k !== "lingxi-art")), { message: "the game is kept" }).toBe(true);
      await page.waitForTimeout(1_500);

      // no network at all: the game opens again, to the same pet, and says it is offline
      await p.ctx.setOffline(true);
      await page.reload();
      await page.locator(".stage").waitFor({ timeout: 60_000 });
      await expect(page.locator(".who-title")).toContainText("Lumi");
      await expect(page.locator(".offline-note"), "the offline note").toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`offline-open-${look.lang}-${look.scheme}-${look.size}.png`) });
      // whatever needed the network was refused by the browser, and only that: read once the page has settled and the
      // connection is back, so a request still in flight when the check ran is counted too
      await page.waitForTimeout(3_000);
      await p.ctx.setOffline(false);
      await page.waitForTimeout(1_500);
      for (const e of p.errors) expect(e).toMatch(/ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError|ERR_FAILED/);
      p.errors.splice(0, p.errors.length);
    } finally {
      site.stop();
      rmSync(f.site, { recursive: true, force: true });
    }
  });
}
