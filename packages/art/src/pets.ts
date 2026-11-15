/**
 * Lingxi pet bodies, drawn on a 48×48 canvas with the feet resting on row 45.
 * Proportions follow the source game's pets (about 36 pixels wide when grown, a
 * one-pixel outline in a darker hue of the body, two shade steps, a small
 * highlight), with Sunrise Pet's round face and the circuit-trace mark.
 *
 * Each body is a silhouette built from clean shapes plus hand-placed details,
 * then painted with paintBody and finished by hand (inner ears, highlight,
 * trace, accents). Faces come from faces.ts.
 */

import { type Expression, FACES_L, FACES_S } from "./faces";
import { Mask, PixelCanvas, cleanOutline, groundShadow, paintBody } from "./pixel";

export const SIZE = 48;
export const GROUND = 45;

export type Stage = "egg" | "baby" | "child" | "teen" | "adult";
export const STAGES: readonly Stage[] = ["egg", "baby", "child", "teen", "adult"];

export interface PoseOptions {
  expression?: Expression;
  /** 0 = rest, 1 = breathing in (one pixel taller, narrower) */
  breath?: 0 | 1;
  /** -1, 0, 1: squash (landing) or stretch (jump) */
  squash?: -1 | 0 | 1;
  /** circuit trace lit */
  lit?: boolean;
}

interface BodySpec {
  face: { x: number; y: number; size: "L" | "S" };
  trace?: { y: number; half: number };
  draw: (m: Mask, o: Required<Pick<PoseOptions, "breath" | "squash">>) => void;
  finish?: (c: PixelCanvas, o: Required<Pick<PoseOptions, "breath" | "squash">>) => void;
  shadow: number;
}

const half = (n: number) => n / 2;

/* ── the egg ─────────────────────────────────────────────────────────────── */

export function drawEgg(spots: "coral" | "sky" | "sunny" = "coral", wobble: -1 | 0 | 1 = 0, crack = 0): PixelCanvas {
  const c = new PixelCanvas(SIZE, SIZE);
  groundShadow(c, 24, GROUND, 9);
  const m = new Mask(SIZE, SIZE);
  // egg: narrower at the top
  for (let y = 24; y <= GROUND; y++) {
    const t = (y - 24) / (GROUND - 24); // 0 top, 1 bottom
    const w = t < 0.62 ? 9.5 * Math.sqrt(Math.sin((t / 0.62) * (Math.PI / 2))) : 9.5 * Math.sqrt(1 - ((t - 0.62) / 0.38) ** 2 * 0.86);
    const shift = wobble * Math.round(((GROUND - y) / (GROUND - 24)) * 1.5);
    for (let x = 0; x < SIZE; x++) if (Math.abs(x + 0.5 - (24 + shift)) <= w) m.set(x, y);
  }
  paintBody(c, m, { shade: 2, deep: true });
  // spots in the line's colour (drawn with accent roles, recoloured per line)
  const spotsAt: [number, number][] = [
    [20 + wobble, 31],
    [27 + wobble, 35],
    [21 + wobble, 39],
    [28 + wobble, 41],
  ];
  for (const [x, y] of spotsAt) c.stamp([".xx.", "xxxx", "xxxX", ".XX."], x - 2, y - 2);
  c.stamp(["hh", "h."], 19 + wobble, 28);
  if (crack > 0) {
    const zig = ["e.....", ".e...e", "..e.e.", "...e.."];
    c.stamp(zig.slice(0, Math.min(4, crack + 1)), 20 + wobble, 30);
  }
  void spots;
  return c;
}

/* ── the gentle line (Mochi) ─────────────────────────────────────────────── */

