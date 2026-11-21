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
  // the check runs as the game starts: open the game afresh, as a browser that has not seen the mark (B5 shows it once
  // per set of rules), and a sheet before the check can finish
  await page.evaluate(() => localStorage.removeItem("lingxi.rulesSeen"));
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

test("the rules mark pops up once, and the circuit view keeps the proof (B5)", async ({ player }) => {
  const p = await player();
  const { page } = p;
  await hatch(p, "Pip");
  await page.evaluate(() => localStorage.removeItem("lingxi.rulesSeen"));
  await page.reload();
  await page.locator(".stage").waitFor();
  await expect(page.locator(".rules-mark")).toBeVisible({ timeout: 30_000 });
  // the next load: the same rules are checked again, and no pop-up covers the room
  await page.reload();
  await page.locator(".stage").waitFor();
  for (let i = 0; i < 20; i++) {
    expect(await page.locator(".rules-mark").count(), "no pop-up on a later load").toBe(0);
    await page.waitForTimeout(500);
  }
  await page.locator(".circuit-btn").click();
  await expect(page.locator(".bv-rules")).toContainText(p.t("Rules verified on X Layer", "规则已在 X Layer 上核对"), { timeout: 30_000 });
});
