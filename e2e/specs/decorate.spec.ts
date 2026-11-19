/**
 * A14: nothing covers the Decorate bar. The pet's "!" stands at the room's top right; while the player decorates, the
 * bar takes the top of the room, so the "!" steps aside, and comes back when they press Done.
 */
import { expect, hatch, test } from "../fixtures";

for (const look of [
  { lang: "en", scheme: "light", size: "phone", decorate: "Decorate", done: "Done" },
  { lang: "zh", scheme: "dark", size: "desktop", decorate: "布置", done: "完成" },
] as const) {
  test(`the Decorate bar is never covered (${look.lang}, ${look.scheme}, ${look.size})`, async ({ player }) => {
    const p = await player(look);
    const { page } = p;
    await hatch(p, "Pip");
    const mark = page.locator(".pet-quest");
    await expect(mark, "a new pet has something to ask").toBeVisible();
    await page.locator(".room-pill button", { hasText: look.decorate }).click();
    const bar = page.locator(".decor-bar");
    await expect(bar).toBeVisible();
    await expect(mark, "the pet's mark steps aside while decorating").toHaveCount(0);
    await page.waitForTimeout(400);
    await page.screenshot({ path: test.info().outputPath(`decorate-${look.lang}-${look.scheme}-${look.size}.png`) });
    await page.getByRole("button", { name: look.done }).click();
    await expect(mark, "and comes back when decorating is done").toBeVisible();
  });
}
