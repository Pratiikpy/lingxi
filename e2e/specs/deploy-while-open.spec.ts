/**
 * A deploy while a page is open. Release A is built and served as a deploy serves it; a page opens on it, and its
 * request for the game's main part (loaded on demand by play/main.tsx) is held while release B is built over A, then
 * let go. With the files of earlier builds kept (apps/web keepAssets.ts), A's part still arrives and the game starts
 * on A without a reload; a fresh page then gets B. With those files gone, the part is missing, the page reloads itself
 * once (boot/staleBuild.ts) and the game starts on B. Pages are sent with Cache-Control no-cache. Each release is
 * built into the run's scratch folder; nothing in apps/web/dist is touched.
 */
import { rmSync } from "node:fs";
import { expect, test } from "../fixtures";
import { buildSite, entryOf, expectedErrors, serveSite, siteFolder } from "../helpers/browser";

const PART = "**/assets/PlayApp-*.js";
const name = (path: string) => path.split("/").pop()!;

for (const { kept, look } of [
  { kept: true, look: { lang: "en", scheme: "light", size: "phone" } },
  { kept: false, look: { lang: "zh", scheme: "dark", size: "phone" } },
] as const) {
  const tag = `${kept ? "kept" : "gone"}-${look.lang}-${look.scheme}`;
  test(`a deploy while a page is open, earlier files ${kept ? "kept" : "gone"} (${look.lang}, ${look.scheme}, ${look.size})`, async ({ player, run }) => {
    test.setTimeout(360_000);
    const f = siteFolder(run, `deploy-${tag}`);
    await buildSite(run, f.dist, "A");
    const entryA = entryOf(f.dist);
    const site = await serveSite(f.dist);
    try {
      const p = await player(look);
      const { page } = p;
      let loads = 0;
      page.on("load", () => loads++);
      // every answer for a file of the game, by name: the held part's among them
      const answered = new Map<string, number>();
      const missing: string[] = [];
      page.on("response", (r) => {
        if (!r.url().includes("/assets/")) return;
        answered.set(name(r.url()), r.status());
        if (r.status() === 404) missing.push(name(r.url()));
      });
      let held = false;
      await page.route(PART, async (route) => {
        if (!held) {
          held = true;
          // the new release goes live while this page still waits for its part
          await buildSite(run, f.dist, "B");
          if (!kept) rmSync(f.kept, { recursive: true, force: true });
        }
        await route.continue();
      });

      const res = await page.goto(`${site.url}/play.html`);
      expect(res?.headers()["cache-control"], "the page is sent with no-cache").toBe("no-cache");
      await page.locator(".hatch").waitFor({ timeout: 120_000 });
      await page.waitForTimeout(1_500);
      const nowEntry = (await page.evaluate(() => document.querySelector("script[type=module][src]")?.getAttribute("src"))) ?? "";
      const entryB = entryOf(f.dist);
      expect(entryB, "the two releases really differ").not.toBe(entryA);
      // the part's script and its styles
      const part = [...answered.entries()].filter(([n]) => n.startsWith("PlayApp-"));

      if (kept) {
        expect(held, "the page's part was held while B was built").toBe(true);
        expect(part.some(([n]) => n.endsWith(".js")), "the page asked for release A's part").toBe(true);
        expect(part.filter(([, status]) => status !== 200), "and it still arrived after B went live").toEqual([]);
        expect(missing, "and no file of A was missing").toEqual([]);
        expect(loads, "the game started on A without reloading").toBe(1);
        expect(name(nowEntry)).toBe(name(entryA));
        const fresh = await p.ctx.newPage();
        await fresh.goto(`${site.url}/play.html`);
        const got = (await fresh.evaluate(() => document.querySelector("script[type=module][src]")?.getAttribute("src"))) ?? "";
        expect(name(got), "a fresh page gets release B").toBe(name(entryB));
      } else {
        expect(loads, "with A's part gone, the page reloaded once").toBe(2);
        expect(name(nowEntry), "into release B").toBe(name(entryB));
        expect(missing.some((n) => n.startsWith("PlayApp-")), "the part that went missing was A's").toBe(true);
        // the files of A that were gone: the only console errors there may be
        await expectedErrors(p, /the server responded with a status of 404/, missing.length);
      }
      await page.screenshot({ path: test.info().outputPath(`${tag}.png`) });
    } finally {
      site.stop();
      rmSync(f.site, { recursive: true, force: true });
    }
  });
}
