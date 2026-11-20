// @vitest-environment happy-dom
/** A111: every page says its language, title and description in the reader's language, from one list. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_META, type Page, applyPageMeta } from "./pageMeta";

const web = join(__dirname, "../..");
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

describe("each page's language, title and description (A111)", () => {
  for (const page of Object.keys(PAGE_META) as Page[])
    it(`${page}.html carries the list's English, so the two cannot drift apart`, () => {
      const html = readFileSync(join(web, `${page}.html`), "utf8");
      expect(html).toMatch(/<html lang="en">/);
      expect(decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "")).toBe(PAGE_META[page].title.en);
      expect(decode(/<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "")).toBe(PAGE_META[page].description.en);
    });

  it("every page has its own Chinese title and description", () => {
    for (const [page, m] of Object.entries(PAGE_META)) {
      expect(m.title.zh, page).toMatch(/[一-鿿]/);
      expect(m.description.zh, page).toMatch(/[一-鿿]/);
      expect(m.description.zh, page).not.toBe(m.description.en);
    }
  });

  it("sets the page's language, title and description, and sets them back", () => {
    document.head.innerHTML = '<title>x</title><meta name="description" content="x">';
    applyPageMeta("verify", "zh");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.title).toBe("核对一只灵犀宠物");
    expect(document.querySelector('meta[name="description"]')!.getAttribute("content")).toBe(PAGE_META.verify.description.zh);
    applyPageMeta("verify", "en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe("Verify a Lingxi pet");
    expect(document.querySelector('meta[name="description"]')!.getAttribute("content")).toBe(PAGE_META.verify.description.en);
  });
});
