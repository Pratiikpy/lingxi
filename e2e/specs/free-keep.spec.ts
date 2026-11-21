/**
 * B9: keeping a pet with no wallet (H4), played before it is switched on for real players. On the fork, sponsoring is
 * on (harness/run.ts). A player who has handed in "First lesson" is offered "Keep … on X Layer, free"; the pet is then
 * owned on chain by a key this browser keeps, and the Pet tab says so, with the risk and the way to a wallet. A second
 * player on the same network that day is told, in their language, that the network has had its free pet.
 */
import { type Page } from "@playwright/test";
import { expect, hatch, sheet, test } from "../fixtures";
import { chainRecord, forkOf, reach } from "../helpers/chain";

/** Marks the story quest "First lesson" (q10) handed in, as a player who had taught one would have it, then reloads. */
async function firstLessonHandedIn(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = JSON.parse(localStorage.getItem("lingxi.world.v1") ?? "{}") as { quests?: { active: Record<string, unknown>; done: Record<string, number> } };
    const book = w.quests ?? { active: {}, done: {} };
    w.quests = { ...book, done: { ...book.done, q10: Date.now() } };
    localStorage.setItem("lingxi.world.v1", JSON.stringify(w));
  });
  await page.reload();
  await page.locator(".stage").waitFor();
}

test("a pet kept free is owned by this browser's key, and the next on the same network is told why not (B9)", async ({ player, run }) => {
  test.setTimeout(600_000);
  const fork = await forkOf(run);
  // the first player, in English on a phone in light: the offer, the keeping, and what the Pet tab says after
  const p = await player({ lang: "en", scheme: "light", size: "phone" });
  await hatch(p, "Momo");
  await firstLessonHandedIn(p.page);
  await sheet(p.page, "me");
  const offer = await reach(p.page, "[data-hint=keep]");
  await expect(offer).toHaveText("Keep Momo on X Layer, free");
  await p.page.screenshot({ path: test.info().outputPath("free-offer-en-light-phone.png") });
  await offer.click();
  await p.page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem("lingxi.chain.v2") ?? "{}") as Record<string, { petId?: string } | null>).some((r) => r && r.petId), undefined, { timeout: 240_000 });
  const record = await chainRecord(p.page);
  expect(record?.device, "kept for this device's key").toBe(true);
  expect((await fork.ownerOf(record!.petId)).toLowerCase(), "owned on chain by that key").toBe(String(record!.owner).toLowerCase());
  await expect(p.page.getByText("Kept on this device")).toBeVisible({ timeout: 60_000 });
  await expect(p.page.getByText("Clearing this browser's data loses the key", { exact: false })).toBeVisible();
  await expect(p.page.getByRole("button", { name: "Move to my wallet" })).toBeVisible();
  await p.page.screenshot({ path: test.info().outputPath("free-kept-en-light-phone.png"), fullPage: true });

  // a second player on the same network that day, in Chinese on a desktop in dark: refused, and told why, free
  const q = await player({ lang: "zh", scheme: "dark", size: "desktop" });
  await hatch(q, "Lulu");
  await firstLessonHandedIn(q.page);
  await sheet(q.page, "me");
  const second = await reach(q.page, "[data-hint=keep]");
  await expect(second).toHaveText("免费把Lulu放上 X Layer");
  await second.click();
  await expect(q.page.locator(".chainpanel .err")).toContainText("你的网络今天已经领过免费宠物了", { timeout: 60_000 });
  expect(await chainRecord(q.page), "nothing was kept, and nothing paid").toBeNull();
  await q.page.screenshot({ path: test.info().outputPath("free-refused-zh-dark-desktop.png") });
});
