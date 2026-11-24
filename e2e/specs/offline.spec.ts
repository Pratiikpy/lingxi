/**
 * A dropped connection while the game loads: the part of the game a page loads on demand never arrives. The page
 * reloads once, in case a new build went live (boot/staleBuild.ts), then says plainly that Lingxi couldn't load and
 * that the save is fine (play/LoadFailed.tsx): never a blank page, never a reload loop. Once the connection is back,
 * Reload opens the game, and a returning player's pet is there as it was. Played on the site as released and served for
 * players, since only a build reloads for a new one; the save is read in storage.
 */
import { rmSync } from "node:fs";
import { type Page } from "@playwright/test";
import { dismiss, expect, liveHatch, type Opened, test } from "../fixtures";
import { currentRun } from "../harness/run";
import { buildSite, expectedErrors, petOf, serveSite, siteFolder } from "../helpers/browser";

/** The part of the game loaded on demand (play/main.tsx imports PlayApp once the tab holds the game). */
const PART = "**/assets/PlayApp-*.js";
const DROPPED = /Failed to load resource: net::ERR_INTERNET_DISCONNECTED/;

let site: { url: string; stop: () => void } | null = null;
let folder = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const run = currentRun();
  const f = siteFolder(run, "offline");
  folder = f.site;
  await buildSite(run, f.site, "A");
  site = await serveSite(f.site);
});

test.afterAll(() => {
  site?.stop();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

/** Drops the connection for the game's part: every request for it fails as a dropped connection does. */
async function dropTheConnection(p: Opened): Promise<{ dropped: () => number; back: () => Promise<void> }> {
  let n = 0;
  await p.ctx.route(PART, (r) => {
    n++;
    return r.abort("internetdisconnected");
  });
  return { dropped: () => n, back: () => p.ctx.unroute(PART) };
}

/** Counts the times a page loads. */
function loadsOf(page: Page): () => number {
  let n = 0;
  page.on("load", () => n++);
  return () => n;
}

/** The plain message, once the page has had time to loop if it were going to (a reload takes well under a second here). */
async function couldNotLoad(page: Page, loads: () => number): Promise<string> {
  await page.locator("#load-failed-title").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(3_000);
  expect(loads(), "one reload, then a plain message: never a blank page or a loop").toBe(2);
  return page.locator(".save-card").innerText();
}

test("a first visit whose game never arrives says so, then plays once connected (en, light, phone)", async ({
  player,
}) => {
  const p = await player({ lang: "en", scheme: "light", size: "phone" });
  const { page } = p;
  const loads = loadsOf(page);
  const net = await dropTheConnection(p);
  await page.goto(`${site!.url}/play.html`);
  const said = await couldNotLoad(page, loads);
  expect(said, "it says what happened").toContain("Lingxi couldn't load");
  expect(said, "and that nothing is lost").toContain("Your pets and your save are fine");
  expect(await page.evaluate(() => localStorage.getItem("lingxi.pets.v2")), "nothing was written").toBeNull();
  await page.screenshot({ path: test.info().outputPath("couldnt-load-en-light.png") });
  await expectedErrors(p, DROPPED, net.dropped());

  // the connection is back: Reload, and the game opens
  await net.back();
  await page.locator(".save-btn.primary", { hasText: "Reload" }).click();
  await liveHatch(page);
  await page.fill("#pet-name", "Pip");
  await page.click(".hatch-go");
  await page.locator(".stage").waitFor();
  expect((await petOf(page))?.name, "and plays: a pet hatches").toBe("Pip");
});

test("a returning player's pet is safe through a dropped connection (zh, dark, phone)", async ({ player }) => {
  const p = await player({ lang: "zh", scheme: "dark", size: "phone" });
  const { page } = p;
  await page.goto(`${site!.url}/play.html`);
  await liveHatch(page);
  await page.fill("#pet-name", "团团");
  await page.click(".hatch-go");
  await page.locator(".stage").waitFor();
  await page.waitForTimeout(1_200);
  await dismiss(page);
  const pet = (await petOf(page))!;

  const loads = loadsOf(page);
  const net = await dropTheConnection(p);
  await page.reload();
  const said = await couldNotLoad(page, loads);
  expect(said, "it says what happened, in Chinese").toContain("灵犀没能加载");
  expect(said, "and that nothing is lost").toContain("你的宠物和存档都好好的");
  const kept = await petOf(page);
  expect([kept?.name, kept?.bornAt], "the save still holds the pet").toEqual([pet.name, pet.bornAt]);
  await page.screenshot({ path: test.info().outputPath("couldnt-load-zh-dark.png") });
  await expectedErrors(p, DROPPED, net.dropped());

  await net.back();
  await page.locator(".save-btn.primary", { hasText: "重新加载" }).click();
  await page.locator(".stage").waitFor({ timeout: 60_000 });
  const back = await petOf(page);
  expect([back?.name, back?.bornAt], "once connected, the same pet is in its room").toEqual([pet.name, pet.bornAt]);
});
