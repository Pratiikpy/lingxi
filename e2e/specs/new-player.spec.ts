/**
 * A new player's first minutes, as a player plays them: hatch a pet, feed it from the bag, play with it, look around
 * the room, and take a gift from the mail. Each step is checked in the save the game keeps, not only on screen.
 */
import { type Opened, dismiss, expect, hatch, savedPet, test } from "../fixtures";

const bagOf = (p: Opened) => p.page.evaluate(() => (JSON.parse(localStorage.getItem("lingxi.world.v1") ?? "{}") as { bag?: Record<string, number> }).bag ?? {});
/**
 * The lights the pattern game shows, in order, read as a player watches them; resolves when the pads take input. The
 * count starts once the showing has begun with every pad dark: the pad a player just pressed stays lit a moment.
 */
const watchPattern = (page: Opened["page"]) =>
  page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const seen: number[] = [];
        let last = -1;
        let started = false;
        const tick = () => {
          const pads = [...document.querySelectorAll<HTMLButtonElement>(".pads .pad")];
          const showing = pads.length > 0 && pads[0]!.disabled;
          const lit = pads.findIndex((b) => b.classList.contains("lit"));
          if (showing && lit < 0) started = true;
          if (started && lit >= 0 && lit !== last) seen.push(lit);
          last = lit;
          if (started && !showing) resolve(seen);
          else requestAnimationFrame(tick);
        };
        tick();
      }),
  );
const meter = async (p: Opened, m: "food" | "joy") => ((await savedPet(p.page)) as { meters: Record<string, number> } | null)?.meters[m] ?? -1;

for (const look of [
  { lang: "en", scheme: "light", size: "phone" },
  { lang: "zh", scheme: "dark", size: "desktop" },
] as const) {
  test(`a new player's first minutes (${look.lang}, ${look.scheme}, ${look.size})`, async ({ player }) => {
    const p = await player(look);
    const { page, t } = p;

    await hatch(p, "Pip");
    const pet = await savedPet(page);
    expect(pet?.name, "the pet is saved under its name").toBe("Pip");

    // feed: the bag opens on the food, and a food makes the pet less hungry
    const food0 = await meter(p, "food");
    await page.locator("button.act[data-hint=feed]").click();
    const feed = page.locator(".sheet .bag-item button", { hasText: t("Feed", "喂食") }).first();
    await feed.click();
    await expect.poll(() => meter(p, "food"), { message: "fed: the food meter rises in the save" }).toBeGreaterThan(food0);
    await page.keyboard.press("Escape");
    await dismiss(page);

    // play: "Follow the Pattern", watched and repeated for two rounds, then a miss ends it with a score
    const joy0 = await meter(p, "joy");
    await page.locator("button.act[data-hint=play]").click();
    await page.locator(".game-card").nth(1).click();
    for (let round = 1; round <= 3; round++) {
      const shown = await watchPattern(page);
      expect(shown.length, `round ${round} shows ${round} lights`).toBe(round);
      if (round < 3) for (const k of shown) await page.locator(".pads .pad").nth(k).click();
      else await page.locator(".pads .pad").nth((shown[0]! + 1) % 4).click();
    }
    await expect(page.locator(".game-result")).toContainText(t("Score 2", "得分 2"));
    await expect.poll(() => meter(p, "joy"), { message: "played: the joy meter rises in the save" }).toBeGreaterThan(joy0);
    await page.locator(".games .btn", { hasText: t("Back to the room", "回到房间") }).click();
    await dismiss(page);

    // look around: something found, or the room says why not
    const bag0 = JSON.stringify(await bagOf(p));
    await page.locator("[data-hint=look]").click();
    await expect.poll(async () => (JSON.stringify(await bagOf(p)) !== bag0 ? "found" : (await page.locator(".world-msg, .toast, [role=status]").count()) ? "said" : "nothing"), { message: "looking around finds something or says why not" }).not.toBe("nothing");

    // the mail: a letter with a gift, taken into the bag
    await page.locator(".mail-btn").click();
    await page.locator(".mail-item").first().waitFor();
    const gift = page.locator(".mail-head", { hasText: t("gift", "礼物") }).first();
    await expect(gift, "a welcome letter carries a gift").toBeVisible();
    await gift.click();
    const take = page.locator(".mail-body .btn.primary").first();
    await expect(take).toBeEnabled();
    const bag1 = JSON.stringify(await bagOf(p));
    await take.click();
    await expect.poll(async () => JSON.stringify(await bagOf(p)), { message: "the gift is in the bag" }).not.toBe(bag1);
    await page.screenshot({ path: test.info().outputPath(`first-minutes-${look.lang}-${look.scheme}-${look.size}.png`), fullPage: false });
  });
}
