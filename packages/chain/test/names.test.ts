/**
 * A16: a pet's name can carry no character that shows as nothing. PetLook (mainnet) refuses only some invisible code
 * points, so a name like "Mochi" plus U+061C could pass for "Mochi"; the game refuses every one Unicode marks as
 * default-ignorable before anything is sent, and a name read from the chain that still carries one shows it.
 */
import { describe, expect, it } from "vitest";
import { hiddenCodePoint, invisibleCodePoint, nameProblem, revealHidden, stripHidden } from "../src/look";

/**
 * Default_Ignorable_Code_Point, as Unicode 18.0.0 lists it (DerivedCoreProperties.txt, 2026-08-07), every range:
 * the code points a renderer is allowed to draw as nothing.
 */
const DEFAULT_IGNORABLE: Array<[number, number]> = [
  [0x00ad, 0x00ad], [0x034f, 0x034f], [0x061c, 0x061c], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180b, 0x180d],
  [0x180e, 0x180e], [0x180f, 0x180f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2065, 0x2065],
  [0x2066, 0x206f], [0x3164, 0x3164], [0xfe00, 0xfe0f], [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff0, 0xfff8],
  [0x1bca0, 0x1bca3], [0x1d173, 0x1d17a], [0xe0000, 0xe0fff],
];

describe("names with characters that show as nothing (A16)", () => {
  it("counts every code point Unicode marks as default-ignorable as hidden", () => {
    for (const [from, to] of DEFAULT_IGNORABLE) for (let cp = from; cp <= to; cp++) expect(hiddenCodePoint(cp), cp.toString(16)).toBe(true);
  });

  it("shows every one of them as U+FFFD in a name read from the chain or from another player", () => {
    for (const [from, to] of DEFAULT_IGNORABLE) for (let cp = from; cp <= to; cp++) expect(invisibleCodePoint(cp), cp.toString(16)).toBe(true);
  });

  it("refuses, before anything is sent, a name that would pass for another", () => {
    for (const hidden of ["\u061c", "\u17b4", "\u180b", "\u180f", "\u{1bca0}", "\u{1d173}"]) expect(nameProblem(`Mochi${hidden}`), hidden.codePointAt(0)!.toString(16)).toBe("chars");
    expect(nameProblem("Mochi")).toBeNull();
    expect(nameProblem("团子")).toBeNull();
    expect(nameProblem("Mochi 🐱")).toBeNull();
  });

  it("takes hidden characters out of a name a player types, and leaves every other character", () => {
    expect(stripHidden("Mo\u061cchi\u200b")).toBe("Mochi");
    expect(stripHidden("团子 🐱")).toBe("团子 🐱");
  });

  it("shows each hidden character in a name read from the chain, and leaves an ordinary name as it is", () => {
    expect(revealHidden("Mochi")).toEqual({ text: "Mochi", hidden: 0 });
    expect(revealHidden("团子 🐱")).toEqual({ text: "团子 🐱", hidden: 0 });
    expect(revealHidden("Mo\u061cchi\u{1d173}")).toEqual({ text: "Mo\ufffdchi\ufffd", hidden: 2 });
  });
});
