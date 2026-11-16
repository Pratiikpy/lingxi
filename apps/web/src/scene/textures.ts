/**
 * Turns the hand-drawn pixel canvases from @lingxi/art into PixiJS textures,
 * once each, with nearest-neighbour sampling so they stay crisp at any scale.
 */

import { Texture } from "pixi.js";
import {
  CAT,
  CORAL,
  type CatPose,
  type Expression,
  type Form,
  type Palette,
  type PixelCanvas,
  SKY,
  SUNNY,
  drawCat,
  drawPet,
  type Outfit,
  paintOverlay,
  toRgba,
  wearOverlay,
} from "@lingxi/art";
import type { StarterLine } from "@lingxi/brain";

const cache = new Map<string, Texture>();

export const PALETTE_OF: Record<StarterLine, Palette> = { gentle: CORAL, bold: SUNNY, curious: SKY };

function canvasTexture(key: string, c: PixelCanvas, pal: Palette, paint?: (rgba: Uint8ClampedArray) => void): Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const el = document.createElement("canvas");
  el.width = c.w;
  el.height = c.h;
  const ctx = el.getContext("2d")!;
  const img = ctx.createImageData(c.w, c.h);
  const rgba = toRgba(c, pal, 1);
  paint?.(rgba);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  const t = Texture.from(el);
  t.source.scaleMode = "nearest";
  cache.set(key, t);
  return t;
}

export type PetStage = "baby" | "child" | "teen" | "adult";

export interface PetFrame {
  stage: PetStage;
  expression: Expression;
  breath: 0 | 1;
  squash: -1 | 0 | 1;
  lit: boolean;
  /** the adult form, when grown */
  form?: Form;
  /** what it wears (cosmetic) */
  outfit?: Outfit;
  /** drawn in other colours than its line's own (a resident or visitor) */
  palette?: { key: string; colors: Palette };
}

export function petTexture(line: StarterLine, f: PetFrame): Texture {
  const o = f.outfit ?? {};
  const key = `pet:${line}:${f.stage}:${f.expression}:${f.breath}:${f.squash}:${f.lit ? 1 : 0}:${f.form ?? ""}:${o.head ?? ""}:${o.face ?? ""}:${o.held ?? ""}:${f.palette?.key ?? ""}`;
  const c = drawPet(line, f.stage, f);
  const worn = o.head || o.face || o.held;
  return canvasTexture(key, c, f.palette?.colors ?? PALETTE_OF[line], worn ? (rgba) => paintOverlay(rgba, c.w, wearOverlay(c, line, f.stage, o, f.squash, f.form)) : undefined);
}

export function catTexture(pose: CatPose): Texture {
  return canvasTexture(`cat:${pose}`, drawCat(pose), CAT);
}

/** A tiny pixel heart and sparkle for the particles. */
const HEART = [".e.e.", "eeeee", "eeeee", ".eee.", "..e.."];
const SPARK = ["..e..", "..e..", "eeeee", "..e..", "..e.."];
export function glyphTexture(kind: "heart" | "spark" | "note", color: string): Texture {
  const key = `glyph:${kind}:${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rows = kind === "heart" ? HEART : kind === "spark" ? SPARK : ["..ee", "..e.", "..e.", "eee.", "eee."];
  const el = document.createElement("canvas");
  el.width = 5;
  el.height = 5;
  const ctx = el.getContext("2d")!;
  ctx.fillStyle = color;
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) if (r[x] === "e") ctx.fillRect(x, y, 1, 1);
  });
  const t = Texture.from(el);
  t.source.scaleMode = "nearest";
  cache.set(key, t);
  return t;
}

/**
 * Small pixel sprites for the room's living details, drawn from rows of letters:
 * each letter is a colour from `colors`, "." is clear.
 */
export function pixelTexture(key: string, rows: readonly string[], colors: Record<string, string>): Texture {
  const k = `px:${key}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const el = document.createElement("canvas");
  el.width = Math.max(...rows.map((r) => r.length));
  el.height = rows.length;
  const ctx = el.getContext("2d")!;
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      const c = colors[r[x]!];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  const t = Texture.from(el);
  t.source.scaleMode = "nearest";
  cache.set(k, t);
  return t;
}

const INK = "#2B2140";
export const BITS = {
  z: () => pixelTexture("z", ["wwww", "..w.", ".w..", "wwww"], { w: "#FFF7E8" }),
  ball: () => pixelTexture("ball", [".ooooo.", "obbbbbo", "owwwwwo", "obbbbbo", "obbbbbo", ".ooooo."], { o: INK, b: "#2F7FD6", w: "#FFFFFF" }),
  bunny: (blink: boolean) =>
    pixelTexture(`bunny:${blink}`, ["..g.g.g..", ".ggggggg.", "gglgglggg", blink ? "ggggggggg" : "ggogggogg", "gggggggg.", ".ggggggg."], { g: "#8E86A6", l: "#B7B0CC", o: INK }),
  firefly: () => pixelTexture("firefly", [".y.", "yYy", ".y."], { y: "#E8F59A", Y: "#FFFFFF" }),
  mote: (c: string) => pixelTexture(`mote:${c}`, ["m"], { m: c }),
  drop: () => pixelTexture("drop", ["d", "d", "D"], { d: "#BFD9F5", D: "#E8F2FF" }),
  flake: () => pixelTexture("flake", [".f.", "fff", ".f."], { f: "#FFFFFF" }),
  petal: (c: string) => pixelTexture(`petal:${c}`, ["p.", "pp"], { p: c }),
  crumb: (c: string) => pixelTexture(`crumb:${c}`, ["c"], { c }),
  bubble: () =>
    pixelTexture(
      "bubble",
      [
        "..oooooooooooo..",
        ".owwwwwwwwwwwwo.",
        "owwwwwwwwwwwwwwo",
        "owwwwwwwwwwwwwwo",
        "owwwwwwwwwwwwwwo",
        "owwwwwwwwwwwwwwo",
        "owwwwwwwwwwwwwwo",
        "owwwwwwwwwwwwwwo",
        "owwwwwwwwwwwwwwo",
        ".owwwwwwwwwwwwo.",
        "..oooowwoooooo..",
        "......owo.......",
        ".......o........",
      ],
      { o: INK, w: "#FFFDF8" },
    ),
};

/** A soft round glow (white at the centre, clear at the edge), tinted where it is used. */
export function glowTexture(): Texture {
  const k = "glow";
  const hit = cache.get(k);
  if (hit) return hit;
  const n = 64;
  const el = document.createElement("canvas");
  el.width = n;
  el.height = n;
  const ctx = el.getContext("2d")!;
  const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, n, n);
  const t = Texture.from(el);
  t.source.scaleMode = "linear";
  cache.set(k, t);
  return t;
}

/** Darker corners, clear middle: framing light for the room. */
export function vignetteTexture(): Texture {
  const k = "vignette";
  const hit = cache.get(k);
  if (hit) return hit;
  const n = 128;
  const el = document.createElement("canvas");
  el.width = n;
  el.height = n;
  const ctx = el.getContext("2d")!;
  const g = ctx.createRadialGradient(n / 2, n * 0.55, n * 0.3, n / 2, n * 0.55, n * 0.78);
  g.addColorStop(0, "rgba(27,22,48,0)");
  g.addColorStop(1, "rgba(27,22,48,1)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, n, n);
  const t = Texture.from(el);
  t.source.scaleMode = "linear";
  cache.set(k, t);
  return t;
}
