/**
 * A brand-new player scrolls their pet's page down to the album on the first visit (A2). The album once read the
 * world's flags as a new empty list on every read, so the store's selector looped until React gave up and the page
 * went blank. The album must draw, the game must stay, and nothing may be logged as an error.
 */
import { expect, hatch, sheet, test } from "../fixtures";

test("a new player's album draws on the first visit, and the game stays (A2)", async ({ player }) => {
  const p = await player();
  const { page, t } = p;
  await hatch(p, "Pip");
  await sheet(page, "me");
  // the pet's page draws each panel as it comes near the screen: scroll down, panel by panel, to the album
  // a held place is replaced by its panel the moment it comes near, so it is scrolled to inside the page in one step:
  // finding it first and scrolling after can find a place that is already gone (P3a)
  for (let i = 0; i < 40 && !(await page.locator(".sheet .album").count()); i++) {
    const more = await page.evaluate(() => {
      const held = document.querySelector(".sheet .lazy-hold");
      held?.scrollIntoView({ block: "center" });
      return !!held;
    });
    if (!more) break;
    await page.waitForTimeout(250);
  }
  await expect(page.locator(".sheet .album")).toBeVisible();
  await expect(page.locator(".sheet .album")).toContainText(t("Visitor album", "访客相册"));
  await expect(page.getByText(t("Something went wrong on this screen", "这个画面出了点问题"))).toHaveCount(0);
});
