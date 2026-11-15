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
  type Palette,
  type PixelCanvas,
  SKY,
  SUNNY,
  drawCat,
  drawPet,
  toRgba,
} from "@lingxi/art";
import type { StarterLine } from "@lingxi/brain";

const cache = new Map<string, Texture>();

export const PALETTE_OF: Record<StarterLine, Palette> = { gentle: CORAL, bold: SUNNY, curious: SKY };

function canvasTexture(key: string, c: PixelCanvas, pal: Palette): Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const el = document.createElement("canvas");
  el.width = c.w;
  el.height = c.h;
  const ctx = el.getContext("2d")!;
  const img = ctx.createImageData(c.w, c.h);
  img.data.set(toRgba(c, pal, 1));
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
}

export function petTexture(line: StarterLine, f: PetFrame): Texture {
  const key = `pet:${line}:${f.stage}:${f.expression}:${f.breath}:${f.squash}:${f.lit ? 1 : 0}`;
  return canvasTexture(key, drawPet(line, f.stage, f), PALETTE_OF[line]);
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
