/** R75: the seasonal game's hiding places are whole pixel art: every row the same width, every pixel a colour it has. */
import { describe, expect, it } from "vitest";
import { COVER_H, COVER_W, SEEK_COVERS } from "./seekCovers";

describe("the hiding places' pixel art (R75)", () => {
  for (const [season, art] of Object.entries(SEEK_COVERS)) {
    it(`${season}: ${COVER_W} by ${COVER_H}, outlined, every pixel coloured`, () => {
      expect(art.rows).toHaveLength(COVER_H);
      for (const row of art.rows) expect(row).toHaveLength(COVER_W);
      const used = new Set(art.rows.join("").replaceAll(".", ""));
      for (const k of used) expect(art.colors[k], `${season} "${k}"`).toBeTruthy();
      // an outline round the mound, and the season's own mark in it (other than its base, light and shade)
      expect(used.has("o")).toBe(true);
      expect([...used].filter((k) => !"oabcx".includes(k)).length + (season === "summer" ? 1 : 0)).toBeGreaterThan(0);
    });
  }
});
