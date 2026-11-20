/**
 * Takes the README's phone images from the live site (A100): each scene is a pet hatched in a fresh phone browser, with
 * every part of the game opened (the player's own "open everything" choice), walked to one screen; four scenes are set
 * side by side in phone frames, at the size the README's images share (2364 x 1216). Run with `pnpm readme:phones`
 * after a screen they show changes, so the README never shows wording or names the game no longer has.
 */
import { join } from "node:path";
import { recordShots } from "./lib/sites.mts";
import { type Browser, type Page, chromium } from "@playwright/test";

const SITE = process.env.LINGXI_SITE ?? "https://lingxi.knole.me";
const out = join(import.meta.dirname, "..", "docs", "readme");

type Scene = { lang: "en" | "zh"; scheme: "light" | "dark"; go: (page: Page) => Promise<void> };

const settle = (page: Page, ms = 700) => page.waitForTimeout(ms);
const closeAll = async (page: Page) => {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Escape");
    await settle(page, 250);
  }
};
const tab = async (page: Page, name: string) => {
  await closeAll(page);
  await page.locator(`.tab[data-hint=tab-${name}]`).click();
  await page.locator(".sheet").waitFor();
  await settle(page, 900);
};
/** scrolls the open sheet so `text` sits near its top */
const sheetTo = async (page: Page, text: RegExp) => {
  const target = page.locator(".sheet").getByText(text).first();
  // panels lower in a sheet are drawn as it is scrolled to them
  for (let i = 0; i < 120 && !(await target.count()); i++) {
    await page.mouse.move(195, 600);
    // in steps a lazily drawn panel cannot be skipped over
    await page.mouse.wheel(0, 300);
    await settle(page, 300);
  }
  await target.waitFor({ state: "attached", timeout: 30_000 });
  await target.waitFor({ timeout: 30_000 });
  await target.evaluate((el) => el.scrollIntoView({ block: "start", inline: "nearest" }));
  await settle(page, 600);
};

const PLAY: Scene[] = [
  { lang: "en", scheme: "light", go: async () => {} },
  { lang: "en", scheme: "light", go: async (page) => {
    await page.getByRole("button", { name: "See its circuit" }).click();
    await settle(page, 1200);
  } },
  { lang: "en", scheme: "light", go: async (page) => {
    await tab(page, "mind");
    await sheetTo(page, /An instinct from a circuit you own/i);
  } },
  { lang: "en", scheme: "light", go: async (page) => {
    await tab(page, "spar");
    await page.getByRole("button", { name: /Pip the Pouncer/ }).click();
    await page.getByText(/ won$| won\b|wins!/).first().waitFor({ timeout: 180_000 });
    await settle(page, 1200);
  } },
];
const WORLD: Scene[] = [
  { lang: "en", scheme: "light", go: async (page) => {
    await closeAll(page);
    // the quest book, from the header's pill
    await page.getByRole("button", { name: "Things to do" }).click();
    await page.locator(".sheet").waitFor();
    await settle(page, 900);
  } },
  { lang: "en", scheme: "light", go: async (page) => {
    await tab(page, "map");
  } },
  { lang: "en", scheme: "light", go: async (page) => {
    await tab(page, "me");
    // the pet's details are drawn as the sheet is scrolled to them
    const skills = page.locator(".lv-skills");
    for (let i = 0; i < 120 && !(await skills.count()); i++) {
      await page.mouse.move(195, 600);
      // in steps a lazily drawn panel cannot be skipped over
      await page.mouse.wheel(0, 300);
      await settle(page, 300);
    }
    // its part of the game loads as it is reached
    await skills.waitFor({ state: "attached", timeout: 30_000 });
    // only up and down: the sheet must not shift sideways
    await skills.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
    await settle(page, 500);
    await skills.click();
    await page.getByRole("heading", { name: "Mochi's skills" }).waitFor();
    await settle(page, 900);
  } },
  { lang: "en", scheme: "light", go: async (page) => {
    await tab(page, "bag");
  } },
];
const CHAIN: Scene[] = [
  { lang: "en", scheme: "dark", go: async (page) => {
    await tab(page, "me");
    await sheetTo(page, /^Item shop$/i);
    await settle(page, 2500);
  } },
  { lang: "en", scheme: "dark", go: async (page) => {
    await tab(page, "me");
    await sheetTo(page, /^Adoption centre$/i);
    await settle(page, 2500);
  } },
  { lang: "zh", scheme: "dark", go: async () => {} },
  { lang: "zh", scheme: "dark", go: async (page) => {
    await tab(page, "map");
  } },
];

async function shot(browser: Browser, s: Scene): Promise<string> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: s.scheme });
  await ctx.addInitScript((lang) => {
    localStorage.setItem("lingxi.lang", lang);
    localStorage.setItem("lingxi.reveal.v1", "1");
  }, s.lang);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  try {
    await page.goto(`${SITE}/play.html`);
    await page.locator(".hatch").waitFor({ timeout: 60_000 });
    await page.fill("#pet-name", s.lang === "zh" ? "小米" : "Mochi");
    await page.click(".hatch-go");
    await page.locator(".stage").waitFor();
    // the start-up notices come and go before a shot is taken
    await settle(page, 6_000);
    await closeAll(page);
    await s.go(page);
    if (errors.length) throw new Error(`console errors, no shot taken: ${errors.join("; ")}`);
    return (await page.screenshot()).toString("base64");
  } finally {
    await ctx.close();
  }
}

const FRAMED = (shots: string[], dark: boolean) => `<!doctype html><html><head><style>
  html, body { margin: 0; width: 2364px; height: 1216px; background: ${dark ? "#1d1730" : "#fff4df"}; }
  .row { display: flex; gap: 46px; padding: 46px 52px 0; }
  .phone { width: 532px; height: 1150px; border-radius: 64px; background: #2a2140; padding: 14px; box-sizing: border-box;
    box-shadow: 0 24px 60px rgba(20, 12, 40, ${dark ? "0.6" : "0.28"}); }
  .phone img { width: 504px; height: 1122px; object-fit: cover; object-position: top; border-radius: 52px; display: block; }
</style></head><body><div class="row">${shots.map((s) => `<div class="phone"><img src="data:image/png;base64,${s}"></div>`).join("")}</div></body></html>`;

const browser = await chromium.launch();
try {
  for (const [file, scenes] of [["play.png", PLAY], ["world.png", WORLD], ["chain.png", CHAIN]] as const) {
    const shots: string[] = [];
    for (const s of scenes) shots.push(await shot(browser, s));
    const frame = await browser.newPage({ viewport: { width: 2364, height: 1216 }, deviceScaleFactor: 1 });
    await frame.setContent(FRAMED(shots, scenes.every((s) => s.scheme === "dark")));
    await frame.waitForTimeout(300);
    await frame.screenshot({ path: join(out, file) });
    await frame.close();
    process.stdout.write(`docs/readme/${file} taken from ${SITE}\n`);
  }
} finally {
  await browser.close();
}
// which live build these images show, for the status check (A100)
await recordShots(join(import.meta.dirname, ".."), SITE, ["play.png", "world.png", "chain.png"]);
