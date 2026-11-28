/**
 * `pnpm screens:inventory [--live] [--only name,name] [--looks 360-dark-zh,land-light-en]`: P6's screen inventory.
 * Every screen and state of the game and every page, at 360, 390, landscape and desktop, light and dark, English and
 * Chinese, one contact sheet per screen (all sixteen looks side by side) so a person reviews each screen in one look,
 * against 28-UX-MOTION-FEEL section 1. `--looks` keeps only the named looks, for working on one screen quickly.
 *
 * R35 took it past each screen's first view: every sheet paged through to its end (`sheet-<tab>-p2` onwards, the last
 * page being the sheet at its very bottom; a look whose sheet fits on one screen has no pages), the Pet sheet with its
 * "more" opened and the Mind sheet with its sandbox opened, paged the same way from there, the room's popups
 * (mail, the "!" quest, Decorate, skills, the quest book, the collection), each mini-game's first screen, and the room
 * by day, at dusk and at night. The game reads the time of day from its clock's local hour, so those three run in a
 * browser whose time zone puts the hour there (`room-day`, `room-dusk`, `room-night`): the game's own code draws them.
 *
 * By default it runs the built site (apps/web/dist) from a plain file server whose API answers nothing, which shows
 * the states a player sees with the server unreachable; `--live` runs the live site, with its server. Loading states
 * are held open by answering the API late, and the Mind sheet's (whose one wait is its lessons' code, R33) by sending
 * that code late; offline is the browser set offline after the game has loaded once.
 * Writes ../audit-<date>/inventory/<screen>.png and raw/<screen>/<look>.png, and lists any page error per look.
 *
 * R75: every context it opens routes the server's paid calls (voice, teach, tapeout, sponsor: paidRoutes.mts) to
 * nothing, so no run ever pays for anything, on the live site or off it; each one blocked is listed in blocked.txt.
 * `--dist <folder>` serves another build than apps/web/dist, and `--out <folder>` writes somewhere other than the
 * day's audit folder, so a check of one's own build overwrites neither the shared build nor a review's evidence.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { type ServerResponse, createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, type BrowserContext, type Page, chromium } from "@playwright/test";
import { LINGXI_SITE } from "../packages/chain/src/site.ts";
import { isPaid } from "./paidRoutes.mts";

const root = join(import.meta.dirname, "..");
const live = process.argv.includes("--live");
const onlyAt = process.argv.indexOf("--only");
const only = onlyAt > 0 ? new Set((process.argv[onlyAt + 1] ?? "").split(",")) : null;
const looksAt = process.argv.indexOf("--looks");
const looksOnly = looksAt > 0 ? new Set((process.argv[looksAt + 1] ?? "").split(",")) : null;
// the folder is named for the local date: in UTC, a run after midnight here wrote into the day before's folder
const day = new Date().toLocaleDateString("sv-SE");
const flag = (name: string): string | null => {
  const at = process.argv.indexOf(name);
  return at > 0 ? (process.argv[at + 1] ?? null) : null;
};
const out = resolve(flag("--out") ?? join(root, "..", `audit-${day}`, "inventory"));
const distDir = resolve(flag("--dist") ?? join(root, "apps", "web", "dist"));
/** the paid calls the runs asked for, each routed to nothing */
const blocked: string[] = [];

