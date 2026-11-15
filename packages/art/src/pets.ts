/**
 * Lingxi pet bodies, drawn on a 48×48 canvas with the feet resting on row 45.
 * Proportions: about 36 pixels wide when grown, a
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
  /** the adult form care and diet chose (adults only; see @lingxi/game evolution) */
  form?: Form;
}

/**
 * Adult forms. Care and diet decide which one a pet grows into, and the body
 * shows it: every line keeps its own shape and gains the form's features.
 *   puff       the line's own adult, unchanged
 *   blossom    a flower tucked by the ear, soft pink cheeks of petals at the feet
 *   dumpling   rounder and heavier, a pale belly and pleats on the crown
 *   scholar    a little square cap with a tassel
 *   moonpetal  (rare) a crescent moon and starlight, the trace always lit
 */
export const FORMS = ["puff", "blossom", "dumpling", "scholar", "moonpetal"] as const;
export type Form = (typeof FORMS)[number];

/** Where each line's features sit on its adult body (hand-placed). */
export const ANCHORS: Record<"gentle" | "bold" | "curious", { ear: [number, number]; hat: [number, number]; moon: [number, number]; pleat: [number, number] }> = {
  gentle: { ear: [15, 23], hat: [20, 12], moon: [38, 9], pleat: [21, 21] },
  bold: { ear: [10, 27], hat: [31, 17], moon: [6, 8], pleat: [20, 24] },
  curious: { ear: [17, 22], hat: [20, 13], moon: [40, 9], pleat: [21, 21] },
};

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

/* ── the bold line (Hoshi): stocky, a star crest that grows into a horn, a bolt tail ── */

const HOSHI: Record<Exclude<Stage, "egg">, BodySpec> = {
  baby: {
    face: { x: 24, y: 39, size: "S" },
    shadow: 8,
    draw: (m, o) => {
      m.ellipse(24, 39 + o.squash * 0.5, 8.5 - o.breath * 0.5 + o.squash * 0.6, 6.2 + o.breath * 0.5 - o.squash * 0.6);
      // a three-point tuft on the crown
      m.stamp(["#.#.#", "#####"], 22, 31);
    },
    finish: (c) => {
      c.stamp(["x.x.x", "xxxxx"], 22, 31);
      c.stamp(["hh", "h."], 19, 35);
    },
  },
  child: {
    face: { x: 24, y: 38, size: "S" },
    shadow: 10,
    draw: (m, o) => {
      m.ellipse(24, 37 + o.squash * 0.5, 11 - o.breath * 0.5 + o.squash * 0.7, 8 + o.breath * 0.5 - o.squash * 0.7);
      // round little ears
      m.ellipse(16.5, 30, 2.6, 2.6);
      m.ellipse(31.5, 30, 2.6, 2.6);
      // the crest: a small star
      m.stamp(["..#..", ".###.", "#####", ".#.#."], 22, 27);
      m.ellipse(19.5, 44, 2.8, 1.6);
      m.ellipse(28.5, 44, 2.8, 1.6);
    },
    finish: (c) => {
      c.stamp(["..x..", ".xxx.", "xxxxX", ".X.X."], 22, 27);
      c.set(16, 30, "b");
      c.set(31, 30, "b");
      c.stamp(["hhh", "hh."], 16, 32);
    },
  },
  teen: {
    face: { x: 24, y: 36, size: "L" },
    trace: { y: 29, half: 4 },
    shadow: 12,
    draw: (m, o) => {
      m.ellipse(24, 35 + o.squash * 0.5, 13 - o.breath * 0.5 + o.squash * 0.8, 9.5 + o.breath * 0.5 - o.squash * 0.8);
      m.ellipse(14.5, 27, 3, 3);
      m.ellipse(33.5, 27, 3, 3);
      // the star crest, taller
      m.stamp(["...#...", "..###..", "#######", ".#####.", ".##.##."], 21, 22);
      m.ellipse(18, 44, 3.3, 1.8);
      m.ellipse(30, 44, 3.3, 1.8);
      // a bolt for a tail
      m.stamp(["...##", "..##.", ".####", "..##.", ".##.."], 35, 33);
    },
    finish: (c) => {
      c.stamp(["...x...", "..xxx..", "xxxxxxX", ".xxxxX.", ".xX.XX."], 21, 22);
      c.stamp(["bb", "bb"], 14, 26);
      c.stamp(["bb", "bb"], 33, 26);
      c.stamp(["hhh", "hh.", "h.."], 14, 30);
      // a light chest patch
      c.stamp([".lll.", "lllll", ".lll."], 22, 41);
    },
  },
  adult: {
    face: { x: 24, y: 34, size: "L" },
    trace: { y: 26, half: 5 },
    shadow: 14,
    draw: (m, o) => {
      // broad and solid, standing square
      m.ellipse(24, 33 + o.squash * 0.5, 15 - o.breath * 0.5 + o.squash, 11.5 + o.breath * 0.5 - o.squash);
      m.ellipse(12, 24, 3.4, 3.4);
      m.ellipse(36, 24, 3.4, 3.4);
      // the star horn
      m.stamp(["....#....", "...###...", "..#####..", "#########", ".#######.", "..##.##..", ".##...##."], 20, 16);
      m.ellipse(17.5, 44.3, 3.8, 1.8);
      m.ellipse(30.5, 44.3, 3.8, 1.8);
      m.stamp(["...###", "..###.", ".#####", "..###.", ".###..", ".##..."], 37, 30);
    },
    finish: (c) => {
      c.stamp(["....x....", "...xxx...", "..xxxxx..", "xxxxxxxxX", ".xxxxxxX.", "..xX.XX..", ".xX...XX."], 20, 16);
      c.stamp([".bb", "bbb", "bb."], 11, 23);
      c.stamp(["bb.", "bbb", ".bb"], 35, 23);
      c.stamp(["hhh", "hh.", "h.."], 13, 27);
      c.stamp(["..lll..", ".lllll.", "lllllll", ".lllll."], 21, 39);
    },
  },
};

