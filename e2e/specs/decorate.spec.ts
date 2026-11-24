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
    const affordable = bar
      .locator(".decor-piece.shop")
      .filter({ hasText: look.lang === "zh" ? "15 金币" : "15 coins" })
      .first();
    await affordable.click();
    await expect(bar).toHaveClass(/placing/);
    const strip = (await bar.boundingBox())!;
    // a row of 44-pixel buttons and a line of words: at most a third of the room even when the evening's village news
    // leaves a phone's room at its shortest
    expect(strip.y + strip.height - stage.y, "the strip takes at most the top third of the room").toBeLessThan(
      stage.height / 3,
    );
    // and nothing in it is cut off: every line's words fit inside it
    const clipped = await bar
      .locator(".decor-line > *")
      .evaluateAll((els) =>
        els
          .filter(
            (el) =>
              el.scrollWidth > el.clientWidth + 1 ||
              el.getBoundingClientRect().right > el.closest(".decor-bar")!.getBoundingClientRect().right + 1,
          )
          .map((el) => el.textContent),
      );
    expect(clipped, "no words cut off in the strip").toEqual([]);
    // every control of the strip is whole inside it and reads against its button, in either theme
    const controls = await bar.locator("button").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        const lum = (c: string) => {
          const [r2, g, b] = (c.match(/\d+(\.\d+)?/g) ?? ["0", "0", "0"])
            .slice(0, 3)
            .map((v) => Number(v) / 255)
            .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
          return 0.2126 * r2! + 0.7152 * g! + 0.0722 * b!;
        };
        const st = getComputedStyle(el);
        const [hi, lo] = [lum(st.color), lum(st.backgroundColor)].sort((a, b) => b - a);
        return { text: el.textContent ?? "", left: r.left, right: r.right, contrast: (hi! + 0.05) / (lo! + 0.05) };
      }),
    );
    for (const c of controls) {
      expect(c.left, `"${c.text}" starts inside the strip`).toBeGreaterThanOrEqual(strip.x - 1);
      expect(c.right, `"${c.text}" ends inside the strip`).toBeLessThanOrEqual(strip.x + strip.width + 1);
      expect(c.contrast, `"${c.text}" reads against its button`).toBeGreaterThanOrEqual(4.5);
    }
    await page.screenshot({
      path: test.info().outputPath(`decorate-placing-${look.lang}-${look.scheme}-${look.size}.png`),
    });
    // a tap in the room's open floor puts it down, and the shelves come back for the next piece
    await page.mouse.click(stage.x + stage.width * 0.3, stage.y + stage.height * 0.75);
    await expect(bar).not.toHaveClass(/placing/);
    await expect(bar.locator(".decor-count")).toContainText(look.lang === "zh" ? "已摆 1/" : "1 of ");
    await page.getByRole("button", { name: look.done }).click();
    await expect(mark, "and comes back when decorating is done").toBeVisible();
  });
}
