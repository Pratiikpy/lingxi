/** A10: making a release live, rolling back, and letting old releases go (scripts/lib/release.mts). */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listReleases, readPointer } from "../services/api/src/releases.ts";
import { KEEP_DAYS, PAGES, adopt, checkRelease, makeLive, prune, releaseName, rollback } from "./lib/release.mts";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 19, 5);

/** A complete build, as `vite build` writes one: every page, each naming a part of its own, and build.json. */
function complete(dir: string, tag: string): void {
  mkdirSync(join(dir, "assets"), { recursive: true });
  for (const page of PAGES) writeFileSync(join(dir, page), `<!doctype html><link rel="stylesheet" href="./assets/style-${tag}.css"><script type="module" src="./assets/${page.replace(".html", "")}-${tag}.js"></script>`);
  for (const page of PAGES) writeFileSync(join(dir, "assets", `${page.replace(".html", "")}-${tag}.js`), `// ${tag}`);
  writeFileSync(join(dir, "assets", `style-${tag}.css`), "body{}");
  writeFileSync(join(dir, "build.json"), JSON.stringify({ commit: "a".repeat(40), dirty: false, builtAt: new Date(T0).toISOString() }));
}

/** A site with releases built at the given hours after T0, none live yet. */
function site(...hours: number[]): { dir: string; names: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "site-"));
  const names = hours.map((h) => releaseName(T0 + h * 3_600_000, "a".repeat(40), false));
  names.forEach((n, i) => complete(join(dir, "releases", n), `r${i}`));
  return { dir, names };
}

describe("a release (A10)", () => {
  it("is named by when it was built and the commit it came from", () => {
    expect(releaseName(T0, "0123456789abcdef0123456789abcdef01234567", false)).toBe("20261119T050000Z-0123456789ab");
    expect(releaseName(T0, "0123456789abcdef0123456789abcdef01234567", true)).toBe("20261119T050000Z-0123456789ab-dirty");
  });

  it("knows every page the site builds, as apps/web/vite.config.ts lists them", () => {
    const config = readFileSync(join(import.meta.dirname, "../apps/web/vite.config.ts"), "utf8");
    const built = [...config.matchAll(/\w+: resolve\(__dirname, "([\w-]+\.html)"\)/g)].map((m) => m[1]);
    expect(built.length).toBeGreaterThan(0);
    expect([...built].sort()).toEqual([...PAGES].sort());
  });

  it("goes live only when every page is there and every file a page names is there", () => {
    const { dir, names } = site(0);
    const release = join(dir, "releases", names[0]!);
    expect(checkRelease(release)).toEqual([]);
    writeFileSync(join(release, "play.html"), `<script type="module" src="./assets/play-missing.js"></script>`);
    expect(checkRelease(release)).toEqual(["play.html names assets/play-missing.js, which the release does not have"]);
    const bare = mkdtempSync(join(tmpdir(), "bare-"));
    expect(checkRelease(bare)).toEqual([...PAGES.map((p) => `${p} is missing`), "build.json is missing"]);
  });

  it("refuses to make an incomplete release live, and the live one stays", () => {
    const { dir, names } = site(0, 1);
    makeLive(dir, names[0]!, T0);
    writeFileSync(join(dir, "releases", names[1]!, "verify.html"), `<script src="./assets/gone.js"></script>`);
    expect(() => makeLive(dir, names[1]!, T0 + DAY)).toThrow(/verify\.html names assets\/gone\.js/);
    expect(readPointer(dir)).toEqual({ release: names[0] });
  });

  it("makes a release live in one step and remembers the one before it, which a rollback brings back", () => {
    const { dir, names } = site(0, 1);
    makeLive(dir, names[0]!, T0);
    makeLive(dir, names[1]!, T0 + DAY);
    expect(readPointer(dir)).toEqual({ release: names[1], previous: names[0] });
    expect(rollback(dir, T0 + 2 * DAY)).toBe(names[0]);
    expect(readPointer(dir)).toEqual({ release: names[0], previous: names[1] });
    // and a rollback of the rollback goes forward again
    expect(rollback(dir, T0 + 3 * DAY)).toBe(names[1]);
  });

  it("refuses a rollback with nothing to roll back to", () => {
    const { dir, names } = site(0);
    expect(() => rollback(dir, T0)).toThrow(/nothing is live/);
    makeLive(dir, names[0]!, T0);
    expect(() => rollback(dir, T0)).toThrow(/no release before/);
  });

  it("lets a release go fourteen days after it stopped being live, never the live one or the one before it", () => {
    const { dir, names } = site(0, 1, 2, 3);
    makeLive(dir, names[0]!, T0);
    makeLive(dir, names[1]!, T0 + 1 * DAY);
    makeLive(dir, names[2]!, T0 + 2 * DAY);
    makeLive(dir, names[3]!, T0 + 3 * DAY);
    // names[0] stopped being live on day 1, names[1] on day 2, names[2] (the one before the live one) on day 3
    expect(prune(dir, T0 + (1 + KEEP_DAYS) * DAY - 1)).toEqual([]);
    expect(prune(dir, T0 + (2 + KEEP_DAYS) * DAY)).toEqual([names[0], names[1]]);
    expect(prune(dir, T0 + 100 * DAY)).toEqual([]);
    expect(listReleases(dir)).toEqual([names[3], names[2]]);
  });

  it("lets a release that was never live go at once", () => {
    const { dir, names } = site(0, 1);
    makeLive(dir, names[1]!, T0);
    expect(prune(dir, T0)).toEqual([names[0]]);
  });

  it("adopts a build made before releases, with the files kept from the builds before it, as a release", () => {
    const base = mkdtempSync(join(tmpdir(), "adopt-"));
    complete(join(base, "dist"), "old");
    mkdirSync(join(base, "assets-kept", "assets"), { recursive: true });
    writeFileSync(join(base, "assets-kept", "assets", "Sheet-older.js"), "// older");
    const dir = join(base, "site");
    const name = adopt(dir, join(base, "dist"), join(base, "assets-kept"), T0);
    expect(name).toBe(`20261119T050000Z-${"a".repeat(12)}`);
    expect(readPointer(dir)).toEqual({ release: name });
    expect(existsSync(join(dir, "releases", name, "assets", "Sheet-older.js"))).toBe(true);
    expect(readFileSync(join(dir, "releases", name, "play.html"), "utf8")).toContain("play-old.js");
  });
});