const SIZES = {
  "360": { width: 360, height: 740 },
  "390": { width: 390, height: 844 },
  land: { width: 844, height: 390 },
  desk: { width: 1280, height: 800 },
} as const;
type Look = { size: keyof typeof SIZES; scheme: "light" | "dark"; lang: "en" | "zh" };
const LOOKS: Look[] = (Object.keys(SIZES) as Array<keyof typeof SIZES>).flatMap((size) =>
  (["light", "dark"] as const).flatMap((scheme) => (["en", "zh"] as const).map((lang) => ({ size, scheme, lang }))),
);
const tag = (l: Look) => `${l.size}-${l.scheme}-${l.lang}`;
/**
 * `--measure`: after each shot, every visible text's contrast against what is behind it and every control's real
 * touch extent, the failures written to measure.txt. Contrast is the text's colour, faded by its own and its
 * ancestors' opacity, over the nearest backgrounds composited down to an opaque one (text over a picture or a
 * gradient is listed as unmeasured, for the eye); 4.5:1, or 3:1 for large text. A control's touch extent is measured
 * by hit-testing outward from its middle, so a touch area drawn wider than the control (a pseudo-element) counts, and
 * a neighbour drawn over it does not. Plain JavaScript in a string: the page gets it as written.
 */
const measure = process.argv.includes("--measure");
const MEASURE = `(() => {
  const out = [];
  const W = innerWidth, H = innerHeight;
  // rgb()/rgba(), or color(srgb r g b / a) with channels from 0 to 1, which is how a color-mix() comes back
  const rgba = (s) => { const k = s.startsWith("color(srgb") ? 255 : 1; const m = s.replace("color(srgb", "").match(/[\\d.]+/g) || ["0","0","0","0"]; return [m[0] * k, m[1] * k, m[2] * k, m[3] === undefined ? 1 : +m[3]]; };
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const shown = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W) return null; const cs = getComputedStyle(el); if (cs.visibility !== "visible" || cs.clip === "rect(0px, 0px, 0px, 0px)" || cs.clipPath === "inset(50%)") return null; if (el.closest("details:not([open]) > :not(summary)")) return null; return r; };
  const ontop = (el, r) => { const x = Math.min(W - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(H - 1, Math.max(0, r.top + r.height / 2)); const hit = document.elementFromPoint(x, y); return !!hit && (el.contains(hit) || hit.contains(el)); };
  const page = [document.body, document.documentElement].map((e) => rgba(getComputedStyle(e).backgroundColor)).find((c) => c[3] === 1) || [255, 255, 255, 1];
  const name = (el) => (el.getAttribute("aria-label") || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 40);
  const where = (el) => el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/).join(".") : "");
  for (const el of document.querySelectorAll("body *")) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = shown(el); if (!r || !ontop(el, r)) continue;
    const cs = getComputedStyle(el);
    // a glyph drawn by its outline (an empty star) is a picture of a shape, for the eye
    if (parseFloat(cs.webkitTextStrokeWidth) > 0) continue;
    let fg = rgba(cs.color), fade = 1, bg = null, picture = false;
    for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
      const s = getComputedStyle(a); fade *= +s.opacity;
      if (!bg || bg[3] < 1) {
        if (s.backgroundImage !== "none" && !bg) { picture = true; break; }
        const c = rgba(s.backgroundColor);
        if (c[3] > 0) bg = bg ? over(bg, c) : c;
      }
    }
    // nothing that is not there to read: text behind a picture is for the eye, text all but faded out is coming or going
    if (picture || fade < 0.1) continue;
    if (!bg || bg[3] < 1) bg = over(bg || [0, 0, 0, 0], page);
    const seen = over([fg[0], fg[1], fg[2], fg[3] * fade], bg);
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const got = ratio(seen, bg);
    if (got < need - 0.005) out.push("contrast " + got.toFixed(2) + " < " + need + (fade < 1 ? " (faded to " + fade.toFixed(2) + ")" : "") + " \\"" + name(el) + "\\" " + where(el) + " " + Math.round(size) + "px");
  }
  for (const el of document.querySelectorAll("button, a[href], [role=button], [role=tab], input, select, summary")) {
    const r = shown(el); if (!r || !ontop(el, r)) continue;
    // a link inside a sentence is sized by its sentence, and a control drawn for show takes no tap at all
    if (el.tagName === "A" && getComputedStyle(el).display === "inline") continue;
    if (getComputedStyle(el).pointerEvents === "none") continue;
    // a control partly scrolled out of its box or off the screen is measured on the page that shows it whole
    let cut = r.top < 0 || r.left < 0 || r.bottom > H || r.right > W;
    for (let a = el.parentElement; a && !cut; a = a.parentElement) {
      if (getComputedStyle(a).overflow === "visible") continue;
      const b = a.getBoundingClientRect();
      cut = r.top < b.top - 1 || r.left < b.left - 1 || r.bottom > b.bottom + 1 || r.right > b.right + 1;
    }
    if (cut) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    // a box or a switch inside its label is tapped anywhere on the label: the label is its target
    const parts = [el, ...(el.labels || [])];
    if (parts.length > 1) { const u = parts.map((p) => p.getBoundingClientRect()); const w = Math.max(...u.map((b) => b.right)) - Math.min(...u.map((b) => b.left)), h = Math.max(...u.map((b) => b.bottom)) - Math.min(...u.map((b) => b.top)); if (w >= 44 && h >= 44) continue; out.push("target " + Math.round(w) + "x" + Math.round(h) + " (with its label) \\"" + name(el.labels[0]) + "\\" " + where(el)); continue; }
    // hit-tested along the middle row and column, inside the drawing and on out past each edge, half a pixel in from
    // each pixel's edge so a fractional position is not counted short; a neighbour drawn over a part stops the count there
    const mine = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return false; const hit = document.elementFromPoint(x, y); return !!hit && el.contains(hit); };
    const span = (lo, hi, at, across) => { const pt = (v) => (across ? mine(v, at) : mine(at, v)); const c = (lo + hi) / 2; if (!pt(c)) return 0; let a = c, b = c; while (a - 1 > lo - 30 && pt(a - 1)) a -= 1; while (b + 1 < hi + 30 && pt(b + 1)) b += 1; let f = 0; while (f < 1 && pt(a - f - 0.5)) f += 0.5; let g = 0; while (g < 1 && pt(b + g + 0.5)) g += 0.5; return Math.round(b - a + f + g + 0.5); };
    const w = span(r.left, r.right, cy, true), h = span(r.top, r.bottom, cx, false);
    if (w < 44 || h < 44) out.push("target " + w + "x" + h + " (drawn " + Math.round(r.width) + "x" + Math.round(r.height) + ") \\"" + name(el) + "\\" " + where(el));
  }
  return out;
})()`;
/** how many pages a sheet is paged through at most: a guard against a sheet that never reaches its end */
const MAX_PAGES = 80;

