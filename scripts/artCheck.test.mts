import { describe, expect, it } from "vitest";
import { checkPalette } from "./lib/artCheck.mts";

const colour = (alpha: string) => `0a0b0c${alpha}`;
const palette = (alphas: string[]) => `0x${alphas.map(colour).join("")}`;

describe("the installed palettes, before the art is frozen (A17)", () => {
  it("passes a palette whose every alpha PetLook writes well", () => {
    const c = checkPalette(0, palette([...Array(15).fill("ff"), "80"]));
    expect(c).toEqual({ id: 0, ok: true, problems: [], seeThrough: [{ role: 16, alpha: 128 }] });
  });

  it("fails one with alpha 254, naming the role", () => {
    expect(checkPalette(3, palette([...Array(4).fill("ff"), "fe", ...Array(11).fill("ff")])).problems).toEqual([
      "role 5 has alpha 254, written as broken CSS",
    ]);
  });

  it("fails one that is missing or the wrong size", () => {
    expect(checkPalette(5, "0x").problems).toEqual(["not installed"]);
    expect(checkPalette(5, "0x00ff").problems).toEqual(["2 bytes, not 64"]);
  });
});
