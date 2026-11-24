/**
 * Quests, as a player does them. The first story quest is the pet's own: it asks, the player takes it, pats the pet
 * three times and hands it in, and the reward lands in the save. Then today's care daily (one of five, picked from the
 * player's seed and the day): done as it asks and handed in from the quest book. The device's zone is set so it is
 * morning, so every care daily, "feed in the morning" included, can be done whenever the test runs.
 */
import type { Page } from "@playwright/test";
import { DAILIES } from "../../packages/world/src/questline/dailies";
import {
  type Opened,
  dismiss,
  expect,
  hatch,
  patPet,
  playPattern,
  savedWorld,
  tapMoving,
  test,
  zoneWithHour,
} from "../fixtures";

/** the quest book as the world saves it (packages/world story.ts QuestBook) */
type Book = {
  active?: Record<string, unknown>;
  done?: Record<string, number>;
  today?: { day: string; offered: string[]; done: string[] };
};
const book = async (page: Page) => ((await savedWorld(page)).quests ?? {}) as Book;
const coins = async (page: Page) => Number((await savedWorld(page)).coins ?? 0);
const bag = async (page: Page) => ((await savedWorld(page)).bag ?? {}) as Record<string, number>;

/** Steps through the quest dialog's lines until `button` is offered, and presses it. */
async function answer(p: Opened, button: { en: string; zh: string }) {
  const dialog = p.page.locator(".fam-card.qd");
  await dialog.waitFor();
  const go = dialog.locator(".btn.primary", { hasText: p.t(button.en, button.zh) });
  for (let i = 0; i < 8 && !(await go.count()); i++) {
    await dialog.locator(".qd-bubble").click();
    await p.page.waitForTimeout(250);
  }
  await go.click();
}

/** Closes the quest dialog after a hand-in, reading its last lines as a player would. */
async function finish(p: Opened) {
  const dialog = p.page.locator(".fam-card.qd");
  for (let i = 0; i < 8 && (await dialog.count()); i++) {
    const close = dialog.locator(".btn").last();
    if (await close.isVisible()) await close.click();
    else await dialog.locator(".qd-bubble").click();
    await p.page.waitForTimeout(250);
  }
  await dismiss(p.page);
}

/** Does what today's care daily asks. */
async function careFor(p: Opened, index: string) {
  const { page } = p;
  if (index === "pet") for (let i = 0; i < 3; i++) await patPet(page);
  else if (index === "clean") await page.locator("button.act[data-hint=clean]").click();
  else if (index === "sleep") {
    await page.locator("button.act[data-hint=sleep]").click();
    await page.waitForTimeout(800);
    await page.locator("button.act[data-hint=sleep]").click();
  } else if (index === "play") {
    await page.locator("button.act[data-hint=play]").click();
    await playPattern(page);
    await page.locator(".games .btn", { hasText: p.t("Back to the room", "回到房间") }).click();
  } else if (index === "feed-morning") {
    await page.locator("button.act[data-hint=feed]").click();
    await page
      .locator(".sheet .bag-item button", { hasText: p.t("Feed", "喂食") })
      .first()
      .click();
    await page.keyboard.press("Escape");
  } else throw new Error(`no way to do the care daily "${index}"`);
  await dismiss(page);
}

for (const look of [
  { lang: "en", scheme: "light", size: "phone" },
  { lang: "zh", scheme: "dark", size: "desktop" },
] as const) {
  test(`the pet's first quest, taken, done and handed in (${look.lang}, ${look.scheme}, ${look.size})`, async ({
    player,
  }) => {
    const p = await player(look);
    const { page } = p;
    await hatch(p, "Pip");
    const coins0 = await coins(page);
    const item0 = (await bag(page))["11312"] ?? 0;

    await tapMoving(page.locator(".pet-quest"));
    await answer(p, { en: "Okay!", zh: "好呀！" });
    await expect
      .poll(async () => Object.keys((await book(page)).active ?? {}), { message: "the quest is taken" })
      .toContain("q01");

    for (let i = 0; i < 3; i++) await patPet(page);
    await expect(page.locator(".pet-quest.ready"), "the pet says the quest is done").toBeVisible();
    await tapMoving(page.locator(".pet-quest.ready"));
    await answer(p, { en: "Hand it in", zh: "交任务" });
    await expect
      .poll(async () => Object.keys((await book(page)).done ?? {}), { message: "the quest is handed in" })
      .toContain("q01");
    expect(await coins(page), "its ten coins are paid").toBe(coins0 + 10);
    expect((await bag(page))["11312"] ?? 0, "its gift is in the bag").toBe(item0 + 1);
    await finish(p);
    await page.screenshot({ path: test.info().outputPath(`first-quest-${look.lang}-${look.scheme}-${look.size}.png`) });
  });

  test(`today's care daily, done and handed in from the quest book (${look.lang}, ${look.scheme}, ${look.size})`, async ({
    player,
  }) => {
    const p = await player({ ...look, timezoneId: zoneWithHour(7, 10) });
    const { page, t } = p;
    await hatch(p, "Pip");
    await expect
      .poll(async () => (await book(page)).today?.offered.length ?? 0, { message: "today's three are offered" })
      .toBe(3);
    const offered = (await book(page)).today!.offered;
    const care = DAILIES.find((q) => offered.includes(q.id) && q.group === "care");
    expect(care, "one of today's three is a care daily").toBeTruthy();
    const cond = care!.objectives[0]!.cond as { type: string; index?: string };
    expect(cond.type).toBe("CARE");
    const coins0 = await coins(page);

    await careFor(p, String(cond.index));
    await page.locator(`button.pill[aria-label="${t("Things to do", "要做的事")}"]`).click();
    await page.locator(".qb-tab", { hasText: t("Today", "今日") }).click();
    const card = page.locator(".qc-list li").filter({ hasText: care!.title[look.lang] });
    await expect(card.locator(".btn.primary"), "the daily is ready to hand in").toBeVisible();
    await card.locator(".btn.primary").click();
    await answer(p, { en: "Hand it in", zh: "交任务" });
    await expect
      .poll(async () => (await book(page)).today?.done ?? [], { message: "the daily is handed in" })
      .toContain(care!.id);
    expect(await coins(page), "its reward is paid").toBeGreaterThan(coins0);
    await finish(p);
    await page.screenshot({ path: test.info().outputPath(`daily-${look.lang}-${look.scheme}-${look.size}.png`) });
  });
}
