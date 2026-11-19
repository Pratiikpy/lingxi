/**
 * A25: a sprite in the room answers a tap only on its drawn pixels. Pixi tests a sprite's whole rectangle by default,
 * transparent margin included, and the player's pet is drawn over visitors, so a tap on a friend standing close beside
 * it patted the pet instead. With this hit area a tap on a transparent margin passes to whatever is drawn behind.
 * Which pixels are drawn is read once from each texture's own canvas and kept; one room pixel of allowance is given
 * around them, since a finger is wider than a pixel.
 */
import type { Sprite, Texture } from "pixi.js";

/** Which pixels of a picture are drawn (alpha above zero), row by row. */
export interface Mask {
  w: number;
  h: number;
  alpha: Uint8Array;
}

/** Room pixels of allowance around a sprite's drawn pixels. */
const REACH = 1;

/**
 * Whether a point in a sprite's own space (Pixi's local coordinates, before its scale, so a mirrored sprite is read
 * unmirrored) lands on a drawn pixel or within `reach` of one. With no mask, anywhere in the picture counts.
 */
export function hitsBody(mask: Mask | null, anchor: { x: number; y: number }, x: number, y: number, reach = REACH, size?: { w: number; h: number }): boolean {
  const w = mask?.w ?? size?.w ?? 0;
  const h = mask?.h ?? size?.h ?? 0;
  const tx = Math.floor(x + anchor.x * w);
  const ty = Math.floor(y + anchor.y * h);
  if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false;
  if (!mask) return true;
  for (let dy = -reach; dy <= reach; dy++)
    for (let dx = -reach; dx <= reach; dx++) {
      const px = tx + dx;
      const py = ty + dy;
      if (px >= 0 && py >= 0 && px < w && py < h && mask.alpha[py * w + px]) return true;
    }
  return false;
}

const masks = new WeakMap<Texture, Mask | null>();

/** The drawn pixels of a texture whose source is a canvas (every texture the room draws), read once; null otherwise. */
function maskOf(t: Texture): Mask | null {
  if (masks.has(t)) return masks.get(t)!;
  let mask: Mask | null = null;
  const canvas = t.source.resource as HTMLCanvasElement | undefined;
  const ctx = canvas && typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
  if (ctx) {
    const f = t.frame;
    const w = Math.round(f.width);
    const h = Math.round(f.height);
    const rgba = ctx.getImageData(Math.round(f.x), Math.round(f.y), w, h).data;
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) alpha[i] = rgba[i * 4 + 3]! > 0 ? 1 : 0;
    mask = { w, h, alpha };
  }
  masks.set(t, mask);
  return mask;
}

/** A hit area for `sprite` that answers only on its body, whichever texture it shows at the moment. */
export function bodyHitArea(sprite: Sprite): { contains(x: number, y: number): boolean } {
  return {
    contains: (x, y) => hitsBody(maskOf(sprite.texture), sprite.anchor, x, y, REACH, { w: sprite.texture.width, h: sprite.texture.height }),
  };
}
