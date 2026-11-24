/**
 * A tiny pixel-art canvas. Every sprite in Lingxi is drawn on one of these,
 * one palette role per pixel, then coloured by a palette at the end so a single
 * drawing can be recoloured (egg lines, rare forms, night tint).
 *
 * The drawing method is the one pixel artists use in an editor: block the
 * silhouette with clean shapes, then place every detail by hand (faces, ears,
 * highlights, trace lines). Shapes are rasterised at pixel centres so curves
 * come out symmetric and free of stray pixels.
 */

export type Role =
  | "." // transparent
  | "O" // outline, shadow side
  | "o" // outline, lit side (selective outline)
  | "D" // deep shade
  | "d" // shade
  | "m" // main
  | "l" // light
  | "h" // highlight
  | "b" // blush
  | "e" // eye ink
  | "w" // eye shine
  | "p" // mouth inside
  | "t" // circuit trace
  | "n" // trace node
  | "x" // accent (leaf, horn, gem)
  | "X" // accent shade
  | "s"; // ground shadow

export const ROLES: readonly Role[] = [
  ".",
  "O",
  "o",
  "D",
  "d",
  "m",
  "l",
  "h",
  "b",
  "e",
  "w",
  "p",
  "t",
  "n",
  "x",
  "X",
  "s",
];

export type Palette = Record<Exclude<Role, ".">, string>;

export class PixelCanvas {
  readonly px: Role[];
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Array<Role>(w * h).fill(".");
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x: number, y: number): Role {
    return this.inside(x, y) ? this.px[y * this.w + x]! : ".";
  }
  set(x: number, y: number, r: Role): void {
    if (this.inside(x, y)) this.px[y * this.w + x] = r;
  }

  /** Paint a hand-drawn stamp. "." leaves the pixel as it is; "_" clears it. */
  stamp(rows: readonly string[], left: number, top: number): void {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const c = row[i]!;
        if (c === ".") continue;
        this.set(left + i, top + j, c === "_" ? "." : (c as Role));
      }
    });
  }

  /** Stamp centred on (cx, cy), for faces and accessories. */
  stampCentered(rows: readonly string[], cx: number, cy: number): void {
    const w = Math.max(...rows.map((r) => r.length));
    this.stamp(rows, Math.round(cx - w / 2), Math.round(cy - rows.length / 2));
  }

  clone(): PixelCanvas {
    const c = new PixelCanvas(this.w, this.h);
    for (let i = 0; i < this.px.length; i++) c.px[i] = this.px[i]!;
    return c;
  }

  flipX(): PixelCanvas {
    const c = new PixelCanvas(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) c.set(this.w - 1 - x, y, this.get(x, y));
    return c;
  }

  /** Copy every non-transparent pixel of `src` onto this canvas at an offset. */
  overlay(src: PixelCanvas, dx = 0, dy = 0): void {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const r = src.get(x, y);
        if (r !== ".") this.set(x + dx, y + dy, r);
      }
  }
}

/* ── silhouettes ─────────────────────────────────────────────────────────── */

export class Mask {
  readonly on: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.on = new Uint8Array(w * h);
  }
  get(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.on[y * this.w + x] === 1;
  }
  set(x: number, y: number, v = true): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.on[y * this.w + x] = v ? 1 : 0;
  }
  /** Ellipse sampled at pixel centres; cx, cy may be half-integers for even widths. */
  ellipse(cx: number, cy: number, rx: number, ry: number, v = true): this {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, v);
      }
    return this;
  }
  /** A filled polygon (even-odd), points in pixel coordinates. */
  polygon(pts: readonly [number, number][], v = true): this {
    const ys = pts.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const py = y + 0.5;
      for (let x = 0; x < this.w; x++) {
        const px = x + 0.5;
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i]!;
          const [xj, yj] = pts[j]!;
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) this.set(x, y, v);
      }
    }
    return this;
  }
  rect(x0: number, y0: number, w: number, h: number, v = true): this {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, v);
    return this;
  }
  /** Stamp a hand-drawn mask: "#" on, "_" off, anything else unchanged. */
  stamp(rows: readonly string[], left: number, top: number): this {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        if (row[i] === "#") this.set(left + i, top + j, true);
        else if (row[i] === "_") this.set(left + i, top + j, false);
      }
    });
    return this;
  }
  /** Mirror the left half onto the right, for symmetric bodies. */
  mirror(): this {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w >> 1; x++) this.set(this.w - 1 - x, y, this.get(x, y));
    return this;
  }
  count(): number {
    let n = 0;
    for (const v of this.on) n += v;
    return n;
  }
}

