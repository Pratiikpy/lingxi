/**
 * P3: a first visit's game page runs the hatch screen on its own and loads the rest of the game behind it
 * (FirstVisit.tsx). The screen answers before the game's code is fetched; every choice made on it survives the hand-over
 * to the full game; hatching before the game is in still lands in the room; the save-file sheet still opens from it;
 * and a player with a saved pet goes straight to the full game.
 */
import type { Page } from "@playwright/test";
import { expect, liveHatch, test } from "../fixtures";

/**
 * Whether the full game's code has been asked for yet (the dev server serves it by its source path). Counted from the
 * page's own requests: the browser's resource timings stop at 250 entries, which the dev server's modules exceed.
 */
const asked = new WeakMap<Page, { game: boolean }>();
function watchGame(page: Page): void {
  const seen = { game: false };
  asked.set(page, seen);
  page.on("request", (r) => {
    if (r.url().includes("/src/play/PlayApp.tsx")) seen.game = true;
  });
}
const gameAskedFor = (page: Page) => Promise.resolve(asked.get(page)?.game ?? false);

for (const look of [
  { lang: "en", scheme: "light", size: "phone" },
  { lang: "zh", scheme: "dark", size: "desktop" },
] as const) {
  test(`a first visit's choices survive the hand-over to the full game (${look.lang}, ${look.scheme}, ${look.size})`, async ({
    player,
  }) => {
    test.setTimeout(180_000);
    const p = await player(look);
    const { page } = p;
    watchGame(page);
    await page.goto(`${p.web}/play.html`);
    await liveHatch(page);
    expect(await gameAskedFor(page), "the hatch screen runs before the rest of the game is fetched").toBe(false);

    // the choices, made on the standalone screen: the first touch starts the game's code loading behind it
    await page.locator(".egg").nth(1).click();
    await page.locator(".instinct").first().click();
    await page.fill("#pet-name", "Ququ");
    await page.locator("#pet-name").blur();
    await expect.poll(() => gameAskedFor(page), { timeout: 60_000 }).toBe(true);
    // the full game takes over at a calm moment and mounts the same screen: nothing chosen is lost
    await page.waitForTimeout(2_000);
    await expect(page.locator(".egg").nth(1)).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".instinct").first()).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#pet-name")).toHaveValue("Ququ");
    await page.screenshot({ path: test.info().outputPath(`first-visit-${look.lang}-${look.scheme}-${look.size}.png`) });

    await page.click(".hatch-go");
    await page.locator(".stage").waitFor({ timeout: 60_000 });
    await expect(page.locator(".hatch")).toHaveCount(0);
  });
}

test("hatching at once, before the rest of the game is in, still lands in the room", async ({ player }) => {
  test.setTimeout(180_000);
  const p = await player({ lang: "en", scheme: "light", size: "phone" });
  const { page } = p;
  // the game's code is held back until the egg has been tapped, so the hatch is certain to beat it
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\/src\/play\/PlayApp\.tsx/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(`${p.web}/play.html`);
  await liveHatch(page);
  await page.fill("#pet-name", "Bao");
  await page.click(".hatch-go");
  // the egg cracks and holds its last frame while the game arrives
  await page.locator(".hatch-stage").waitFor();
  await page.waitForTimeout(2_500);
  await expect(page.locator(".hatch-stage")).toBeVisible();
  release();
  await page.locator(".stage").waitFor({ timeout: 60_000 });
  await expect(page.locator(".hatch")).toHaveCount(0);
});

test("the save-file sheet still opens from a first visit's hatch screen", async ({ player }) => {
  test.setTimeout(180_000);
  const p = await player({ lang: "zh", scheme: "light", size: "phone" });
  const { page } = p;
  await page.goto(`${p.web}/play.html`);
  await liveHatch(page);
  await page.click(".hatch-restore");
  await expect(page.locator(".sheet")).toBeVisible({ timeout: 60_000 });
});

test("a player with a saved pet goes straight to the full game", async ({ player }) => {
  test.setTimeout(180_000);
  const p = await player({ lang: "en", scheme: "dark", size: "desktop" });
  const { page } = p;
  await page.goto(`${p.web}/play.html`);
  await liveHatch(page);
  await page.fill("#pet-name", "Mo");
  await page.click(".hatch-go");
  await page.locator(".stage").waitFor({ timeout: 60_000 });
  watchGame(page);
  await page.reload();
  await page.locator(".stage").waitFor({ timeout: 60_000 });
  expect(await gameAskedFor(page), "a returning player's game is fetched at once").toBe(true);
  await expect(page.locator(".hatch")).toHaveCount(0);
});
