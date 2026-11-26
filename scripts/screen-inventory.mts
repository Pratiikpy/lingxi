/**
 * `pnpm screens:inventory [--live] [--only name,name]`: P6's screen inventory. Every screen and state of the game and
 * every page, at 360, 390, landscape and desktop, light and dark, English and Chinese, one contact sheet per screen
 * (all sixteen looks side by side) so a person reviews each screen in one look, against 28-UX-MOTION-FEEL section 1.
 *
 * By default it runs the built site (apps/web/dist) from a plain file server whose API answers nothing, which shows
 * the states a player sees with the server unreachable; `--live` runs the live site, with its server. Loading states
 * are held open by answering the API late, and the Mind sheet's (whose one wait is its lessons' code, R33) by sending
 * that code late; offline is the browser set offline after the game has loaded once.
 * Writes ../audit-<date>/inventory/<screen>.png and raw/<screen>/<look>.png, and lists any page error per look.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { type ServerResponse, createServer } from "node:http";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, type BrowserContext, type Page, chromium } from "@playwright/test";
import { LINGXI_SITE } from "../packages/chain/src/site.ts";

const root = join(import.meta.dirname, "..");
const live = process.argv.includes("--live");
const onlyAt = process.argv.indexOf("--only");
const only = onlyAt > 0 ? new Set(process.argv[onlyAt + 1]!.split(",")) : null;
const day = new Date().toISOString().slice(0, 10);
const out = join(root, "..", `audit-${day}`, "inventory");

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

/** The built site, with an API that answers nothing (or late, for a loading state). */
function fileServer(): Promise<{ url: string; slow: { on: boolean }; close: () => void }> {
  const dist = join(root, "apps", "web", "dist");
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

async function contextFor(browser: Browser, l: Look, noWorker = false): Promise<BrowserContext> {
  const ctx = await browser.newContext({
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

async function openSheet(page: Page, tab: string): Promise<void> {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
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

/** Each screen: its name and how a fresh context reaches it (the room ones share one hatched page per look). */
type Shot = { name: string; reach: (page: Page, base: string, ctx: BrowserContext) => Promise<void> };
const GAME: Shot[] = [
  { name: "room", reach: async () => {} },
  ...["bag", "map", "mind", "spar", "me"].map((tab) => ({
    name: `sheet-${tab}`,
    reach: (page: Page) => openSheet(page, tab),
  })),
  {
    name: "sheet-games",
    reach: async (page) => {
      await page.keyboard.press("Escape");
      await page.locator(".act").nth(1).click();
      await page.locator(".game-card").first().waitFor();
      await page.waitForTimeout(600);
    },
  },
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
  const want = (n: string) => !only || only.has(n);
  try {
    for (const l of LOOKS) {
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
        mkdirSync(join(out, "raw", name), { recursive: true });
        await page.screenshot({ path: join(out, "raw", name, `${tag(l)}.png`) });
        await ctx.close();
      }
      // the hatch screen, a first visit
      if (want("hatch")) {
        const ctx = await contextFor(browser, l);
        const page = await ctx.newPage();
        await page.goto(`${base}/play.html`);
        await page.locator(".hatch").first().waitFor({ timeout: 60_000 });
        await settle(page, 1200);
        mkdirSync(join(out, "raw", "hatch"), { recursive: true });
        await page.screenshot({ path: join(out, "raw", "hatch", `${tag(l)}.png`) });
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
            mkdirSync(join(out, "raw", s.name), { recursive: true });
            await page.screenshot({ path: join(out, "raw", s.name, `${tag(l)}.png`) });
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
        mkdirSync(join(out, "raw", "loading-mind"), { recursive: true });
        await page.screenshot({ path: join(out, "raw", "loading-mind", `${tag(l)}.png`) });
        await ctx.close();
        files!.slow.on = false;
      }
      process.stdout.write(`${tag(l)} done\n`);
    }
    await contactSheets(browser);
  } finally {
    await browser.close();
    files?.close();
  }
  writeFileSync(join(out, "errors.txt"), errors.join("\n") + "\n");
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
