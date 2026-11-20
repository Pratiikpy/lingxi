/**
 * A53: a player whose connection has used its share of the day's teaching in words is told it is theirs, and that
 * Pet School and chip lessons still work. The share itself is proven by `services/api/test/tokenBudget.test.ts`
 * through the real teach route; the suite's server has no model (it must never reach a paid one), so here the server
 * is answered as a teaching server would answer that player.
 */
import { expect, hatch, sheet, test } from "../fixtures";

for (const look of [
  { lang: "en", scheme: "light", size: "phone", words: "when hungry ask for food", said: "this connection has used its share of Lingxi's teaching" },
  { lang: "zh", scheme: "dark", size: "desktop", words: "饿了就要吃的", said: "这个网络连接的教课额度已经用完" },
] as const) {
  test(`a lesson past this connection's share says so (${look.lang}, ${look.scheme}, ${look.size})`, async ({ player }) => {
    test.setTimeout(180_000);
    const p = await player({ lang: look.lang, scheme: look.scheme, size: look.size });
    const { page } = p;
    // a server that teaches in words, as the live one does
    await page.route(
      (u) => u.pathname === "/api/health",
      async (route) => {
        const r = await route.fetch();
        const body = (await r.json()) as Record<string, unknown>;
        return route.fulfill({ response: r, body: JSON.stringify({ ...body, teach: true }) });
      },
    );
    await page.route(
      (u) => u.pathname === "/api/teach",
      (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, reason: "yourShare" }) }),
    );
    await hatch(p, "Pip");
    await sheet(page, "mind");
    const words = page.locator("#teach-words");
    await words.waitFor({ timeout: 30_000 });
    await expect(words).toBeEnabled({ timeout: 30_000 });
    await words.fill(look.words);
    await page.locator(".words button[type=submit]").click();
    const reply = page.locator(".words .reply");
    await expect(reply).toContainText(look.said);
    await reply.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`teach-share-${look.lang}-${look.scheme}-${look.size}.png`) });
  });
}
