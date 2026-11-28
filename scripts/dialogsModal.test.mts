/**
 * R73 and the final review: a dialog that covers the game is modal (`aria-modal="true"`), so the game's dialog focus
 * (apps/web/src/play/modalFocus.ts) keeps Tab inside it, gives the focus back when it goes, and lets Escape take its
 * way out. Ten covering dialogs (family, gift, adoption, handheld, red packet) were not marked, so the keyboard left
 * them and Escape did nothing. Every `role="dialog"` in the game is checked here; the few that are panels beside a room
 * the player keeps using are named below with the reason, and stay non-modal.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(import.meta.dirname, "..", "apps", "web", "src");

/** Non-modal on purpose: they sit beside or over a corner of a room that stays in use. */
const PANELS: Record<string, string> = {
  "play/Talk.tsx": "a resident's words in a box at the room's foot; the room stays in play",
  "play/app/VisitorCards.tsx": "a visitor's card beside the room; the room stays in play",
  "play/Social.tsx": "the who's-here list over the room's corner; it closes on Escape itself",
};

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return p.endsWith(".tsx") && !p.endsWith(".test.tsx") ? [p] : [];
  });

/** The opening tag around `at` (an offset inside it): from its `<` to the `>` that ends it, braces and quotes skipped. */
function openingTag(text: string, at: number): string {
  const start = text.lastIndexOf("<", at);
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (depth === 0 && (c === '"' || c === "'")) quote = c;
    else if (depth === 0 && c === ">") return text.slice(start, i + 1);
  }
  return text.slice(start);
}

describe("a dialog that covers the game is modal (R73)", () => {
  const found: Array<{ file: string; tag: string }> = [];
  for (const f of files(src)) {
    const text = readFileSync(f, "utf8");
    // an attribute on an element, not a selector in a string ('[role="dialog"]')
    for (const m of text.matchAll(/(?<!\[)role="dialog"/g))
      found.push({ file: relative(src, f).replaceAll("\\", "/"), tag: openingTag(text, m.index) });
  }

  it("finds the game's dialogs", () => {
    expect(found.length).toBeGreaterThan(15);
  });

  it("every dialog is marked modal, unless it is a named panel beside a room in use", () => {
    const unmarked = found
      .filter(({ file, tag }) => !/aria-modal="true"/.test(tag) && !PANELS[file])
      .map(({ file, tag }) => `${file}: ${tag.replace(/\s+/g, " ").slice(0, 90)}`);
    expect(unmarked).toEqual([]);
  });

  it("the covering family-style dialog is always modal", () => {
    const fam = found.filter(({ tag }) => /className="fam-modal/.test(tag));
    expect(fam.length).toBeGreaterThanOrEqual(10);
    expect(fam.filter(({ tag }) => !/aria-modal="true"/.test(tag))).toEqual([]);
  });
});
