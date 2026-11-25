/**
 * P5: the first ten minutes with the keyboard alone, in both languages. Nothing here is clicked or focused by the test:
 * Tab and Shift+Tab move the focus, Enter and Space act, and the keys type a name, as a player without a pointer would.
 * A control the focus never reaches fails the spec, which is the point: it is a control that player could not use.
 */
import type { Page } from "@playwright/test";
import { careCount, expect, savedWorld, test } from "../fixtures";

/** Presses Tab (or Shift+Tab) until the focus is on an element matching `selector`; fails after `max` presses. */
async function tabTo(page: Page, selector: string, opts: { back?: boolean; max?: number } = {}): Promise<void> {
  const max = opts.max ?? 80;
  for (let i = 0; i < max; i++) {
    if (await page.evaluate((s) => !!document.activeElement?.matches(s), selector)) return;
    await page.keyboard.press(opts.back ? "Shift+Tab" : "Tab");
  }
  throw new Error(`the keyboard never reached ${selector} in ${max} presses`);
}

/** Closes whatever dialog greets a new pet, with the keyboard: Enter on the control the dialog gave the focus to. */
async function clearDialogs(page: Page): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const open = await page.locator('[aria-modal="true"]:not(.sheet)').count();
    if (!open) return;
    await page.waitForTimeout(400);
    const inside = await page.evaluate(() => !!document.activeElement?.closest('[aria-modal="true"]'));
    if (!inside) await page.keyboard.press("Tab");
    // a dialog's action buttons (Okay, Lovely, Welcome home) close it; its speech bubble, also a button, only reads on
    await tabTo(page, '[aria-modal="true"]:not(.sheet) .btn');
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
  }
}

const quests = async (page: Page) =>
  ((await savedWorld(page)).quests ?? {}) as { active?: Record<string, unknown>; done?: Record<string, unknown> };

