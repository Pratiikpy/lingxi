/** R29: the Chinese page titles' pixel face holds every character of every title it is used for, and nothing more. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DISPLAY_CJK_TITLES, displayCjkChars, unicodeRange } from "./lib/displayCjk.mts";

const root = join(import.meta.dirname, "..");
const fonts = join(root, "apps", "web", "src", "styles", "fonts");
const css = readFileSync(join(root, "apps", "web", "src", "styles", "display-cjk.css"), "utf8");

describe("the pixel face of the Chinese titles (R29)", () => {
  it("lists each title as its page still writes it", () => {
    for (const t of DISPLAY_CJK_TITLES) expect(readFileSync(join(root, t.file), "utf8"), t.page).toContain(t.text);
  });

  it("is cut to exactly the titles' characters: a title changed or added means the font is rebuilt", () => {
    // prettier wraps a long range over several lines
    const ranges = [...css.matchAll(/unicode-range:\s*([^;]+);/g)].map((m) => (m[1] ?? "").replace(/\s+/g, " ").trim());
    expect(ranges.length).toBeGreaterThan(0);
    for (const r of ranges) expect(r).toBe(unicodeRange(displayCjkChars()));
  });

  it("covers every character of the titles that is not Latin", () => {
    const chars = displayCjkChars();
    expect(chars).toContain("养");
    expect(chars).toContain("。");
    expect(chars).not.toContain("A");
    expect(chars).not.toContain(" ");
  });

  it("is a small file served from the site, with its licence beside it", () => {
    const font = join(fonts, "lingxi-pixel-cjk.woff2");
    expect(existsSync(font)).toBe(true);
    expect(statSync(font).size).toBeLessThan(8 * 1024);
    expect(css).toContain('url("./fonts/lingxi-pixel-cjk.woff2")');
    expect(css).toMatch(/font-display:\s*swap/);
    expect(readFileSync(join(fonts, "OFL.txt"), "utf8")).toContain("SIL Open Font License, Version 1.1");
  });
});
