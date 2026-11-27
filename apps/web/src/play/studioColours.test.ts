/**
 * R40: the studio's colours are named by colour words in the player's language, never by hex codes: each swatch by its
 * own name, a colour of the player's own by the nearest name.
 */
import { describe, expect, it } from "vitest";
import { SWATCHES, colourWords, inkLabel, nameOf, wellLabel } from "./studioColours";

describe("the studio's colour names (R40)", () => {
  it("names every swatch by its own name, in both languages, and no two alike", () => {
    for (const s of SWATCHES) {
      expect(nameOf(s.hex), s.hex).toEqual({ colour: s, exact: true });
      expect(s.en).not.toMatch(/#|[0-9]/);
      expect(s.zh).not.toMatch(/#|[0-9a-z]/i);
    }
    expect(new Set(SWATCHES.map((s) => s.en)).size).toBe(SWATCHES.length);
    expect(new Set(SWATCHES.map((s) => s.zh)).size).toBe(SWATCHES.length);
    expect(colourWords("#e8604a", "en")).toBe("coral");
    expect(colourWords("#e8604a", "zh")).toBe("珊瑚红");
    expect(colourWords("#2b2140", "zh")).toBe("深紫");
  });

  it("names a colour of the player's own by the nearest name, said as near it", () => {
    // a coral a little off the swatch; one too close to tell apart from it is the swatch's own colour
    expect(colourWords("#f07055", "en")).toBe("close to coral");
    expect(colourWords("#f07055", "zh")).toBe("接近珊瑚红");
    expect(colourWords("#e9624c", "en")).toBe("coral");
    expect(colourWords("#00a0ff", "en")).toBe("close to azure");
    expect(colourWords("#ff0000", "en")).toBe("close to red");
    expect(colourWords("#123456", "en")).toBe("close to navy");
    expect(colourWords("#00ff00", "en")).toBe("close to bright green");
    expect(colourWords("#f07c10", "zh")).toBe("接近橙色");
    // a plain colour word met exactly is said as itself
    expect(colourWords("#000000", "en")).toBe("black");
    expect(colourWords("#000000", "zh")).toBe("黑色");
    // the input's own case does not matter
    expect(colourWords("#E8604A", "en")).toBe("coral");
  });

  it("says an ink and the well the way a screen reader reads them", () => {
    expect(inkLabel(1, "#2b2140", "en")).toBe("Colour 1: deep plum");
    expect(inkLabel(2, "#00a0ff", "zh")).toBe("颜色 2：接近湛蓝");
    expect(wellLabel("#e8604a", "en")).toBe("Your own colour, now coral");
    expect(wellLabel("#e8604a", "zh")).toBe("自己调颜色，现在是珊瑚红");
    expect(wellLabel("#00a0ff", "zh")).toBe("自己调颜色，现在接近湛蓝");
  });

  it("never falls back to a hex code", () => {
    for (let i = 0; i < 400; i++) {
      const hex = `#${((i * 2654435761) >>> 8).toString(16).padStart(6, "0").slice(-6)}`;
      for (const lang of ["en", "zh"] as const) expect(colourWords(hex, lang)).not.toMatch(/#|[0-9a-f]{6}/i);
    }
  });
});
