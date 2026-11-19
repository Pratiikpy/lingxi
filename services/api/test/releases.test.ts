/**
 * A10: the site is served from releases, each a complete build in a folder of its own, and `current.json` names the
 * live one. Replacing that one file makes a release live, so a deploy never leaves a moment with pages missing; earlier
 * releases serve the files a page left open asks for later (A4).
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { RELEASE_NAME, listReleases, readPointer, releaseSource, writePointer } from "../src/releases";
import { SITE_CACHE_MAX, withSite } from "../src/server";

const A = "20261119T050000Z-aaaaaaa";
const B = "20261119T060000Z-bbbbbbb";

/** A site folder holding releases built from `files`, by release name. */
function site(releases: Record<string, Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "releases-"));
  for (const [name, files] of Object.entries(releases)) {
    for (const [path, text] of Object.entries(files)) {
      const file = join(dir, "releases", name, path);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, text);
    }
  }
  return dir;
}

/** A release as the build makes one: its pages, each naming a part of its own. */
const build = (tag: string) => ({
  "index.html": `<!doctype html><title>Lingxi ${tag}</title>`,
  "play.html": `<!doctype html><script type="module" src="./assets/play-${tag}.js"></script>`,
  [`assets/play-${tag}.js`]: `export const build = '${tag}';`,
});

describe("serving releases (A10)", () => {
  it("serves the release current.json names, and the next one as soon as that file is replaced", async () => {
    const dir = site({ [A]: build("A"), [B]: build("B") });
    writePointer(dir, { release: A });
    const app = withSite(new Hono(), releaseSource(dir));
    expect(await (await app.request("/")).text()).toContain("Lingxi A");
    writePointer(dir, { release: B, previous: A });
    expect(await (await app.request("/")).text()).toContain("Lingxi B");
    expect(await (await app.request("/assets/play-B.js")).text()).toContain("'B'");
    expect(readPointer(dir)).toEqual({ release: B, previous: A });
  });

  it("answers every page and the part it names, with no gap, while releases go live over and over", async () => {
    const dir = site({ [A]: build("A"), [B]: build("B") });
    writePointer(dir, { release: A });
    const app = withSite(new Hono(), releaseSource(dir));
    const failures: string[] = [];
    let flips = 0;
    const flipping = (async () => {
      for (; flips < 150; flips++) {
        writePointer(dir, flips % 2 ? { release: A, previous: B } : { release: B, previous: A });
        await new Promise((r) => setImmediate(r));
      }
    })();
    const asking = (async () => {
      while (flips < 150) {
        const page = await app.request("/play.html");
        const html = await page.text();
        const part = /src="\.\/(assets\/[^"]+)"/.exec(html)?.[1];
        const asset = part ? await app.request(`/${part}`) : null;
        if (page.status !== 200 || !part || asset?.status !== 200) failures.push(`${page.status} ${part} ${asset?.status}`);
      }
    })();
    await Promise.all([flipping, asking]);
    expect(failures).toEqual([]);
  });

  it("keeps the last good release when current.json goes missing or is damaged", async () => {
    const dir = site({ [A]: build("A") });
    writePointer(dir, { release: A });
    const source = releaseSource(dir);
    const app = withSite(new Hono(), source);
    expect((await app.request("/")).status).toBe(200);
    writeFileSync(join(dir, "current.json"), "{ not json");
    expect(await (await app.request("/")).text()).toContain("Lingxi A");
    writeFileSync(join(dir, "current.json"), JSON.stringify({ release: "../../etc" }));
    expect(await (await app.request("/")).text()).toContain("Lingxi A");
    rmSync(join(dir, "current.json"));
    expect(await (await app.request("/")).text()).toContain("Lingxi A");
    // a release folder that disappeared is not served either
    writePointer(dir, { release: B });
    expect(source.root()).toContain(A);
  });

  it("says plainly that nothing is released yet, rather than a bare 404", async () => {
    const dir = site({ [A]: build("A") });
    const res = await withSite(new Hono(), releaseSource(dir)).request("/play.html");
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(await res.text()).toMatch(/being released/);
  });

  it("reads nothing outside the releases: a pointer naming a path, or a request climbing out, is refused", async () => {
    const dir = site({ [A]: build("A") });
    writeFileSync(join(dir, "secret.txt"), "secret");
    for (const name of ["..", "../releases", "20261119T050000Z-aaaaaaa/../..", "C:\\Windows", ".hidden"]) expect(RELEASE_NAME.test(name), name).toBe(false);
    writePointer(dir, { release: A });
    const app = withSite(new Hono(), releaseSource(dir));
    for (const path of ["/assets/..%2f..%2f..%2fsecret.txt", "/..%2f..%2fsecret.txt", "/assets/..%2fplay.html"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
    }
    expect(() => writePointer(dir, { release: "../secret" })).toThrow(/release name/);
  });

  it("lists releases newest first, by name only, and only folders that hold a release", () => {
    const dir = site({ [A]: build("A"), [B]: build("B") });
    mkdirSync(join(dir, "releases", "not-a-release"), { recursive: true });
    writeFileSync(join(dir, "releases", "20261119T070000Z-ccccccc"), "a file, not a folder");
    expect(listReleases(dir)).toEqual([B, A]);
  });

  it("keeps serving correctly past more releases than it remembers at once", async () => {
    const names = Array.from({ length: SITE_CACHE_MAX + 6 }, (_, i) => `20261119T${String(100000 + i).slice(-6)}Z-${"c".repeat(7)}`);
    const dir = site(Object.fromEntries(names.map((n, i) => [n, build(`r${i}`)])));
    const app = withSite(new Hono(), releaseSource(dir));
    for (const [i, name] of names.entries()) {
      writePointer(dir, { release: name });
      expect(await (await app.request("/")).text(), name).toContain(`Lingxi r${i}`);
      expect((await app.request(`/assets/play-r${i}.js`)).status).toBe(200);
      // and the first release's file, from the far end of the earlier ones
      expect((await app.request("/assets/play-r0.js")).status).toBe(200);
    }
  });

  it("names a release by when it was built and the commit it came from", () => {
    expect(RELEASE_NAME.test(A)).toBe(true);
    expect(RELEASE_NAME.test(`${A.slice(0, -7)}0123456789abcdef0123456789abcdef01234567`)).toBe(true);
    expect(RELEASE_NAME.test(`${A}-dirty`)).toBe(true);
    expect(RELEASE_NAME.test("20261119-aaaaaaa")).toBe(false);
  });

  it("replaces current.json in one step, leaving nothing half-written beside it", () => {
    const dir = site({ [A]: build("A"), [B]: build("B") });
    writePointer(dir, { release: A });
    writePointer(dir, { release: B, previous: A });
    expect(readdirSync(dir).sort()).toEqual(["current.json", "releases"]);
    expect(JSON.parse(readFileSync(join(dir, "current.json"), "utf8"))).toEqual({ release: B, previous: A });
  });
});