for (const look of [
  { lang: "en", scheme: "light", size: "phone" },
  { lang: "zh", scheme: "dark", size: "desktop" },
] as const) {
  test(`the first ten minutes with the keyboard alone (${look.lang}, ${look.scheme}, ${look.size})`, async ({
    player,
  }) => {
    test.setTimeout(300_000);
    const p = await player(look);
    const { page } = p;
    await page.goto(`${p.web}/play.html`);
    await page.locator(".hatch").waitFor();

    // hatch: an egg, an instinct and a name of the player's own
    await tabTo(page, ".egg:nth-child(2)");
    await page.keyboard.press("Space");
    await expect(page.locator(".egg").nth(1)).toHaveAttribute("aria-checked", "true");
    await tabTo(page, ".instinct");
    await page.keyboard.press("Space");
    await expect(page.locator(".instinct").first()).toHaveAttribute("aria-checked", "true");
    await tabTo(page, "#pet-name");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Kiko");
    await tabTo(page, ".hatch-go");
    await page.keyboard.press("Enter");
    await page.locator(".stage").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1_500);
    await clearDialogs(page);

    // the pet, reached and patted
    const pats = await careCount(page, "pet");
    await tabTo(page, ".pet-button");
    await page.keyboard.press("Enter");
    await expect.poll(() => careCount(page, "pet"), { message: "a pat by the keyboard is a pat" }).toBe(pats + 1);

    // its care: feed (from the bag that Feed opens), clean, sleep and wake
    await tabTo(page, ".act[data-hint=feed]");
    await page.keyboard.press("Enter");
    await page.locator(".sheet").waitFor();
    const fed = await careCount(page, "feed");
    // the bag's first row is a food, and its button feeds it
    await tabTo(page, ".sheet .bag-item .btn");
    // P7g: what the focus was on when Enter went, so a feed that does not land says where the key went
    const pressed = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const row = el?.closest(".bag-item")?.querySelector("b")?.textContent ?? "";
      return `${el?.tagName ?? "nothing"} "${el?.textContent?.trim() ?? ""}" in the row "${row.trim()}"`;
    });
    await page.keyboard.press("Enter");
    await expect
      .poll(() => careCount(page, "feed"), {
        message: `fed by the keyboard (Enter went to ${pressed})`,
      })
      .toBe(fed + 1)
      .catch(async (e: unknown) => {
        const after = await page.evaluate(() => ({
          focus: `${document.activeElement?.tagName ?? ""} "${document.activeElement?.textContent?.trim().slice(0, 40) ?? ""}"`,
          sheet: document.querySelector(".sheet .shead h2")?.textContent ?? "no sheet",
          notes: [...document.querySelectorAll("[role=status], .toast")]
            .map((x) => x.textContent?.trim())
            .filter(Boolean),
          full: document.querySelector('[role=meter][aria-label="Full"]')?.getAttribute("aria-valuenow"),
        }));
        throw new Error(`the feed did not land: ${JSON.stringify(after)}`, { cause: e });
      });
    await page.keyboard.press("Escape");
    await expect(page.locator(".sheet")).toHaveCount(0);
    await clearDialogs(page);
    const cleaned = await careCount(page, "clean");
    await tabTo(page, ".act[data-hint=clean]");
    await page.keyboard.press("Enter");
    await expect.poll(() => careCount(page, "clean"), { message: "cleaned by the keyboard" }).toBe(cleaned + 1);
    const sleepButton = page.locator(".act[data-hint=sleep]");
    const awakeLabel = (await sleepButton.textContent()) ?? "";
    await tabTo(page, ".act[data-hint=sleep]");
    await page.keyboard.press("Enter");
    await expect(sleepButton, "put to sleep: the button now wakes it").not.toHaveText(awakeLabel);
    await page.keyboard.press("Enter");
    await expect(sleepButton, "and woken again").toHaveText(awakeLabel);

    // every sheet the tab bar opens on day one, opened and closed
    for (const tab of ["me", "mind"]) {
      await tabTo(page, `.tab[data-hint=tab-${tab}]`);
      await page.keyboard.press("Enter");
      await page.locator(".sheet").waitFor();
      await page.keyboard.press("Escape");
      await expect(page.locator(".sheet")).toHaveCount(0);
    }

    // the first quest: taken, done with three pats, and handed in
    await tabTo(page, ".pet-quest");
    await page.keyboard.press("Enter");
    const dialog = page.locator(".fam-card.qd");
    await dialog.waitFor();
    const take = p.t("Okay!", "好呀！");
    for (let i = 0; i < 10 && !(await dialog.locator(".btn.primary", { hasText: take }).count()); i++) {
      await tabTo(page, ".qd-bubble");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(200);
    }
    await tabTo(page, ".fam-card.qd .btn.primary");
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => Object.keys((await quests(page)).active ?? {}), { message: "the quest is taken" })
      .toContain("q01");
    for (let i = 0; i < 3; i++) {
      await tabTo(page, ".pet-button");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(400);
    }
    await expect(page.locator(".pet-quest.ready")).toBeVisible();
    await tabTo(page, ".pet-quest.ready");
    await page.keyboard.press("Enter");
    await dialog.waitFor();
    const handIn = p.t("Hand it in", "交任务");
    for (let i = 0; i < 10 && !(await dialog.locator(".btn.primary", { hasText: handIn }).count()); i++) {
      await tabTo(page, ".qd-bubble");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(200);
    }
    await tabTo(page, ".fam-card.qd .btn.primary");
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => Object.keys((await quests(page)).done ?? {}), { message: "the quest is handed in" })
      .toContain("q01");
    await clearDialogs(page);

    // a letter, read
    await tabTo(page, ".mail-btn");
    await page.keyboard.press("Enter");
    await page.locator(".sheet").waitFor();
    await tabTo(page, ".sheet .mail-head");
    await page.keyboard.press("Enter");
    await expect(page.locator(".sheet .mail-item.is-open")).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath(`keyboard-${look.lang}-${look.scheme}-${look.size}.png`) });
    await page.keyboard.press("Escape");
    await expect(page.locator(".sheet")).toHaveCount(0);
  });
}
