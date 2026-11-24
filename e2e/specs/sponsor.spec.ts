/**
 * A40: when Lingxi will not sponsor a pet's tape-out, the player is told why and pointed to taping it out with their
 * own wallet. The server's refusals themselves (`newcomer`, `lifetime`, answered 200) are proven against the real
 * quota in `services/api/test/relayRoutes.test.ts`; a baby holds one lesson, so a browser cannot teach one fresh pet
 * enough new minds to reach them, and here the tape-out request is answered with the server's own refusal.
 */
import { expect, hatch, sheet, test } from "../fixtures";
import { keepOnChain } from "../helpers/browser";

for (const look of [
  {
    lang: "en",
    scheme: "light",
    size: "phone",
    reason: "newcomer",
    update: "Put its new mind on chain",
    said: "Until a pet has lived on X Layer three days and saved its third, Lingxi sponsors only a share of its tape-outs",
    own: "Tape it out with my own wallet (see the cost first)",
  },
  {
    lang: "zh",
    scheme: "dark",
    size: "desktop",
    reason: "lifetime",
    update: "把新心智放上链",
    said: "灵犀为一只宠物负担的流片已经用完了：上链满三天、存好第三天之前 3 次，一生 40 次。",
    own: "用自己的钱包流片（先看费用）",
  },
] as const) {
  test(`a sponsorship refused for "${look.reason}" says why and offers the player's own tape-out (${look.lang}, ${look.scheme}, ${look.size})`, async ({
    player,
    run,
  }) => {
    test.setTimeout(480_000);
    const p = await player({ lang: look.lang, scheme: look.scheme, size: look.size });
    const { page } = p;
    await hatch(p, "Pip");
    await sheet(page, "me");
    await keepOnChain(p, run);
    await page.keyboard.press("Escape");
    // a lesson, so the pet's mind on chain is behind the one it has now
    await sheet(page, "mind");
    await page.locator(".levels .level-head[data-hint=teach]").first().click();
    await page.locator(".proposal button[data-hint=teach]").click();
    await page.keyboard.press("Escape");
    // the server's refusal, as it answers it
    let asked = 0;
    await page.route(
      (u) => /\/api\/tapeout(-child|-instinct)?$/.test(u.pathname),
      (route) => (
        asked++,
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, reason: look.reason }),
        })
      ),
    );
    await sheet(page, "me");
    await page.getByRole("button", { name: look.update }).click();
    const err = page.locator(".chainpanel .err");
    await expect(err, "the refusal is said in the player's words").toContainText(look.said, { timeout: 60_000 });
    expect(asked, "the game asked Lingxi's relayer").toBeGreaterThan(0);
    await expect(
      page.getByRole("button", { name: look.own }),
      "and the player's own tape-out is right there",
    ).toBeVisible();
    await expect(err, "pointing to it with no direction it might not have").toContainText(
      look.lang === "zh" ? "改用自己的钱包流片" : "with your own wallet instead",
    );
    await err.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: test.info().outputPath(`sponsor-${look.reason}-${look.lang}-${look.scheme}-${look.size}.png`),
    });
  });
}
