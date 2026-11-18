/**
 * What every spec plays with: the run the harness started, and fresh players. A player is a new browser (no save, no
 * wallet beyond the test one its game signs with) in a language, a colour scheme and a size; every page it opens is
 * watched, and any console error or page error fails the test that made it.
 */
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { currentRun, type Run } from "./harness/run";

export { expect };

export type Lang = "en" | "zh";
export interface Look {
  lang: Lang;
  scheme: "light" | "dark";
  size: "phone" | "desktop";
}
const SIZES = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } } as const;

/** A returning player's browser: the rules already seen and a few badges, so first-visit hints do not cover the room. */
const RETURNING =
  "localStorage.setItem('lingxi.reveal.v1','1'); if (!localStorage.getItem('lingxi.badges.v1')) localStorage.setItem('lingxi.badges.v1', JSON.stringify({ pets: 1, care: 60, feed: 31, play: 31, clean: 21, petting: 51, rooms: 1, rooms_seen: [65] }));";

export interface Opened {
  ctx: BrowserContext;
  page: Page;
  /** the game this player's wallet signs in */
  web: string;
  look: Look;
  /** console and page errors seen on any page of this player */
  errors: string[];
  /** "en" or "zh" text, by this player's language */
  t: (en: string, zh: string) => string;
}

export interface PlayerOptions extends Partial<Look> {
  /** which test wallet's game to open (0 or 1) */
  wallet?: number;
  /** a returning player's seen hints (default) or a first visit */
  firstVisit?: boolean;
  /** extra script run before the page's own */
  init?: string;
}

export const test = base.extend<{ run: Run; player: (o?: PlayerOptions) => Promise<Opened> }>({
  // eslint-disable-next-line no-empty-pattern
  run: async ({}, use) => use(currentRun()),
  player: async ({ browser, run }, use) => {
    const opened: Opened[] = [];
    await use(async (o = {}) => {
      const look: Look = { lang: o.lang ?? "en", scheme: o.scheme ?? "light", size: o.size ?? "phone" };
      const ctx = await browser.newContext({ viewport: SIZES[look.size], colorScheme: look.scheme, locale: look.lang === "zh" ? "zh-CN" : "en-US" });
      // pages the game opens start as about:blank, where storage is off-limits: the setup runs on the game's pages only
      await ctx.addInitScript(`if (location.protocol.startsWith("http")) { ${o.firstVisit ? "" : RETURNING} localStorage.setItem('lingxi.lang', '${look.lang}'); ${o.init ?? ""} }`);
      const errors: string[] = [];
      const watch = (p: Page) => {
        p.on("console", (m) => m.type() === "error" && errors.push(`${p.url().split("/").pop()}: ${m.text().slice(0, 200)}`));
        p.on("pageerror", (e) => errors.push(`${p.url().split("/").pop()}: ${e.message.slice(0, 200)}`));
      };
      ctx.on("page", watch);
      const page = await ctx.newPage();
      const web = run.players[o.wallet ?? 0]!.web;
      const me: Opened = { ctx, page, web, look, errors, t: (en, zh) => (look.lang === "zh" ? zh : en) };
      opened.push(me);
      return me;
    });
    for (const o of opened) await o.ctx.close();
    for (const o of opened) expect(o.errors, `console errors (${o.look.lang}, ${o.look.scheme}, ${o.look.size})`).toEqual([]);
  },
});

/** Closes whatever welcome or notice is open over the room, as a player would. */
export async function dismiss(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    if (await page.locator(".fam-modal").count()) await page.locator(".fam-modal button").last().click();
    else if (await page.locator(".welcome-card").count()) await page.locator(".welcome-card .btn").last().click();
    else return;
    await page.waitForTimeout(300);
  }
}

/** Opens the game and hatches a pet called `name`. */
export async function hatch(p: Opened, name = "Pip"): Promise<void> {
  await p.page.goto(`${p.web}/play.html`);
  await p.page.locator(".hatch").waitFor({ timeout: 60_000 });
  await p.page.fill("#pet-name", name);
  await p.page.click(".hatch-go");
  await p.page.locator(".stage").waitFor();
  await p.page.waitForTimeout(1_200);
  await dismiss(p.page);
}

/** Opens one of the bottom tabs' sheets ("me", "bag", "mind", …). */
export async function sheet(page: Page, tab: string): Promise<void> {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.locator(`.tab[data-hint=tab-${tab}]`).click();
  await page.locator(".sheet").waitFor();
  await page.waitForTimeout(600);
}

/** The pet on screen, as the save holds it. */
export const savedPet = (page: Page) =>
  page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem("lingxi.pets.v2") ?? "null") as { pets: Array<Record<string, unknown>>; active: number } | null;
    return r ? (r.pets[r.active] ?? null) : null;
  });
