/**
 * Player-made outfits (PRD S3): a small pixel drawing in one of the three slots,
 * stored as compact bytes so it can live on chain in the fashion market.
 *
 * Bytes: slot (0 head, 1 face, 2 held) · width (1-13) · height (1-10) · colour
 * count (1-3) · each colour as 3 bytes (r, g, b) · cells, 2 bits each, row by
 * row, low bits first (0 = empty, 1-3 = a colour). The market contract checks
 * the same shape (OutfitMarket._checkPixels).
 *
 * A design becomes an ordinary Wearable, so it is placed on every egg line,
 * stage and form exactly like the pieces Lingxi draws.
 */

import { SLOTS, type Slot, type Wearable } from "./wear";

export const DESIGN_MAX_W = 13;
export const DESIGN_MAX_H = 10;
/** Face pieces sit between the eyes of the smallest face, so they are at most this wide. */
export const DESIGN_FACE_MAX_W = 10;
export const DESIGN_MAX_COLOURS = 3;

export interface Design {
  slot: Slot;
  /** rows of cell values: 0 empty, 1..3 a colour */
  cells: number[][];
  /** "#rrggbb" for colours 1..3 */
  colours: string[];
}

export class DesignError extends Error {}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

/** The design's bytes, after checking its shape. Empty border rows and columns are trimmed first. */
export function encodeDesign(d: Design): Uint8Array {
  const t = trimDesign(d);
  const h = t.cells.length;
  const w = t.cells[0]?.length ?? 0;
  checkShape(t.slot, w, h, t.colours.length);
  const colours = t.colours.map((c) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(c)) throw new DesignError(`bad colour ${c}`);
    return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  });
  const cellBytes = Math.ceil((w * h * 2) / 8);
  const out = new Uint8Array(4 + colours.length * 3 + cellBytes);
  out[0] = SLOTS.indexOf(t.slot);
  out[1] = w;
  out[2] = h;
  out[3] = colours.length;
  colours.forEach((rgb, i) => out.set(rgb, 4 + i * 3));
  const base = 4 + colours.length * 3;
  let k = 0;
  for (const row of t.cells)
    for (const v of row) {
      if (!Number.isInteger(v) || v < 0 || v > colours.length) throw new DesignError("a cell uses a colour that is not there");
      out[base + (k >> 2)]! |= v << ((k & 3) * 2);
      k++;
    }
  return out;
}

/** A design from its bytes, checked as the contract checks them. */
export function decodeDesign(b: Uint8Array): Design {
  if (b.length < 7) throw new DesignError("too short");
  const slot = SLOTS[b[0]!];
  const w = b[1]!;
  const h = b[2]!;
  const n = b[3]!;
  if (!slot) throw new DesignError("bad slot");
  checkShape(slot, w, h, n);
  if (b.length !== 4 + n * 3 + Math.ceil((w * h * 2) / 8)) throw new DesignError("wrong length");
  const colours = Array.from({ length: n }, (_, i) => `#${hex2(b[4 + i * 3]!)}${hex2(b[5 + i * 3]!)}${hex2(b[6 + i * 3]!)}`);
  const base = 4 + n * 3;
  const cells: number[][] = [];
  let k = 0;
  for (let y = 0; y < h; y++) {
    const row: number[] = [];
    for (let x = 0; x < w; x++, k++) {
      const v = (b[base + (k >> 2)]! >> ((k & 3) * 2)) & 3;
      if (v > n) throw new DesignError("a cell uses a colour that is not there");
      row.push(v);
    }
    cells.push(row);
  }
  for (; k < (b.length - base) * 4; k++) if ((b[base + (k >> 2)]! >> ((k & 3) * 2)) & 3) throw new DesignError("stray bits after the last cell");
  return { slot, cells, colours };
}

function checkShape(slot: Slot, w: number, h: number, n: number) {
  if (w < 1 || h < 1 || w > DESIGN_MAX_W || h > DESIGN_MAX_H) throw new DesignError(`size ${w}×${h} is outside 1-${DESIGN_MAX_W} by 1-${DESIGN_MAX_H}`);
  if (slot === "face" && w > DESIGN_FACE_MAX_W) throw new DesignError(`a face piece is at most ${DESIGN_FACE_MAX_W} wide`);
  if (n < 1 || n > DESIGN_MAX_COLOURS) throw new DesignError(`1 to ${DESIGN_MAX_COLOURS} colours`);
}

/** Drop empty rows and columns around the drawing. A drawing with nothing in it is an error. */
export function trimDesign(d: Design): Design {
  const rows = d.cells;
  const filled = (y: number) => rows[y]!.some((v) => v > 0);
  let top = 0;
  while (top < rows.length && !filled(top)) top++;
  if (top === rows.length) throw new DesignError("nothing is drawn");
  let bottom = rows.length - 1;
  while (!filled(bottom)) bottom--;
  const width = Math.max(...rows.map((r) => r.length));
  const col = (x: number) => rows.some((r) => (r[x] ?? 0) > 0);
  let left = 0;
  while (!col(left)) left++;
  let right = width - 1;
  while (!col(right)) right--;
  return { ...d, cells: rows.slice(top, bottom + 1).map((r) => Array.from({ length: right - left + 1 }, (_, i) => r[left + i] ?? 0)) };
}

const KEYS = [".", "a", "b", "c"] as const;

/** A design as a Wearable, ready for wearOverlay. */
export function designWearable(id: string, d: Design, name: { en: string; zh: string }): Wearable {
  const rows = d.cells.map((r) => r.map((v) => KEYS[v]).join(""));
  const colors: Record<string, string> = {};
  d.colours.forEach((c, i) => (colors[KEYS[i + 1]!] = c));
  return { id, slot: d.slot, name, rows, ...(d.slot === "face" ? { rowsSmall: rows } : {}), colors };
}
