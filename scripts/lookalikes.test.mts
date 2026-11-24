import { describe, expect, it } from "vitest";
import { escaped, findLookalikes } from "./lib/lookalikes.mts";

describe("look-alike pet names on chain (A16)", () => {
  it("lists a name carrying a character that draws as nothing, with the pet it passes for", () => {
    const found = findLookalikes([
      { petId: 1n, name: "Mochi" },
      { petId: 2n, name: "mochi\u061c" },
      { petId: 3n, name: "Pip" },
    ]);
    expect(found).toEqual([{ petId: 2n, name: "mochi\u061c", shown: "mochi\ufffd", hidden: 1, imitates: [1n] }]);
  });

  it("lists one that imitates nobody yet, and passes over ordinary names, punctuation and emoji", () => {
    expect(findLookalikes([{ petId: 4n, name: "Tofu\u{1d173}" }]).map((l) => l.imitates)).toEqual([[]]);
    expect(
      findLookalikes([
        { petId: 5n, name: "Mo\u2026" },
        { petId: 6n, name: "团子 \u2764\ufe0f" },
        { petId: 7n, name: "" },
      ]),
    ).toEqual([]);
  });

  it("prints a name with its hidden characters as code points", () => {
    expect(escaped("Mochi\u061c")).toBe("Mochi<U+061C>");
    expect(escaped("团")).toBe("<U+56E2>");
  });
});
