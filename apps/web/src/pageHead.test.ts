/**
 * R75: one header on every page of the site. The privacy and terms pages sat in a narrower column (760 px, its header
 * 60 px in from everyone else's on a desktop, 4 px higher), and the handheld's in a 640 px one under "← Lingxi" where
 * every other page says "Lingxi · 灵犀". Each page's frame is now the same: 880 px across, the same space above and at
 * the sides, its header "Lingxi · 灵犀" on the left and the language button on the right; what a page holds may be
 * narrower inside it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const src = import.meta.dirname;
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "node_modules" ? [] : files(join(dir, e.name))) : [join(dir, e.name)],
  );
const code = files(src).filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f));

/** A stylesheet rule's declarations, by its selector exactly as written. */
function rule(css: string, selector: string): Record<string, string> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const m = [...text.matchAll(/([^{};]+)\{([^{}]*)\}/g)].find((r) => r[1]!.trim() === selector);
  if (!m) throw new Error(`no rule ${selector}`);
  return Object.fromEntries(
    m[2]!
      .split(";")
      .map((d) => d.split(":"))
      .filter((d) => d.length >= 2)
      .map(([k, ...v]) => [k!.trim(), v.join(":").trim()]),
  );
}

describe("one header on every page (R75)", () => {
  it("every page's home link reads Lingxi · 灵犀", () => {
    const brands = code.flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/className="v-brand"[^>]*>\s*([^<]*?)\s*<\/a>/g)].map((m) => ({
        file: relative(src, f),
        text: m[1],
      })),
    );
    expect(brands.length).toBeGreaterThanOrEqual(6);
    expect(brands.filter((b) => b.text !== "Lingxi · 灵犀")).toEqual([]);
  });

  it("every page's frame is 880 px across with the same space above and at the sides", () => {
    const frames: Array<[string, string]> = [
      ["verify/verify.css", ".verify"],
      ["agents/agents.css", ".agents"],
      ["info/info.css", ".info"],
      ["handheld/handheld.css", ".hh-page"],
      ["static/circuits.css", ".cx"],
    ];
    for (const [file, selector] of frames) {
      const r = rule(readFileSync(join(src, file), "utf8"), selector);
      expect(r["max-width"], `${selector} width`).toBe("880px");
      expect(r["margin"], `${selector} centred`).toBe("0 auto");
      expect(r["padding-block"]?.split(/\s+/)[0], `${selector} space above`).toBe("var(--s5)");
      expect(r["padding-left"], `${selector} left`).toBe("max(16px, env(safe-area-inset-left, 0px))");
      expect(r["padding-right"], `${selector} right`).toBe("max(16px, env(safe-area-inset-right, 0px))");
    }
  });
});