/** The hour each time of day is shot at, inside the game's buckets (day 6-16, evening 17-20, night 21-5). */
const PHASE_HOURS = { day: 12, dusk: 19, night: 23 } as const;

/**
 * A time zone whose local hour is `hour` at `at`. IANA's Etc/GMT zones carry the sign reversed (Etc/GMT-5 is five
 * hours ahead of UTC) and run from twelve hours behind to fourteen ahead, so every hour of the day has one.
 */
function zoneForHour(hour: number, at = new Date()): string {
  let ahead = (((hour - at.getUTCHours()) % 24) + 24) % 24;
  if (ahead > 14) ahead -= 24;
  return ahead === 0 ? "Etc/GMT" : `Etc/GMT${ahead > 0 ? "-" : "+"}${Math.abs(ahead)}`;
}

/** The built site, with an API that answers nothing (or late, for a loading state). */
function fileServer(): Promise<{ url: string; slow: { on: boolean }; close: () => void }> {
  const dist = distDir;
  const types: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".woff2": "font/woff2",
    ".png": "image/png",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
  };
  const slow = { on: false };
  const srv = createServer((q, r) => {
    const path = decodeURIComponent((q.url ?? "/").split("?")[0]!);
    // R33: the Mind sheet asks the server nothing; what it waits on is its lessons' code, held back the same way
    const heldCode = slow.on && /^\/assets\/Teach-[^/]+\.js$/.test(path);
    if (heldCode) return void setTimeout(() => serveFile(path, r), 60_000);
    if (path.startsWith("/api/")) {
      const answer = () => {
        r.writeHead(503, { "content-type": "application/json" });
        r.end('{"ok":false}');
      };
      return void (slow.on ? setTimeout(answer, 60_000) : answer());
    }
    serveFile(path, r);
  });
  function serveFile(path: string, r: ServerResponse): void {
    const f = join(dist, path === "/" ? "index.html" : path);
    if (existsSync(f) && statSync(f).isFile()) {
      r.writeHead(200, { "content-type": types[extname(f)] ?? "application/octet-stream" });
      r.end(readFileSync(f));
    } else {
      r.writeHead(404, { "content-type": "text/html" });
      r.end(readFileSync(join(dist, "404.html")));
    }
  }
  return new Promise((done) =>
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      done({ url: `http://127.0.0.1:${port}`, slow, close: () => srv.close() });
    }),
  );
}

