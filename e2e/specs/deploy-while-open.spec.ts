/**
 * A deploy while a page is open. Release A is made live with the release command and served as the live site serves
 * its releases; a page opens on it as a first visit, the player picks an egg, and the page's request for the game's main
 * part (fetched behind the hatch screen at the first touch, FirstVisit.tsx) is held while release B is built and made
 * live, then let go. With A still kept (releases stay 14 days after they stop
 * being live), A's part still arrives and the game starts on A without a reload; a fresh page then gets B. With A gone,
 * the part is missing, the page reloads itself once (boot/staleBuild.ts) and the game starts on B. Pages are sent with
 * Cache-Control no-cache. And while a release is built and made live, no page and no file a page names is ever
 * missing (A10). Every release is made in the run's scratch folder; the live site's releases are not touched.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, liveHatch, test } from "../fixtures";
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
    const releaseA = await buildSite(run, f.site, "A");
    const entryA = entryOf(f.site);
    const site = await serveSite(f.site);
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
          await buildSite(run, f.site, "B");
          if (!kept) rmSync(join(f.site, "releases", releaseA), { recursive: true, force: true });
        }
        await route.continue();
      });

      const res = await page.goto(`${site.url}/play.html`);
      expect(res?.headers()["cache-control"], "the page is sent with no-cache").toBe("no-cache");
      await liveHatch(page, 120_000);
      // a first visit fetches the rest of the game behind its hatch screen at the player's first touch (FirstVisit.tsx):
      // the player picks an egg, the part is asked for and held while B goes live
      await page.locator(".egg").nth(1).click();
      await expect.poll(() => held, { message: "the page asked for the game's part", timeout: 120_000 }).toBe(true);
      if (kept) await expect.poll(() => [...answered.entries()].some(([n, status]) => n.startsWith("PlayApp-") && n.endsWith(".js") && status === 200), { message: "A's part arrived", timeout: 120_000 }).toBe(true);
      else await expect.poll(() => loads, { message: "the page reloaded once", timeout: 120_000 }).toBe(2);
      await liveHatch(page, 120_000);
      await page.waitForTimeout(2_000);
      const nowEntry = (await page.evaluate(() => document.querySelector("script[type=module][src]")?.getAttribute("src"))) ?? "";
      const entryB = entryOf(f.site);
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

test("a release in progress never takes a page or its files away (A10)", async ({ run }) => {
  test.setTimeout(360_000);
  const f = siteFolder(run, "release-poll");
  await buildSite(run, f.site, "A");
  const entryA = entryOf(f.site);
  const site = await serveSite(f.site);
  const pages = ["index.html", "play.html", "verify.html", "agents.html", "tree.html", "numbers.html", "handheld.html"];
  const bad: string[] = [];
  const served = new Set<string>();
  let asked = 0;
  let releasing = true;
  try {
    // every page, and the entry each names, asked for every 20 ms while release B is built and made live
    const poll = (async () => {
      while (releasing) {
        for (const page of pages) {
          const res = await fetch(`${site.url}/${page}`);
          const html = await res.text();
          asked++;
          if (res.status !== 200) bad.push(`${page} ${res.status}`);
          const entry = /src="\.\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
          if (!entry) {
            bad.push(`${page} names no script`);
            continue;
          }
          if (page === "play.html") served.add(entry);
          const part = await fetch(`${site.url}/${entry}`);
          await part.arrayBuffer();
          asked++;
          if (part.status !== 200) bad.push(`${entry} ${part.status}`);
        }
        await new Promise((r) => setTimeout(r, 20));
      }
    })();
    await buildSite(run, f.site, "B");
    // a last round after B is live
    await new Promise((r) => setTimeout(r, 500));
    releasing = false;
    await poll;
    const entryB = entryOf(f.site);
    expect(entryB, "the two releases really differ").not.toBe(entryA);
    expect([...served].sort(), "the poll saw release A, then release B").toEqual([entryA, entryB].sort());
    expect(asked, "it asked many times while B was built").toBeGreaterThan(200);
    expect(bad, "and every answer was the page or the file").toEqual([]);
  } finally {
    site.stop();
    rmSync(f.site, { recursive: true, force: true });
  }
});
