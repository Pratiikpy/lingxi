import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { KEEP_DAYS, keepAssets, keptDirFor } from "../keepAssets";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 18, 12);

function build(files: Record<string, string>) {
  const base = mkdtempSync(join(tmpdir(), "keep-"));
  const dist = join(base, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dist, "assets", name), text);
  return { dist, kept: keptDirFor(dist) };
}

describe("keeping an earlier build's files (A4)", () => {
  it("keeps every file of the build about to be replaced, beside it, where the server looks", () => {
    const { dist, kept } = build({ "play-A.js": "A", "Sheet-A.js": "sheet A" });
    expect(kept).toBe(join(dist, "..", "assets-kept"));
    expect(keepAssets(dist, kept, NOW)).toEqual({ kept: 2, removed: 0 });
    expect(readFileSync(join(kept, "assets", "Sheet-A.js"), "utf8")).toBe("sheet A");
    // a second build of the same files copies nothing new
    expect(keepAssets(dist, kept, NOW + DAY)).toEqual({ kept: 0, removed: 0 });
  });

  it("lets a file go fourteen days after it left the build, and not before", () => {
    const { dist, kept } = build({ "old-A.js": "A" });
    keepAssets(dist, kept, NOW);
    // the next build no longer has it
    const next = build({ "new-B.js": "B" });
    expect(keepAssets(next.dist, kept, NOW + (KEEP_DAYS - 1) * DAY).removed).toBe(0);
    expect(existsSync(join(kept, "assets", "old-A.js"))).toBe(true);
    expect(keepAssets(next.dist, kept, NOW + (KEEP_DAYS + 1) * DAY).removed).toBe(1);
    expect(existsSync(join(kept, "assets", "old-A.js"))).toBe(false);
  });

  it("keeps a file as long as builds still carry it", () => {
    const { dist, kept } = build({ "shared-S.js": "S" });
    keepAssets(dist, kept, NOW);
    keepAssets(dist, kept, NOW + 10 * DAY);
    keepAssets(dist, kept, NOW + 20 * DAY);
    expect(existsSync(join(kept, "assets", "shared-S.js"))).toBe(true);
    expect(statSync(join(kept, "assets", "shared-S.js")).mtimeMs).toBe(NOW + 20 * DAY);
  });

  it("starts from nothing on the first build ever", () => {
    const base = mkdtempSync(join(tmpdir(), "keep-"));
    const dist = join(base, "dist");
    expect(keepAssets(dist, keptDirFor(dist), NOW)).toEqual({ kept: 0, removed: 0 });
  });

  it("clears out a kept folder left long ago", () => {
    const { dist, kept } = build({});
    mkdirSync(join(kept, "assets"), { recursive: true });
    writeFileSync(join(kept, "assets", "ancient.js"), "x");
    utimesSync(join(kept, "assets", "ancient.js"), (NOW - 30 * DAY) / 1000, (NOW - 30 * DAY) / 1000);
    expect(keepAssets(dist, kept, NOW).removed).toBe(1);
  });
});

describe("a page left open across a deploy whose part fails to load (A4)", () => {
  it("reloads once into the build that is live now, and never again for the same build", async () => {
    const page = new EventTarget();
    const session = new Map<string, string>();
    const reload = vi.fn();
    vi.stubGlobal("window", page);
    vi.stubGlobal("document", { querySelector: () => ({ src: "https://lingxi.knole.me/assets/play-A.js" }) });
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v) });
    vi.stubGlobal("location", { reload, pathname: "/play.html" });
    try {
      await import("./boot/staleBuild");
      const partFails = () => {
        const e = new Event("vite:preloadError", { cancelable: true });
        page.dispatchEvent(e);
        return e.defaultPrevented;
      };
      expect(partFails()).toBe(true);
      expect(reload).toHaveBeenCalledTimes(1);
      // the same build failing again after its reload is left to the crash guard's message, not reloaded in a loop
      expect(partFails()).toBe(false);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
