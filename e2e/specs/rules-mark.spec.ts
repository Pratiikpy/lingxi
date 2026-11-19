/**
 * The start-up mark "Rules verified on X Layer" never covers what the player reads (A3). It once floated over an open
 * sheet's title for its five seconds. A sheet opened before the check finishes holds the mark back for as long as it
 * stays open; closing it brings the mark, for its full time.
 */
import { expect, hatch, sheet, test } from "../fixtures";

test("the rules mark waits while a sheet is open, and shows once it closes (A3)", async ({ player }) => {
  const p = await player();
  const { page } = p;
  await hatch(p, "Pip");
  // the check runs as the game starts: open the game afresh, and a sheet before the check can finish
  await page.reload();
  await page.locator(".stage").waitFor();
  await sheet(page, "bag");
  // the check reads 17 circuits from X Layer in a few seconds; the sheet stays open well past that and past the
  // mark's own five seconds, and the mark never shows over it
  for (let i = 0; i < 50; i++) {
    expect(await page.locator(".rules-mark").count(), "no mark over the open sheet").toBe(0);
    await page.waitForTimeout(500);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator(".rules-mark")).toBeVisible();
  await expect(page.locator(".rules-mark")).toContainText(p.t("Rules verified on X Layer", "规则已在 X Layer 上核对"));
});
