/**
 * One tab plays the game. A second tab says the game is open elsewhere and writes nothing, so a gift taken in the
 * first is never lost to the stale second; "Play here" moves the game to it, with the gift, and the first stops at
 * once. With Web Locks and without them (older Safari, some in-app browsers), where a lease stands in: reloads keep
 * the game in its tab, a second tab yields, and the lease of a page that died without a word is taken over. The save
 * and the lease are read in storage, not only on screen.
 */
import { type Page } from "@playwright/test";
import { type Opened, dismiss, expect, hatch, test } from "../fixtures";
import { NO_LOCKS, bagOf, petOf, storedJson } from "../helpers/browser";

const LEASE = "lingxi.writer.lease";
const playHere = (page: Page) => page.locator("button", { hasText: /^(Play here|在这里玩)$/ });
/** Whichever the page shows first once it has decided: the game, or "open in another tab". */
async function decided(page: Page): Promise<"game" | "elsewhere"> {
  await page.locator(".stage").or(playHere(page)).first().waitFor({ timeout: 30_000 });
  return (await page.locator(".stage").count()) ? "game" : "elsewhere";
}
const hasLocks = (page: Page) => page.evaluate(() => "locks" in navigator && !!navigator.locks);

for (const { mode, look } of [
  { mode: "Web Locks", look: { lang: "en", scheme: "light", size: "phone" } },
  { mode: "a lease", look: { lang: "zh", scheme: "dark", size: "phone" } },
] as const) {
  test(`a gift taken in one tab is never lost to a stale second tab, with ${mode} (${look.lang}, ${look.scheme}, ${look.size})`, async ({ player }) => {
    const p = await player({ ...look, init: mode === "a lease" ? NO_LOCKS : "" });
    const { page: a, t } = p;
    await a.goto(`${p.web}/play.html`);
    await a.locator(".hatch").waitFor({ timeout: 60_000 });
    expect(await hasLocks(a), `the browser ${mode === "Web Locks" ? "has" : "lacks"} Web Locks`).toBe(mode === "Web Locks");
    await a.fill("#pet-name", "Kiri");
    await a.click(".hatch-go");
    await a.locator(".stage").waitFor();
    await a.waitForTimeout(2_000);
    await dismiss(a);

    // a second tab on the same browser must not play
    const b = await p.ctx.newPage();
    await b.goto(`${p.web}/play.html`);
    await b.locator(".save-screen").waitFor({ timeout: 20_000 });
    await expect(b.locator(".save-card h1"), "a second tab says the game is open elsewhere").toContainText(t("open in another tab", "另一个标签页"));
    await b.screenshot({ path: test.info().outputPath(`elsewhere-${look.lang}.png`) });

    // the first tab takes a gift from the mail
    const before = JSON.stringify(await bagOf(a));
    await a.locator(".mail-btn").click();
    await a.locator(".mail-item").first().waitFor({ timeout: 20_000 });
    const gift = a.locator(".mail-head", { hasText: t("gift", "礼物") }).first();
    await expect(gift, "a letter carries a gift").toBeVisible();
    await gift.click();
    const take = a.locator(".mail-body .btn.primary").first();
    await expect(take).toBeEnabled();
    await take.click();
    await expect.poll(async () => JSON.stringify(await bagOf(a)), { message: "the first tab took the gift and saved it" }).not.toBe(before);
    const withGift = JSON.stringify(await bagOf(a));

    // the stale tab, sitting open, writes nothing over it
    await b.waitForTimeout(1_500);
    expect(JSON.stringify(await bagOf(a)), "the stale tab wrote nothing over the gift").toBe(withGift);

    // "Play here": the game moves to the second tab, gift and all; the first stops at once
    const stampBefore = await storedJson<{ id: string }>(a, LEASE);
    await b.locator(".save-btn.primary").click();
    await b.locator(".stage").waitFor({ timeout: 30_000 });
    expect(JSON.stringify(await bagOf(b)), "'Play here' moves the game, and the gift is there").toBe(withGift);
    await a.locator(".save-overlay").waitFor({ timeout: 10_000 });
    await expect(a.locator(".save-overlay"), "the first tab shows the game is now open elsewhere").toBeVisible();
    await a.screenshot({ path: test.info().outputPath(`overlay-${look.lang}.png`) });
    const stampAfter = await storedJson<{ id: string }>(a, LEASE);
    expect(stampAfter?.id, "the stamp names the new tab").toBeTruthy();
    expect(stampAfter?.id, "and no longer the first").not.toBe(stampBefore?.id);
  });
}

