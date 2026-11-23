/**
 * A14: nothing covers the Decorate bar. The pet's "!" stands at the room's top right; while the player decorates, the
 * bar takes the top of the room, so the "!" steps aside, and comes back when they press Done. P3a: and the bar never
 * covers the room: with a piece in hand it folds to one strip, the room below takes the tap, and the shelves come back.
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
    // P3a: with a piece in hand the bar folds to one strip, and most of the room is free to tap
    const stage = (await page.locator(".stage").boundingBox())!;
    const affordable = bar.locator(".decor-piece.shop").filter({ hasText: look.lang === "zh" ? "15 金币" : "15 coins" }).first();
    await affordable.click();
    await expect(bar).toHaveClass(/placing/);
    const strip = (await bar.boundingBox())!;
    expect(strip.y + strip.height - stage.y, "the strip takes at most the top quarter of the room").toBeLessThan(stage.height * 0.25);
    await page.screenshot({ path: test.info().outputPath(`decorate-placing-${look.lang}-${look.scheme}-${look.size}.png`) });
    // a tap in the room's open floor puts it down, and the shelves come back for the next piece
    await page.mouse.click(stage.x + stage.width * 0.3, stage.y + stage.height * 0.75);
    await expect(bar).not.toHaveClass(/placing/);
    await expect(bar.locator(".decor-count")).toContainText(look.lang === "zh" ? "已摆 1/" : "1 of ");
    await page.getByRole("button", { name: look.done }).click();
    await expect(mark, "and comes back when decorating is done").toBeVisible();
  });
}
