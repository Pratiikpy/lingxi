/**
 * P6: every page carries its share card: the card tags in its head, written by `pnpm share:cards`, pointing at a card
 * that exists, 1200 by 630, with the page's own title and description.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { CARDS, SITE, cardTags } from "./lib/shareCards.mts";

const web = join(import.meta.dirname, "..", "apps", "web");
const pageFile = (page: string) => join(web, page);

describe("every page's share card (P6)", () => {
  it("covers every page the site serves", () => {
    const pages = [
      "index.html",
      "play.html",
      "verify.html",
      "numbers.html",
      "tree.html",
      "agents.html",
      "handheld.html",
      "circuits.html",
      "privacy.html",
      "terms.html",
    ];
    expect(CARDS.map((c) => c.page).sort()).toEqual(pages.sort());
  });

  for (const c of CARDS) {
    it(`${c.page} carries its card, and the card is 1200 by 630`, () => {
      const head = readFileSync(pageFile(c.page), "utf8");
      expect(head, "the tags as the generator writes them (run pnpm share:cards)").toContain(cardTags(c));
      expect(head).toContain(`<meta property="og:image" content="${SITE}/cards/`);
      const png = join(web, "public", "cards", `${c.page.replace(/\.html$/, "")}.png`);
      expect(existsSync(png), png).toBe(true);
      const { width, height } = PNG.sync.read(readFileSync(png));
      expect([width, height]).toEqual([1200, 630]);
    });
  }
});
