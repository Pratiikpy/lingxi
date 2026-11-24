// @vitest-environment node
/**
 * P3: a sprite rendered at build time (the prerendered hatch screen) has no canvas to draw on, so it is drawn as an SVG
 * of the same pixels, one path per colour: every painted pixel inside the crop is covered once, in its colour, and
 * nothing else is.
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CORAL, drawEgg, drawPet, toRgba } from "@lingxi/art";
import { Sprite } from "./Sprite";

/** The SVG's paths back as painted pixels: "x,y" to the fill colour (each subpath is one row's run of one colour). */
function pixelsOf(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<path d="([^"]+)" fill="([^"]+)"/g)) {
    for (const r of m[1]!.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      for (let k = 0; k < Number(r[3]); k++) {
        const key = `${Number(r[1]) + k},${r[2]}`;
        expect(out.has(key), `pixel ${key} covered once`).toBe(false);
        out.set(key, m[2]!);
      }
    }
  }
  return out;
}

describe("a sprite rendered at build time (P3)", () => {
  it("is an SVG of exactly the canvas's painted pixels, at its size and scale", () => {
    const canvas = drawEgg("coral", 0);
    const html = renderToString(<Sprite canvas={canvas} palette={CORAL} scale={5} label="An egg" />);
    expect(html).toContain(`width="${canvas.w * 5}"`);
    expect(html).toContain(`viewBox="0 0 ${canvas.w} ${canvas.h}"`);
    expect(html).toContain('aria-label="An egg"');
    const drawn = pixelsOf(html);
    const rgba = toRgba(canvas, CORAL, 1);
    let painted = 0;
    for (let y = 0; y < canvas.h; y++)
      for (let x = 0; x < canvas.w; x++) {
        const i = (y * canvas.w + x) * 4;
        if (rgba[i + 3]! === 0) {
          expect(drawn.has(`${x},${y}`), `pixel ${x},${y} is clear`).toBe(false);
          continue;
        }
        painted++;
        expect(drawn.get(`${x},${y}`)).toBe(
          `rgba(${rgba[i]},${rgba[i + 1]},${rgba[i + 2]},${(rgba[i + 3]! / 255).toFixed(3)})`,
        );
      }
    expect(drawn.size).toBe(painted);
    expect(painted).toBeGreaterThan(20);
    // one path per colour, however many pixels: a few layout objects for the page's first layout
    const colours = new Set([...drawn.values()]);
    expect((html.match(/<path /g) ?? []).length).toBe(colours.size);
  });

  it("draws only the crop, shifted to its corner", () => {
    const canvas = drawPet("gentle", "baby", { expression: "sparkly" });
    const crop = { x: 2, y: 3, w: 10, h: 9 };
    const drawn = pixelsOf(renderToString(<Sprite canvas={canvas} palette={CORAL} scale={2} crop={crop} />));
    for (const key of drawn.keys()) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      expect(x >= 0 && x < crop.w && y >= 0 && y < crop.h, `${key} inside the crop`).toBe(true);
    }
    const rgba = toRgba(canvas, CORAL, 1);
    const inCrop = Array.from({ length: crop.h }, (_, y) =>
      Array.from({ length: crop.w }, (_, x) => rgba[((crop.y + y) * canvas.w + crop.x + x) * 4 + 3]! > 0),
    )
      .flat()
      .filter(Boolean).length;
    expect(drawn.size).toBe(inCrop);
  });
});