export interface ShadeOptions {
  /** light comes from the top left; shade band thickness on the far side */
  shade?: number;
  /** a second, deeper band right at the far edge */
  deep?: boolean;
  /** lit band thickness on the near side */
  light?: number;
}

/**
 * Fill a silhouette with the house style:
 *   - a one-pixel outline on its own edge, dark on the shadow side and softer on
 *     the lit side (selective outline, which reads as soft rather than stamped);
 *   - main colour inside, a light band along the top left, a shade band along the
 *     bottom right, and optionally a deep band in the lowest corner.
 */
export function paintBody(c: PixelCanvas, m: Mask, opt: ShadeOptions = {}): void {
  const shade = opt.shade ?? 2;
  const light = opt.light ?? 1;
  const out = (x: number, y: number) => !m.get(x, y);
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      if (!m.get(x, y)) continue;
      const edge = out(x - 1, y) || out(x + 1, y) || out(x, y - 1) || out(x, y + 1);
      if (edge) {
        // lit side: the outside neighbour is up or left
        const litSide = (out(x - 1, y) || out(x, y - 1)) && !out(x + 1, y) && !out(x, y + 1);
        c.set(x, y, litSide ? "o" : "O");
        continue;
      }
      let role: Role = "m";
      let far = false;
      for (let k = 1; k <= shade && !far; k++) if (out(x + k, y + k) || out(x, y + k + 1)) far = true;
      if (far) role = "d";
      if (opt.deep && (out(x + 1, y + 1) || out(x, y + 2)) && (out(x + 2, y) || out(x, y + 1) || out(x + 1, y + 2)))
        role = "D";
      if (role === "m") {
        for (let k = 1; k <= light; k++) if (out(x - k, y - k) || out(x, y - k - 1)) role = "l";
      }
      c.set(x, y, role);
    }
}

/** Remove outline pixels that make a line two pixels thick at a corner. */
export function cleanOutline(c: PixelCanvas): void {
  const isLine = (x: number, y: number) => {
    const r = c.get(x, y);
    return r === "O" || r === "o";
  };
  for (let pass = 0; pass < 2; pass++)
    for (let y = 1; y < c.h - 1; y++)
      for (let x = 1; x < c.w - 1; x++) {
        if (!isLine(x, y)) continue;
        const n = isLine(x, y - 1);
        const s = isLine(x, y + 1);
        const e = isLine(x + 1, y);
        const w = isLine(x - 1, y);
        // an L corner: two orthogonal line neighbours whose shared diagonal is also line
        const corner =
          (n && e && isLine(x + 1, y - 1)) ||
          (n && w && isLine(x - 1, y - 1)) ||
          (s && e && isLine(x + 1, y + 1)) ||
          (s && w && isLine(x - 1, y + 1));
        if (!corner) continue;
        const outside = [c.get(x - 1, y), c.get(x + 1, y), c.get(x, y - 1), c.get(x, y + 1)].includes(".");
        if (!outside) c.set(x, y, "m");
      }
}

/** A soft oval shadow under a sprite. */
export function groundShadow(c: PixelCanvas, cx: number, y: number, rx: number): void {
  const m = new Mask(c.w, c.h).ellipse(cx, y + 0.5, rx, 1.6);
  for (let j = 0; j < c.h; j++) for (let i = 0; i < c.w; i++) if (m.get(i, j) && c.get(i, j) === ".") c.set(i, j, "s");
}

/* ── colour ──────────────────────────────────────────────────────────────── */

export function hexToRgba(hex: string): [number, number, number, number] {
  const h = hex.replace("#", "");
  const v = parseInt(h.length === 6 ? h + "ff" : h, 16);
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
}

/** RGBA bytes for the canvas under a palette, scaled by a whole number. */
export function toRgba(c: PixelCanvas, pal: Palette, scale = 1): Uint8ClampedArray {
  const W = c.w * scale;
  const out = new Uint8ClampedArray(W * c.h * scale * 4);
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      const r = c.get(x, y);
      if (r === ".") continue;
      const [R, G, B, A] = hexToRgba(pal[r]);
      for (let j = 0; j < scale; j++)
        for (let i = 0; i < scale; i++) {
          const o = ((y * scale + j) * W + x * scale + i) * 4;
          out[o] = R;
          out[o + 1] = G;
          out[o + 2] = B;
          out[o + 3] = A;
        }
    }
  return out;
}

/** The smallest box holding every drawn pixel, ignoring the ground shadow. */
export function boundingBox(c: PixelCanvas): { x: number; y: number; w: number; h: number } {
  let x0 = c.w,
    y0 = c.h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      const r = c.get(x, y);
      if (r === "." || r === "s") continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  if (x1 < 0) return { x: 0, y: 0, w: c.w, h: c.h };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
