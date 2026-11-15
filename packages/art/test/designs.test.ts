import { describe, expect, it } from "vitest";
import { DesignError, decodeDesign, designWearable, drawPet, encodeDesign, registerWearables, wearOverlay } from "../src/index";

const cap = { slot: "head" as const, cells: [[0, 0, 0, 0, 0], [0, 1, 1, 1, 0], [1, 2, 2, 2, 1], [0, 0, 0, 0, 0]], colours: ["#2b2140", "#e8604a"] };

describe("player-made outfits", () => {
  it("bytes round-trip, trimmed to what is drawn", () => {
    const b = encodeDesign(cap);
    expect(Array.from(b.slice(0, 4))).toEqual([0, 5, 2, 2]);
    expect(b.length).toBe(4 + 6 + Math.ceil((5 * 2 * 2) / 8));
    const back = decodeDesign(b);
    expect(back.cells).toEqual([[0, 1, 1, 1, 0], [1, 2, 2, 2, 1]]);
    expect(back.colours).toEqual(["#2b2140", "#e8604a"]);
  });

  it("refuses what the market contract refuses", () => {
    expect(() => encodeDesign({ ...cap, cells: [[0, 0]] })).toThrow(DesignError);
    expect(() => encodeDesign({ ...cap, cells: [Array(14).fill(1)] })).toThrow(DesignError);
    expect(() => encodeDesign({ ...cap, slot: "face", cells: [Array(11).fill(1)] })).toThrow(DesignError);
    expect(() => encodeDesign({ ...cap, colours: ["#000000", "#111111", "#222222", "#333333"] })).toThrow(DesignError);
    expect(() => encodeDesign({ ...cap, colours: ["#000000"] })).toThrow(DesignError);
    expect(() => decodeDesign(new Uint8Array([3, 1, 1, 1, 0, 0, 0, 1]))).toThrow(DesignError);
    const b = encodeDesign(cap);
    expect(() => decodeDesign(b.slice(0, b.length - 1))).toThrow(DesignError);
  });

  it("matches the contract's own example bytes", () => {
    const d = decodeDesign(Uint8Array.from([0x00, 0x03, 0x02, 0x02, 0xff, 0x00, 0x00, 0xff, 0xff, 0x00, 0xa5, 0x0a]));
    expect(d.slot).toBe("head");
    expect(d.cells).toEqual([[1, 1, 2], [2, 2, 2]]);
  });

  it("is worn on a pet like Lingxi's own pieces", () => {
    registerWearables([designWearable("c:7", decodeDesign(encodeDesign(cap)), { en: "Red cap", zh: "红帽" })]);
    const pet = drawPet("gentle", "child", { expression: "happy" });
    const px = wearOverlay(pet, "gentle", "child", { head: "c:7" });
    expect(px.length).toBe(8);
    expect(new Set(px.map((p) => p[2]))).toEqual(new Set(["#2b2140", "#e8604a"]));
  });
});
