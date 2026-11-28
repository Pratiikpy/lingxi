/**
 * R75: the landing hero's light words drawn over the scene (the name, the links, "See how it thinks") read on bright
 * foliage at every size and hour: each carries a plum outline a pixel wide on every side, not a drop alone, which left
 * them white on pale leaves at dusk.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "landing.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const declarations = (selector: string) =>
  [...css.matchAll(/([^{};]+)\{([^{}]*)\}/g)].find((m) => m[1]!.trim() === selector)?.[2] ?? "";

describe("the hero's light words read over the art (R75)", () => {
  it("the outline is a pixel on every side, in the brand's plum", () => {
    const outline = /--over-art:([^;]+);/.exec(declarations(".l-hero"))?.[1] ?? "";
    for (const [x, y] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ])
      expect(outline.replace(/\s+/g, " "), `${x},${y}`).toContain(
        `${x === 0 ? 0 : `${x}px`} ${y === 0 ? 0 : `${y}px`} 0 #2b2140`,
      );
  });

  it("the name, the links and the quiet link carry it", () => {
    for (const selector of [".l-brand", ".l-links a", ".l-quiet"])
      expect(declarations(selector), selector).toMatch(/text-shadow:\s*var\(--over-art\)/);
  });
});