async function contextFor(browser: Browser, l: Look, noWorker = false, timezoneId?: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    ...(timezoneId ? { timezoneId } : {}),
    // a loading state is shot with the offline worker kept out, or it would hand over the held code from its cache
    serviceWorkers: noWorker ? "block" : "allow",
    viewport: SIZES[l.size],
    colorScheme: l.scheme,
    locale: l.lang === "zh" ? "zh-CN" : "en-US",
    deviceScaleFactor: 1,
  });
  await ctx.addInitScript(
    `localStorage.setItem('lingxi.reveal.v1','1'); localStorage.setItem('lingxi.lang','${l.lang}');`,
  );
  // R75: never a paid call, whichever server the build talks to
  await ctx.route(
    (url) => isPaid(url.href),
    (r) => {
      blocked.push(`${tag(l)} ${r.request().method()} ${r.request().url()}`);
      return r.abort("blockedbyclient");
    },
  );
  return ctx;
}

async function settle(page: Page, ms = 700): Promise<void> {
  await page.waitForLoadState("load");
  await page.waitForTimeout(ms);
}

/** A hatched pet in the room, every first-run card put away. */
async function hatched(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/play.html`);
  await page.locator(".hatch").first().waitFor({ timeout: 60_000 });
  await page.locator("div[data-prerender]").waitFor({ state: "detached", timeout: 60_000 });
  await page.fill("#pet-name", "Momo");
  await page.click(".hatch-go");
  await page.locator(".stage").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  for (let i = 0; i < 5; i++) {
    if (await page.locator(".fam-modal").count()) await page.locator(".fam-modal button").last().click();
    else if (await page.locator(".welcome-card").count()) await page.locator(".welcome-card .btn").last().click();
    else break;
    await page.waitForTimeout(300);
  }
}

/** Back to the bare room: every sheet and dialog put away, the Decorate bar closed. */
async function toRoom(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const decor = page.locator(".decor-bar .btn.primary");
    if (await decor.count()) await decor.first().click();
    else if (await page.locator(".sheet, [role=dialog]").count()) await page.keyboard.press("Escape");
    else break;
    await page.waitForTimeout(500);
  }
}

async function openSheet(page: Page, tab: string): Promise<void> {
  await toRoom(page);
  await page.locator(`.tab[data-hint=tab-${tab}]`).click();
  await page.locator(".sheet").first().waitFor();
  await page.waitForTimeout(700);
}

const PAGES = [
  "index.html",
  "verify.html",
  "numbers.html",
  "tree.html",
  "agents.html",
  "handheld.html",
  "circuits.html",
  "privacy.html",
  "terms.html",
  "no-such-page",
];

/** Marks the open sheet's own scrolling box (the sheet or a part of it); false when the sheet fits on one screen. */
async function markScroller(page: Page): Promise<boolean> {
  // no named helper inside: tsx names functions with a helper the page does not have
  return page.evaluate(() => {
    document.querySelectorAll("[data-inventory-scroller]").forEach((e) => e.removeAttribute("data-inventory-scroller"));
    const sheets = Array.from(document.querySelectorAll(".sheet")) as HTMLElement[];
    const top = sheets[sheets.length - 1];
    if (!top) return false;
    const boxes = [top, ...(Array.from(top.querySelectorAll("*")) as HTMLElement[])]
      .filter((e) => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight - e.clientHeight > 4)
      .sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight));
    boxes[0]?.setAttribute("data-inventory-scroller", "");
    return boxes.length > 0;
  });
}

/**
 * The open sheet paged through to its end, each page shot as a screen of its own (`<name>-p2`, `-p3`, ...): moved on
 * by most of a screen, so every row is seen whole on one page or the next, the last page the sheet at its very bottom.
 */
async function pageThrough(page: Page, name: string, save: (screen: string) => Promise<void>): Promise<void> {
  if (!(await markScroller(page))) return;
  const box = page.locator("[data-inventory-scroller]");
  for (let n = 2; n <= MAX_PAGES; n++) {
    const moved = await box.evaluate((e) => {
      const before = e.scrollTop;
      e.scrollTop = Math.min(e.scrollHeight - e.clientHeight, before + Math.round(e.clientHeight * 0.85));
      return e.scrollTop > before;
    });
    if (!moved) return;
    // a panel that loads as it comes into view is given the moment a player scrolling by would give it
    await page.waitForTimeout(500);
    await save(`${name}-p${n}`);
  }
  throw new Error(`still not at its end after ${MAX_PAGES} pages`);
}

/** Each screen: its name and how a fresh context reaches it (the room ones share one hatched page per look). */
type Shot = {
  name: string;
  reach: (page: Page, base: string, ctx: BrowserContext) => Promise<void>;
  /** the sheet it opens is paged through to its end too */
  pages?: boolean;
};

/** A sheet with one of its closed parts opened (the Pet sheet's "more", the Mind sheet's sandbox), shown from there. */
async function openInside(page: Page, tab: string, opener: string): Promise<void> {
  await openSheet(page, tab);
  const open = page.locator(opener).first();
  await open.evaluate((e) => e.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(300);
  const opened = await open.evaluate((e) => e.getAttribute("aria-expanded") === "true" || !!e.closest("details[open]"));
  if (!opened) await open.click();
  // what it opens loads its panels' code: given the time a player's first look gives it
  await page.waitForTimeout(1500);
}

/**
 * One of the room's popups, opened the way a player opens it, and waited for. The tap lands at the middle of its
 * button, on whatever is drawn there, as a finger's would: the "!" bobs without end, so it is never "still" enough for
 * a click that waits for stillness, and a tap that something else catches shows up as the popup not opening.
 */
function popup(name: string, open: (page: Page) => ReturnType<Page["locator"]>, shows: string): Shot {
  return {
    name,
    reach: async (page) => {
      await toRoom(page);
      const button = open(page).first();
      await button.waitFor({ state: "visible", timeout: 15_000 });
      // brought into view without waiting for it to hold still (the "!" never does)
      await button.evaluate((e) => e.scrollIntoView({ block: "nearest" }));
      const box = await button.boundingBox();
      if (!box) throw new Error("its button has no place on the screen");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.locator(shows).first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(900);
    },
  };
}

/** A mini-game's first screen: the Play sheet opened from the room, the game's card chosen. */
function miniGame(name: string, card: number): Shot {
  return {
    name,
    reach: async (page) => {
      await toRoom(page);
      await page.locator(".act").nth(1).click();
      await page.locator(".game-card").nth(card).click();
      await page.locator(".game-card").first().waitFor({ state: "detached", timeout: 15_000 });
      await page.waitForTimeout(1200);
    },
  };
}

const GAME: Shot[] = [
  { name: "room", reach: async () => {} },
  ...["bag", "map", "mind", "spar", "me"].map((tab) => ({
    name: `sheet-${tab}`,
    reach: (page: Page) => openSheet(page, tab),
    pages: true,
  })),
  {
    name: "sheet-games",
    reach: async (page) => {
      await toRoom(page);
      await page.locator(".act").nth(1).click();
      await page.locator(".game-card").first().waitFor();
      await page.waitForTimeout(600);
    },
    pages: true,
  },
  {
    name: "sheet-me-more",
    reach: (page) => openInside(page, "me", ".me-more-open"),
    pages: true,
  },
  {
    name: "sheet-mind-sandbox",
    reach: (page) => openInside(page, "mind", ".sandbox > summary"),
    pages: true,
  },
  popup("popup-mail", (p) => p.locator(".top-right .mail-btn"), ".sheet"),
  popup("popup-quest", (p) => p.locator(".pet-quest"), ".quest-dialog, [role=dialog]"),
  popup("popup-decorate", (p) => p.locator(".room-act").filter({ hasText: /^(Decorate|布置)$/ }), ".decor-bar"),
  popup("popup-skills", (p) => p.locator(".lv-chip"), ".sheet"),
  popup("popup-quests", (p) => p.locator(".top-right .pill"), ".sheet"),
  popup("popup-collection", (p) => p.locator(".tcard-collect"), ".sheet"),
  miniGame("game-catch", 0),
  miniGame("game-pattern", 1),
  miniGame("game-seasonal", 2),
  {
    name: "offline",
    reach: async (page, _b, ctx) => {
      await page.keyboard.press("Escape");
      await ctx.setOffline(true);
      // offline, the reload may not finish as a navigation; what it opened is checked just below
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      // the room, opened from the offline cache; a miss is reported, never shot as though it were the screen
      await page.waitForFunction(
        () => !document.querySelector(".boot-splash") && !!document.querySelector(".stage"),
        undefined,
        { timeout: 20_000 },
      );
      await page.waitForTimeout(1200);
    },
  },
];

async function main(): Promise<void> {
  mkdirSync(join(out, "raw"), { recursive: true });
  const files = live ? null : await fileServer();
  const base = live ? LINGXI_SITE : files!.url;
  const browser = await chromium.launch();
  const errors: string[] = [];
  const findings: string[] = [];
  const want = (n: string) => !only || only.has(n);
  try {
    for (const l of LOOKS.filter((x) => !looksOnly || looksOnly.has(tag(x)))) {
      const save = async (page: Page, screen: string) => {
        mkdirSync(join(out, "raw", screen), { recursive: true });
        await page.screenshot({ path: join(out, "raw", screen, `${tag(l)}.png`) });
        if (measure) for (const m of await page.evaluate<string[]>(MEASURE)) findings.push(`${tag(l)} ${screen}: ${m}`);
      };
      // the pages, each on its own
      for (const p of PAGES) {
        const name = `page-${p.replace(/\.html$/, "")}`;
        if (!want(name)) continue;
        const ctx = await contextFor(browser, l);
        const page = await ctx.newPage();
        page.on("pageerror", (e) => errors.push(`${tag(l)} ${name}: ${e.message}`));
        // a page that does not finish loading is still shot and its errors kept: the sheet shows what happened
        await page.goto(`${base}/${p === "index.html" ? "" : p}`).catch(() => {});
        await settle(page, 1500);
        await save(page, name);
        await ctx.close();
      }
      // the hatch screen, a first visit
      if (want("hatch")) {
        const ctx = await contextFor(browser, l);
        const page = await ctx.newPage();
        await page.goto(`${base}/play.html`);
        await page.locator(".hatch").first().waitFor({ timeout: 60_000 });
        await settle(page, 1200);
        await save(page, "hatch");
        await ctx.close();
      }
      // the game's screens, from one hatched pet
      const shots = GAME.filter((s) => want(s.name));
      if (shots.length) {
        const ctx = await contextFor(browser, l);
        const page = await ctx.newPage();
        page.on("pageerror", (e) => errors.push(`${tag(l)} game: ${e.message}`));
        await hatched(page, base);
        for (const s of shots) {
          try {
            await s.reach(page, base, ctx);
            await save(page, s.name);
            if (s.pages) await pageThrough(page, s.name, (screen) => save(page, screen));
          } catch (e) {
            errors.push(`${tag(l)} ${s.name}: not reached: ${(e as Error).message.split("\n")[0]}`);
          }
        }
        await ctx.close();
      }
      // loading: the API answers late, so a panel that waits for it shows its loading state
      if (!live && want("loading-mind")) {
        files!.slow.on = true;
        const ctx = await contextFor(browser, l, true);
        const page = await ctx.newPage();
        await hatched(page, base);
        await openSheet(page, "mind");
        await save(page, "loading-mind");
        await ctx.close();
        files!.slow.on = false;
      }
      // the room by day, at dusk and at night, each in a browser whose local hour is that time of day
      for (const [when, hour] of Object.entries(PHASE_HOURS)) {
        const name = `room-${when}`;
        if (!want(name)) continue;
        const ctx = await contextFor(browser, l, false, zoneForHour(hour));
        const page = await ctx.newPage();
        page.on("pageerror", (e) => errors.push(`${tag(l)} ${name}: ${e.message}`));
        try {
          await hatched(page, base);
          const seen = await page.evaluate(() => new Date().getHours());
          if (seen !== hour) throw new Error(`the browser's hour is ${seen}, not ${hour}`);
          await page.waitForTimeout(800);
          await save(page, name);
        } catch (e) {
          errors.push(`${tag(l)} ${name}: not reached: ${(e as Error).message.split("\n")[0]}`);
        }
        await ctx.close();
      }
      process.stdout.write(`${tag(l)} done\n`);
    }
    await contactSheets(browser);
  } finally {
    await browser.close();
    files?.close();
  }
  writeFileSync(join(out, "errors.txt"), errors.join("\n") + "\n");
  writeFileSync(join(out, "blocked.txt"), blocked.join("\n") + "\n");
  process.stdout.write(`${blocked.length} paid calls blocked (blocked.txt)\n`);
  if (measure) {
    writeFileSync(join(out, "measure.txt"), findings.join("\n") + "\n");
    process.stdout.write(`${findings.length} contrast or touch-size findings (measure.txt)\n`);
  }
  process.stdout.write(`${errors.length} page errors or misses (errors.txt); sheets in ${out}\n`);
}

