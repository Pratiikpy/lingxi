// @vitest-environment node
/**
 * R43: the live numbers page as the build renders it, before any of its script and before the server has answered: its
 * header, title and explanation, the note that it is reading the chain, and the links it ends with, in English and in
 * Chinese. It holds no number at all, since none has been read yet: every figure appears only once the page has read it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

/** The page as the build renders it in `lang`: a fresh copy of its modules, whose language store starts in `lang`. */
async function rendered(lang: "en" | "zh"): Promise<string> {
  // the build gives the render a neutral location while it runs (vite.config.ts `prerenderOne`), and each language its
  // own copy of the modules
  const g = globalThis as { location?: unknown; __lingxiPrerenderLang?: string };
  const had = "location" in g;
  if (!had) g.location = new URL("https://lingxi.invalid/");
  g.__lingxiPrerenderLang = lang;
  vi.resetModules();
  try {
    const { render } = await import("./prerender");
    return render();
  } finally {
    if (!had) delete g.location;
    delete g.__lingxiPrerenderLang;
  }
}

/** The words a reader sees: the markup without its tags, its character references read as the characters they name. */
const words = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(amp|lt|gt|quot);/g, (_, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"' })[name] ?? "");

afterEach(() => vi.resetModules());

describe("the live numbers page rendered at build time (R43)", () => {
  it("draws the page's header, title, explanation and the note that it is reading the chain", async () => {
    const html = await rendered("en");
    expect(html).toContain('<main class="agents numbers">');
    expect(html).toContain('<a href="index.html" class="v-brand">Lingxi · 灵犀</a>');
    expect(html).toContain('<button type="button" class="v-lang">中文</button>');
    expect(html).toContain("<h1>Live numbers</h1>");
    expect(html).toContain("What Lingxi has done on X Layer, read from the chain by Lingxi&#x27;s server");
    expect(html).toContain('<p class="ag-card tl-loading" role="status">Reading the chain…</p>');
    expect(html).toContain('class="site-foot"');
  });

  it("says the same in Chinese", async () => {
    const html = await rendered("zh");
    expect(html).toContain('<button type="button" class="v-lang">EN</button>');
    expect(html).toContain("<h1>链上数字</h1>");
    expect(html).toContain("灵犀在 X Layer 上做了什么");
    expect(html).toContain('role="status">正在读取链上记录……</p>');
    expect(html).toContain('aria-label="关于灵犀"');
  });

  it("shows no number, no figure and no failure before the page has read anything", async () => {
    for (const lang of ["en", "zh"] as const) {
      const html = await rendered(lang);
      expect(words(html), lang).not.toMatch(/\d/);
      for (const before of [
        "nb-group",
        "nb-row",
        "nb-value",
        "nb-team-card",
        "tl-indexed",
        "nb-failed",
        'role="alert"',
      ])
        expect(html, `${lang} ${before}`).not.toContain(before);
    }
  });
});
