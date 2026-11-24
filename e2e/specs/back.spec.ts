/**
 * P6 (carried from P4): the phone's back button closes what is open before it leaves the game. A sheet open from the
 * tab bar closes on Back and the player is still in the game, with the pet; a sheet opened from another closes first,
 * then the one beneath; with nothing open, Back leaves to the page the player came from; a sheet closed in the page
 * leaves no entry behind for Back to stumble on.
 */
import { expect, hatch, test } from "../fixtures";

for (const look of [
  { lang: "en", scheme: "light", size: "phone" },
  { lang: "zh", scheme: "dark", size: "desktop" },
] as const) {
  test(`the back button closes what is open before it leaves (${look.lang}, ${look.scheme}, ${look.size})`, async ({ player }) => {
    test.setTimeout(240_000);
    const p = await player(look);
    const { page } = p;
    // the player arrives from the landing, as they would
    await page.goto(`${p.web}/index.html`);
    await hatch(p, "Momo");
    const play = page.url();

    // a sheet from the tab bar: Back closes it, and the game and its pet stay
    await page.locator(".tab[data-hint=tab-me]").click();
    await page.locator(".sheet").waitFor();
    await page.goBack();
    await expect(page.locator(".sheet"), "Back closed the sheet").toHaveCount(0);
    expect(page.url(), "still in the game").toBe(play);
    await expect(page.locator(".who-title"), "the pet is still there").toContainText("Momo");

    // a sheet opened from another: Back closes the top one, then the one beneath
    await page.locator(".tab[data-hint=tab-me]").click();
    await page.locator(".sheet").waitFor();
    await page.locator(".sheet .lv-skills").click();
    await expect(page.locator(".sheet")).toHaveCount(2);
    await page.goBack();
    await expect(page.locator(".sheet"), "the skills sheet closed first").toHaveCount(1);
    await page.goBack();
    await expect(page.locator(".sheet"), "then the Pet sheet").toHaveCount(0);
    expect(page.url()).toBe(play);

    // a sheet closed in the page leaves nothing for Back: the next Back leaves the game
    await page.locator(".tab[data-hint=tab-me]").click();
    await page.locator(".sheet").waitFor();
    await page.keyboard.press("Escape");
    await expect(page.locator(".sheet")).toHaveCount(0);
    await page.waitForTimeout(300);
    await page.goBack();
    await page.waitForURL(/index\.html/, { timeout: 20_000 });
    await expect(page.locator("h1"), "Back from the room returns to the landing").toBeVisible();
  });
}