/* ── the curious line (Sora): long ears that keep growing, a sprout antenna, a fluffy tail ── */

const SORA: Record<Exclude<Stage, "egg">, BodySpec> = {
  baby: {
    face: { x: 24, y: 39, size: "S" },
    shadow: 8,
    draw: (m, o) => {
      m.ellipse(24, 39 + o.squash * 0.5, 7.5 - o.breath * 0.5 + o.squash * 0.6, 6.5 + o.breath * 0.5 - o.squash * 0.6);
      // two soft ears, flopping outward
      m.ellipse(17.5, 34, 2, 3.4);
      m.ellipse(30.5, 34, 2, 3.4);
    },
    finish: (c) => {
      c.stamp(["b", "b"], 17, 33);
      c.stamp(["b", "b"], 30, 33);
      c.stamp(["hh", "h."], 20, 35);
    },
  },
  child: {
    face: { x: 24, y: 38, size: "S" },
    shadow: 9,
    draw: (m, o) => {
      m.ellipse(24, 37 + o.squash * 0.5, 9.5 - o.breath * 0.5 + o.squash * 0.7, 8.5 + o.breath * 0.5 - o.squash * 0.7);
      // ears stand up now, leaning a little apart
      m.polygon([[17, 31], [15.5, 20], [19, 19.5], [21, 30]]);
      m.polygon([[31, 31], [32.5, 20], [29, 19.5], [27, 30]]);
      m.ellipse(20, 44.2, 2.4, 1.6);
      m.ellipse(28, 44.2, 2.4, 1.6);
    },
    finish: (c) => {
      c.stamp(["b", "b", "b", "b"], 17, 22);
      c.stamp(["b", "b", "b", "b"], 30, 22);
      c.stamp(["hhh", "hh."], 18, 32);
    },
  },
  teen: {
    face: { x: 24, y: 36, size: "L" },
    trace: { y: 29, half: 4 },
    shadow: 11,
    draw: (m, o) => {
      m.ellipse(24, 35 + o.squash * 0.5, 11.5 - o.breath * 0.5 + o.squash * 0.8, 10 + o.breath * 0.5 - o.squash * 0.8);
      m.polygon([[15.5, 28], [13, 13], [17.5, 12.5], [20.5, 27]]);
      m.polygon([[32.5, 28], [35, 13], [30.5, 12.5], [27.5, 27]]);
      m.ellipse(19, 44.2, 2.8, 1.7);
      m.ellipse(29, 44.2, 2.8, 1.7);
      // a fluffy tail on the left
      m.ellipse(13.5, 41.5, 2.6, 2.2);
    },
    finish: (c) => {
      c.stamp([".b", "bb", "bb", "bb", "b."], 15, 15);
      c.stamp(["b.", "bb", "bb", "bb", ".b"], 31, 15);
      c.stamp(["hhh", "hh.", "h.."], 16, 28);
      c.stamp(["ll", "l."], 12, 40);
    },
  },
  adult: {
    face: { x: 24, y: 34, size: "L" },
    trace: { y: 26, half: 5 },
    shadow: 13,
    draw: (m, o) => {
      m.ellipse(24, 33 + o.squash * 0.5, 13 - o.breath * 0.5 + o.squash, 12.5 + o.breath * 0.5 - o.squash);
      // tall ears, tips turned out
      m.polygon([[14, 25], [10.5, 7], [15.5, 6], [20, 22]]);
      m.polygon([[34, 25], [37.5, 7], [32.5, 6], [28, 22]]);
      m.ellipse(18.5, 44.3, 3, 1.7);
      m.ellipse(29.5, 44.3, 3, 1.7);
      m.ellipse(11.5, 40.5, 3.2, 2.8);
    },
    finish: (c) => {
      c.stamp([".b", "bb", "bb", "bb", "bb", "b."], 13, 9);
      c.stamp(["b.", "bb", "bb", "bb", "bb", ".b"], 34, 9);
      // ear tips in the accent colour
      c.stamp(["xx", "x."], 11, 6);
      c.stamp(["xx", ".x"], 35, 6);
      // a little sprout antenna between the ears
      c.stamp(["x.x", ".O.", ".O."], 23, 18);
      c.stamp(["hhh", "hh.", "h.."], 14, 25);
      c.stamp(["ll", "l."], 10, 39);
    },
  },
};