/** One image per screen: its sixteen looks in a grid, labelled, scaled to fit. */
async function contactSheets(browser: Browser): Promise<void> {
  const { readdirSync } = await import("node:fs");
  const page = await browser.newPage({ viewport: { width: 2400, height: 1200 }, deviceScaleFactor: 1 });
  for (const screen of readdirSync(join(out, "raw"))) {
    const cells = LOOKS.map((l) => ({ l, f: join(out, "raw", screen, `${tag(l)}.png`) })).filter((c) =>
      existsSync(c.f),
    );
    if (!cells.length) continue;
    const html = `<!doctype html><html><body style="margin:0;background:#888;font:14px sans-serif">
      <h2 style="margin:8px 12px;color:#fff">${screen}</h2>
      <div style="display:grid;grid-template-columns:repeat(8,1fr);gap:8px;padding:8px;align-items:start">
      ${cells.map((c) => `<figure style="margin:0"><img src="${pathToFileURL(c.f).href}" style="width:100%;display:block;background:#fff"><figcaption style="color:#fff">${tag(c.l)}</figcaption></figure>`).join("")}
      </div></body></html>`;
    const file = join(out, `${screen}.html`);
    writeFileSync(file, html);
    await page.goto(pathToFileURL(file).href);
    await page.waitForLoadState("load");
    await page.screenshot({ path: join(out, `${screen}.png`), fullPage: true });
  }
  await page.close();
}

await main();