/** Hatches a pet in a browser without Web Locks. */
async function hatchedWithoutLocks(p: Opened): Promise<void> {
  await hatch(p, "Pip");
  expect(await hasLocks(p.page), "no Web Locks in this browser").toBe(false);
}

for (const look of [
  { lang: "en", scheme: "light", size: "phone" },
  { lang: "zh", scheme: "dark", size: "desktop" },
] as const) {
  test(`without Web Locks, reloads keep the game in its tab (${look.lang}, ${look.scheme}, ${look.size})`, async ({ player }) => {
    const p = await player({ ...look, init: NO_LOCKS });
    const { page } = p;
    await hatchedWithoutLocks(p);
    await page.locator("button.act[data-hint=feed]").click();
    await page.waitForTimeout(1_500);
    const before = await petOf(page);
    for (const n of [1, 2]) {
      const t0 = Date.now();
      await page.reload();
      expect(await decided(page), `reload ${n}: the game stays in the tab (${((Date.now() - t0) / 1000).toFixed(1)} s)`).toBe("game");
    }
    await page.waitForTimeout(800);
    await dismiss(page);
    const after = await petOf(page);
    await page.screenshot({ path: test.info().outputPath(`after-reloads-${look.lang}.png`) });
    expect(after?.bornAt, "the same pet").toBe(before?.bornAt);
    expect(after?.meters.food ?? -1, "its care kept").toBeGreaterThanOrEqual((before?.meters.food ?? 0) - 50);
  });
}

test("without Web Locks, a second tab yields to the first (en, dark, desktop)", async ({ player }) => {
  const p = await player({ lang: "en", scheme: "dark", size: "desktop", init: NO_LOCKS });
  await hatchedWithoutLocks(p);
  const second = await p.ctx.newPage();
  await second.goto(`${p.web}/play.html`);
  expect(await decided(second), "a second tab, with the first open, says the game is open elsewhere").toBe("elsewhere");
  await second.screenshot({ path: test.info().outputPath("second-tab-en.png") });
  await p.page.waitForTimeout(4_000);
  expect(await p.page.locator(".stage").count(), "the first tab still plays").toBe(1);
  expect(await playHere(p.page).count(), "and is not told the game is elsewhere").toBe(0);
});

test("without Web Locks, a dead page's lease is taken over (zh, light, phone)", async ({ player }) => {
  const p = await player({ lang: "zh", scheme: "light", size: "phone", init: NO_LOCKS });
  await hatchedWithoutLocks(p);
  await p.page.close();
  // a page that died without a word: its lease is fresh, but nobody renews it
  const page = await p.ctx.newPage();
  await page.goto(`${p.web}/index.html`);
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ id: "dead-page", until: Date.now() + 6_000 })), LEASE);
  const t0 = Date.now();
  await page.goto(`${p.web}/play.html`);
  const shown = await decided(page);
  const took = (Date.now() - t0) / 1000;
  await page.screenshot({ path: test.info().outputPath("took-over-zh.png") });
  expect(shown, `a dead page's lease is taken over and the game opens (${took.toFixed(1)} s)`).toBe("game");
  expect(took, "within the watch (about 3 s) plus loading").toBeLessThan(12);
  const lease = await storedJson<{ id: string }>(page, LEASE);
  expect(lease?.id, "the lease is now this page's").toBeTruthy();
  expect(lease?.id).not.toBe("dead-page");
});
