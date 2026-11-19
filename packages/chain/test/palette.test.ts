/**
 * A17: no palette can make PetLook write broken CSS. PetLook writes a see-through colour as `fill-opacity:.PP` with
 * PP = round(alpha / 255 * 100), so alpha 254 rounds to 100 and writes `fill-opacity:.:0`; the installer refuses it,
 * and any colour that is not plain hex, before anything is sent.
 */
import { describe, expect, it } from "vitest";
import { buildLayers, installCalls, lookPalettes, paletteBytes } from "../src/look";

describe("palettes as PetLook stores them (A17)", () => {
  it("refuses alpha 254, naming the role and the colour", () => {
    expect(() => paletteBytes({ O: "#0a0b0cfe" })).toThrow(/role O.*#0a0b0cfe.*254/);
  });

  it("refuses a colour that is not #rrggbb or #rrggbbaa", () => {
    for (const bad of ["#0a0b0", "0a0b0c", "#0a0b0cz1", "#gg0000", "#0a0b0c0d0e"]) expect(() => paletteBytes({ O: bad }), bad).toThrow(/role O/);
  });

  it("takes every other alpha, and writes opaque colours as alpha 255", () => {
    expect(paletteBytes({ O: "#0a0b0cfd" }).slice(2, 10)).toBe("0a0b0cfd");
    expect(paletteBytes({ O: "#0A0B0C" }).slice(2, 10)).toBe("0a0b0cff");
    expect(paletteBytes({ O: "#0a0b0cff" }).slice(2, 10)).toBe("0a0b0cff");
  });

  it("still builds every palette the game ships", () => {
    const { pets, eggs } = lookPalettes();
    expect(installCalls(buildLayers(), pets, eggs).palettes).toHaveLength(6);
  });
});
