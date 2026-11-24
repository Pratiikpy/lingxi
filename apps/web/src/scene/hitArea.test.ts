/**
 * A25: a sprite in the room answers a tap only on its drawn pixels, with one room pixel of allowance for a finger, so a
 * tap on the player's pet's transparent margin reaches the friend standing behind it.
 */
import { describe, expect, it } from "vitest";
import { type Mask, hitsBody } from "./hitArea";

/** A 6×4 picture with one 2×2 block drawn at (2,1)-(3,2). */
const mask: Mask = {
  w: 6,
  h: 4,
  alpha: Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]),
};
/** Anchored at its feet's middle, as the room's pets are: local x runs -3..3, y -4..0. */
const anchor = { x: 0.5, y: 1 };

describe("a tap on a sprite's body (A25)", () => {
  it("answers on a drawn pixel", () => {
    expect(hitsBody(mask, anchor, -0.5, -2.5)).toBe(true); // pixel (2, 1)
  });

  it("answers one pixel around its body, for a finger", () => {
    expect(hitsBody(mask, anchor, -1.5, -2.5)).toBe(true); // pixel (1, 1), beside the block
    expect(hitsBody(mask, anchor, 1.5, -0.5)).toBe(true); // pixel (4, 3), diagonal to (3, 2)
  });

  it("lets a tap on the transparent margin through", () => {
    expect(hitsBody(mask, anchor, -2.5, -3.5)).toBe(false); // pixel (0, 0)
    expect(hitsBody(mask, anchor, 2.5, -0.5)).toBe(false); // pixel (5, 3)
  });

  it("never answers outside its picture", () => {
    expect(hitsBody(mask, anchor, -3.5, -2)).toBe(false);
    expect(hitsBody(mask, anchor, 0, 0.5)).toBe(false);
  });

  it("is read in the sprite's own space, so a mirrored sprite answers on its drawn pixels too", () => {
    // a visitor facing left is scaled -1 on x; Pixi hands the hit area local (unmirrored) coordinates
    expect(hitsBody(mask, anchor, 0.5, -1.5)).toBe(true); // pixel (3, 2)
  });

  it("answers anywhere in its picture when nothing says which pixels are drawn", () => {
    expect(hitsBody(null, anchor, -2.5, -3.5, 1, { w: 6, h: 4 })).toBe(true);
    expect(hitsBody(null, anchor, -3.5, -2, 1, { w: 6, h: 4 })).toBe(false);
  });
});