const MOCHI: Record<Exclude<Stage, "egg">, BodySpec> = {
  baby: {
    face: { x: 24, y: 39, size: "S" },
    shadow: 8,
    draw: (m, o) => {
      m.ellipse(24, 39 + o.squash * 0.5, 8 - o.breath * 0.5 + o.squash * 0.6, 6.5 + o.breath * 0.5 - o.squash * 0.6);
      m.polygon([[17, 36], [18, 31], [21.5, 34]]);
      m.polygon([[31, 36], [30, 31], [26.5, 34]]);
    },
    finish: (c) => {
      c.set(18, 33, "b");
      c.set(29, 33, "b");
      c.stamp(["hh", "h."], 19, 35);
    },
  },
  child: {
    face: { x: 24, y: 38, size: "S" },
    shadow: 10,
    draw: (m, o) => {
      m.ellipse(24, 36.5 + o.squash * 0.5, 10.5 - o.breath * 0.5 + o.squash * 0.7, 8.5 + o.breath * 0.5 - o.squash * 0.7);
      m.polygon([[16, 31], [17, 23.5], [22, 28.5]]);
      m.polygon([[32, 31], [31, 23.5], [26, 28.5]]);
      m.ellipse(19.5, 44, 2.6, 1.6);
      m.ellipse(28.5, 44, 2.6, 1.6);
    },
    finish: (c) => {
      c.stamp(["b", "b"], 18, 26);
      c.stamp(["b", "b"], 29, 26);
      c.stamp(["hhh", "hh."], 17, 31);
    },
  },
  teen: {
    face: { x: 24, y: 36, size: "L" },
    trace: { y: 29, half: 4 },
    shadow: 12,
    draw: (m, o) => {
      m.ellipse(24, 34.5 + o.squash * 0.5, 12.5 - o.breath * 0.5 + o.squash * 0.8, 10 + o.breath * 0.5 - o.squash * 0.8);
      m.polygon([[14.5, 28], [15.5, 18], [21.5, 24.5]]);
      m.polygon([[33.5, 28], [32.5, 18], [26.5, 24.5]]);
      m.ellipse(18.5, 44, 3, 1.8);
      m.ellipse(29.5, 44, 3, 1.8);
      // tail
      m.stamp(["..##", ".###", "###.", "##.."], 34, 36);
    },
    finish: (c) => {
      c.stamp([".b", "bb", "bb"], 16, 21);
      c.stamp(["b.", "bb", "bb"], 31, 21);
      c.stamp(["hhh", "hh.", "h.."], 15, 28);
    },
  },
  adult: {
    face: { x: 24, y: 34, size: "L" },
    trace: { y: 26, half: 5 },
    shadow: 13,
    draw: (m, o) => {
      m.ellipse(24, 32.5 + o.squash * 0.5, 14 - o.breath * 0.5 + o.squash, 12.5 + o.breath * 0.5 - o.squash);
      // ears: small, upright, set on the shoulders of the head
      m.polygon([[13, 25], [14.5, 13.5], [21, 20.5]]);
      m.polygon([[35, 25], [33.5, 13.5], [27, 20.5]]);
      // feet, half tucked under
      m.ellipse(18.5, 44.2, 3, 1.7);
      m.ellipse(29.5, 44.2, 3, 1.7);
      // tail: a short curl on the right
      m.stamp(["..##.", ".####", "###..", "##..."], 36, 34);
    },
    finish: (c) => {
      c.stamp([".b", ".b", "bb", "bb"], 15, 16);
      c.stamp(["b.", "b.", "bb", "bb"], 32, 16);
      // sprout grows from the crown
      c.stamp(["XxX..Xx", ".Xxx.xX", "...O...", "...O..."], 21, 16);
      c.stamp(["hhh", "hh.", "h.."], 15, 26);
      c.set(19, 23, "h");
    },
  },
};

export const LINES = { gentle: MOCHI } as const;
export type Line = keyof typeof LINES;

function drawTrace(c: PixelCanvas, cx: number, y: number, halfW: number, lit: boolean): void {
  const t = lit ? "t" : "d";
  for (let x = cx - halfW; x <= cx + halfW - 1; x++) c.set(x, y, t);
  c.set(cx - 1, y - 1, t);
  c.set(cx - 1, y - 2, t);
  c.set(cx, y - 2, t);
  c.set(cx - halfW - 1, y, "n");
  c.set(cx + halfW, y, "n");
  if (lit) {
    c.set(cx + 1, y - 2, "t");
  }
}

export function drawPet(line: Line, stage: Exclude<Stage, "egg">, opt: PoseOptions = {}): PixelCanvas {
  const spec = LINES[line][stage];
  const pose = { breath: opt.breath ?? 0, squash: opt.squash ?? 0 } as const;
  const c = new PixelCanvas(SIZE, SIZE);
  groundShadow(c, 24, GROUND, spec.shadow);
  const m = new Mask(SIZE, SIZE);
  spec.draw(m, pose);
  paintBody(c, m, { shade: stage === "baby" ? 1 : stage === "child" ? 2 : 3, light: stage === "baby" ? 1 : 2, deep: stage === "adult" || stage === "teen" });
  cleanOutline(c);
  spec.finish?.(c, pose);
  if (spec.trace) drawTrace(c, 24, spec.trace.y + (pose.breath ? -1 : 0), spec.trace.half, opt.lit ?? false);
  const face = spec.face.size === "L" ? FACES_L : FACES_S;
  c.stampCentered(face[opt.expression ?? "neutral"], spec.face.x, spec.face.y + half(pose.squash));
  return c;
}
