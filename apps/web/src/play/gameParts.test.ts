/**
 * P3: only a plain first visit gets the standalone hatch screen; anything with a pet saved, a link that brings something,
 * Telegram's launch, or a save that cannot be read starts the full game at once.
 */
import { describe, expect, it } from "vitest";
import { isFirstVisit } from "./gameParts";

const store = (keys: Record<string, string>) => ({ getItem: (k: string) => keys[k] ?? null });
const plain = { search: "", hash: "" };

describe("which visits get the standalone hatch screen (P3)", () => {
  it("a device with nothing saved, a plain address, outside Telegram", () => {
    expect(isFirstVisit(store({}), plain, false)).toBe(true);
    expect(isFirstVisit(store({ "lingxi.lang": "zh", "lingxi.pets.v2": JSON.stringify({ active: 0, pets: [] }) }), plain, false), "a roster with no pet in it").toBe(true);
  });

  it("not with a pet saved, in either save format", () => {
    expect(isFirstVisit(store({ "lingxi.pets.v2": JSON.stringify({ active: 0, pets: [{ name: "Pip" }] }) }), plain, false)).toBe(false);
    expect(isFirstVisit(store({ "lingxi.pet.v1": JSON.stringify({ name: "Pip" }) }), plain, false)).toBe(false);
  });

  it("not when the address brings something, inside Telegram, or without readable storage", () => {
    expect(isFirstVisit(store({}), { search: "?gift=abc", hash: "" }, false)).toBe(false);
    expect(isFirstVisit(store({}), { search: "", hash: "#packet=1" }, false)).toBe(false);
    expect(isFirstVisit(store({}), plain, true)).toBe(false);
    expect(isFirstVisit(null, plain, false)).toBe(false);
    expect(isFirstVisit(store({ "lingxi.pets.v2": "{not json" }), plain, false), "a damaged save goes to the full game's recovery").toBe(false);
    expect(
      isFirstVisit({ getItem: () => { throw new Error("blocked"); } }, plain, false),
      "storage that throws",
    ).toBe(false);
  });
});
