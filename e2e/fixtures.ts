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
  /** the device's time zone (the pet keeps its owner's local day and hour) */
  timezoneId?: string;
  /** the player has asked the system for less motion */
  reducedMotion?: boolean;
}

export const test = base.extend<{ run: Run; player: (o?: PlayerOptions) => Promise<Opened> }>({
  // eslint-disable-next-line no-empty-pattern
  run: async ({}, use) => use(currentRun()),
  player: async ({ browser, run }, use) => {
    const opened: Opened[] = [];
    await use(async (o = {}) => {
      const look: Look = { lang: o.lang ?? "en", scheme: o.scheme ?? "light", size: o.size ?? "phone" };
      const ctx = await browser.newContext({ viewport: SIZES[look.size], colorScheme: look.scheme, locale: look.lang === "zh" ? "zh-CN" : "en-US", ...(o.timezoneId ? { timezoneId: o.timezoneId } : {}), ...(o.reducedMotion ? { reducedMotion: "reduce" as const } : {}) });
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

/** The world's save: bag, coins, quests, tallies. */
export const savedWorld = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("lingxi.world.v1") ?? "{}") as Record<string, unknown>);

/** How many times the save has counted a care action ("pet", "feed", …) for the pet on screen. */
export const careCount = async (page: Page, kind: string): Promise<number> => {
  const tally = ((await savedWorld(page)).tally ?? {}) as Record<string, number>;
  return Object.entries(tally).filter(([k]) => k.startsWith(`CARE:${kind}:`) || k === `CARE:${kind}`).reduce((n, [, v]) => n + v, 0);
};

/**
 * Pats the pet: a tap on the pet in the room's picture (a 128-pixel room scaled to cover its box, the pet standing at
 * (64, 104) when no visitor has moved it aside), then waits for the save to count it.
 */
export async function patPet(page: Page): Promise<void> {
  const box = (await page.locator(".room-scene").boundingBox())!;
  const scale = Math.max(1, Math.ceil(Math.max(box.width, box.height) / 128));
  const left = box.x + Math.round((box.width - 128 * scale) / 2);
  const top = box.y + Math.round((box.height - 128 * scale) / 2);
  const before = await careCount(page, "pet");
  await page.mouse.click(left + 64 * scale, top + (104 - 8) * scale);
  await expect.poll(() => careCount(page, "pet"), { message: "the pat is counted in the save" }).toBe(before + 1);
}

/** A time zone where the hour now is between `from` and `to` (the pet's day follows its owner's zone). */
export function zoneWithHour(from: number, to: number): string {
  for (let h = -10; h <= 14; h++) {
    const hour = (new Date().getUTCHours() + h + 24) % 24;
    if (hour >= from && hour < to) return h === 0 ? "UTC" : `Etc/GMT${h > 0 ? "-" : "+"}${Math.abs(h)}`;
  }
  throw new Error(`no zone has an hour between ${from} and ${to} now`);
}

/**
 * The lights the pattern game shows, in order, read as a player watches them: each pad that lights while the pads are
 * closed to input, counted the moment it lights. Resolves when the pads open for the player's turn.
 */
const watchPattern = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const pads = () => [...document.querySelectorAll<HTMLButtonElement>(".pads .pad")];
        const seen: number[] = [];
        let showing = false;
        const settle = () => {
          const ps = pads();
          const now = ps.length > 0 && ps[0]!.disabled;
          if (showing && !now) {
            watcher.disconnect();
            resolve(seen);
          }
          showing = now;
        };
        const watcher = new MutationObserver((records) => {
          settle();
          for (const r of records) {
            const el = r.target as HTMLButtonElement;
            const lit = el.classList?.contains("pad") && el.classList.contains("lit") && !(r.oldValue ?? "").split(" ").includes("lit");
            if (r.attributeName === "class" && lit && showing) seen.push(pads().indexOf(el));
          }
        });
        watcher.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class", "disabled"], attributeOldValue: true });
        settle();
      }),
  );

/**
 * Plays "Follow the Pattern" from the games sheet as a player does: watches the lights and repeats them for two rounds,
 * then misses on the third, so the game ends with a score of 2.
 */
export async function playPattern(page: Page): Promise<void> {
  await page.locator(".game-card").nth(1).click();
  for (let round = 1; round <= 3; round++) {
    const shown = await watchPattern(page);
    expect(shown.length, `round ${round} shows ${round} lights`).toBe(round);
    if (round < 3) for (const k of shown) await page.locator(".pads .pad").nth(k).click();
    else await page.locator(".pads .pad").nth((shown[0]! + 1) % 4).click();
  }
  await page.locator(".game-result").waitFor();
}

/** The pet on screen, as the save holds it. */
export const savedPet = (page: Page) =>
  page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem("lingxi.pets.v2") ?? "null") as { pets: Array<Record<string, unknown>>; active: number } | null;
    return r ? (r.pets[r.active] ?? null) : null;
  });