export const LINES = { gentle: MOCHI, bold: HOSHI, curious: SORA } as const;
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

/** The pet without its face: what the on-chain picture uses as the body layer. */
export function drawBody(line: Line, stage: Exclude<Stage, "egg">, opt: PoseOptions = {}): PixelCanvas {
  const spec = LINES[line][stage];
  const pose = { breath: opt.breath ?? 0, squash: opt.squash ?? 0 } as const;
  const form = stage === "adult" ? (opt.form ?? "puff") : "puff";
  const c = new PixelCanvas(SIZE, SIZE);
  groundShadow(c, 24, GROUND, spec.shadow + (form === "dumpling" ? 2 : 0));
  const m = new Mask(SIZE, SIZE);
  spec.draw(m, pose);
  // a dumpling settles lower and wider
  if (form === "dumpling") m.ellipse(24, 36.5 + pose.squash * 0.5, 16.5 + pose.squash, 8.5 - pose.squash * 0.5);
  paintBody(c, m, { shade: stage === "baby" ? 1 : stage === "child" ? 2 : 3, light: stage === "baby" ? 1 : 2, deep: stage === "adult" || stage === "teen" });
  cleanOutline(c);
  spec.finish?.(c, pose);
  const lit = (opt.lit ?? false) || form === "moonpetal";
  if (spec.trace) drawTrace(c, 24, spec.trace.y + (pose.breath ? -1 : 0), spec.trace.half, lit);
  if (form !== "puff") formFeatures(c, line, form, pose.breath);
  return c;
}

function formFeatures(c: PixelCanvas, line: Line, form: Form, breath: 0 | 1): void {
  const a = ANCHORS[line];
  const b = breath ? -1 : 0;
  if (form === "blossom") {
    // a four-petal flower by the ear, and petals fallen at the feet
    c.stamp([".pp.pp.", "pwp.pwp", ".pptpp.", "..ttt..", ".pptpp.", "pwp.pwp", ".pp.pp."], a.ear[0] - 3, a.ear[1] - 3 + b);
    c.stamp(["pp.", "pwp", ".p."], 11, 42);
    c.stamp([".pp", "pwp", ".p."], 34, 42);
  } else if (form === "dumpling") {
    // a pale round belly and pleats where the dough gathers
    c.stamp(["..hhhhh..", ".hhhhhhh.", "hhhhhhhhh", ".hhhhhhh."], 20, 38);
    c.stamp(["O.O.O.O", ".O.O.O."], a.pleat[0] - 1, a.pleat[1] + b);
  } else if (form === "scholar") {
    // a square cap with a tassel
    c.stamp(["....e....", "..eeeeee.", "eeeeeeeee", "..eeeee.t", "..eeeee.t", "........t"], a.hat[0], a.hat[1] + b);
  } else if (form === "moonpetal") {
    // a crescent moon, starlight, and petals drifting by
    c.stamp(["..ttt", ".tt..", "tt...", "tt...", "tt...", ".tt..", "..ttt"], a.moon[0], a.moon[1] + b);
    c.stamp([".w.", "www", ".w."], a.moon[0] + 5, a.moon[1] - 2 + b);
    c.set(a.moon[0] + 6, a.moon[1] + 6 + b, "w");
    c.set(a.moon[0] - 2, a.moon[1] + 9 + b, "w");
    c.stamp(["pp", ".p"], 9, 30 + b);
    c.stamp(["pp", "p."], 37, 34 + b);
  }
}

/** Which face set a stage uses and where its centre sits. */
export function faceAnchor(line: Line, stage: Exclude<Stage, "egg">, squash = 0): { size: "L" | "S"; x: number; y: number } {
  const f = LINES[line][stage].face;
  return { size: f.size, x: f.x, y: f.y + half(squash) };
}

export function drawPet(line: Line, stage: Exclude<Stage, "egg">, opt: PoseOptions = {}): PixelCanvas {
  const c = drawBody(line, stage, opt);
  const a = faceAnchor(line, stage, opt.squash ?? 0);
  c.stampCentered((a.size === "L" ? FACES_L : FACES_S)[opt.expression ?? "neutral"], a.x, a.y);
  return c;
}
