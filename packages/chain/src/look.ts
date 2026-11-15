/**
 * The pet's on-chain picture (PetLook): the game's own pixel art cut into layers
 * small enough to store on X Layer, and the rules for putting them together.
 *
 * Layers (each a list of horizontal runs: x, y, length, colour role; 4 bytes per run):
 *   body 0      the egg
 *   body 1..4   baby, child, teen, adult without a face (trace unlit)
 *   lit  1..4   the pixels that change when the circuit trace lights up
 *   face 0..15  small faces (babies, children), 16..31 large faces (teens, adults),
 *               drawn at the stage's face offset
 *
 * `lookOf` chooses the stage, face and trace from the saved 256-bit state, exactly
 * as PetLook.sol does; `composeLook` builds the same picture in TypeScript so a test
 * can compare the contract's drawing with the game's sprite pixel by pixel.
 */

import { EXPRESSIONS, FACES_L, FACES_S, ROLES, PixelCanvas, boundingBox, drawBody, drawEgg, drawPet, faceAnchor, type Expression, type Role } from "@lingxi/art";

export const LOOK_STAGES = ["egg", "baby", "child", "teen", "adult"] as const;
type PetStage = Exclude<(typeof LOOK_STAGES)[number], "egg">;
const PET_STAGES: readonly PetStage[] = ["baby", "child", "teen", "adult"];
const SIZE = 48;

/** Colour role → index in PetLook's palettes (0 is transparent and never stored). */
export const roleIndex = (r: Role): number => ROLES.indexOf(r);

function runsOf(px: (x: number, y: number) => Role | null): number[] {
  const out: number[] = [];
  for (let y = 0; y < SIZE; y++) {
    let x = 0;
    while (x < SIZE) {
      const r = px(x, y);
      if (r === null || r === ".") {
        x++;
        continue;
      }
      let len = 1;
      while (x + len < SIZE && px(x + len, y) === r) len++;
      out.push(x, y, len, roleIndex(r));
      x += len;
    }
  }
  return out;
}

const hex = (bytes: number[]): `0x${string}` => `0x${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`;

function stampRuns(rows: readonly string[]): number[] {
  const out: number[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x]!;
      if (c === ".") {
        x++;
        continue;
      }
      if (c === "_") throw new Error("faces must not clear pixels");
      let len = 1;
      while (x + len < row.length && row[x + len] === c) len++;
      out.push(x, y, len, roleIndex(c as Role));
      x += len;
    }
  });
  return out;
}

export interface LookLayers {
  /** key → bytes; keys as PetLook stores them */
  layers: Array<{ key: number; data: `0x${string}`; runs: number }>;
  /** per pet stage 1..4: which face set, and each face's top-left (faces differ in size) */
  anchors: Array<{ stage: number; large: boolean; at: Array<[number, number]> }>;
  /** per stage 0..4: the square of the canvas the picture shows */
  frames: Array<{ stage: number; x: number; y: number; size: number }>;
}

/** A square around the sprite, a little roomier than the pet, ground near the bottom; growth still shows. */
export function frameFor(c: PixelCanvas): { x: number; y: number; size: number } {
  const b = boundingBox(c);
  const size = Math.min(40, Math.max(28, Math.ceil((Math.max(b.w, b.h) + 12) / 2) * 2));
  const x = Math.min(48 - size, Math.max(0, Math.round(b.x + b.w / 2 - size / 2)));
  const y = Math.min(48 - size, Math.max(0, b.y + b.h + 4 - size));
  return { x, y, size };
}

export const BODY = (stage: number) => stage;
export const LIT = (stage: number) => 10 + stage;
export const FACE = (large: boolean, expr: number) => 100 + (large ? 16 : 0) + expr;

export function buildLayers(): LookLayers {
  const layers: LookLayers["layers"] = [];
  const add = (key: number, runs: number[]) => layers.push({ key, data: hex(runs), runs: runs.length / 4 });
  const egg = drawEgg("coral");
  add(BODY(0), runsOf((x, y) => egg.get(x, y)));
  const anchors: LookLayers["anchors"] = [];
  PET_STAGES.forEach((stage, i) => {
    const s = i + 1;
    const body = drawBody("gentle", stage, { lit: false });
    const lit = drawBody("gentle", stage, { lit: true });
    add(BODY(s), runsOf((x, y) => body.get(x, y)));
    add(LIT(s), runsOf((x, y) => (lit.get(x, y) !== body.get(x, y) ? lit.get(x, y) : null)));
    const a = faceAnchor("gentle", stage);
    const set = a.size === "L" ? FACES_L : FACES_S;
    // stampCentered's own placement, face by face
    const at = EXPRESSIONS.map((e): [number, number] => [Math.round(a.x - Math.max(...set[e].map((r) => r.length)) / 2), Math.round(a.y - set[e].length / 2)]);
    if (at.some(([x, y]) => x < 0 || y < 0 || x > 47 || y > 47)) throw new Error("face outside the canvas");
    anchors.push({ stage: s, large: a.size === "L", at });
  });
  for (const large of [false, true]) EXPRESSIONS.forEach((e, i) => add(FACE(large, i), stampRuns((large ? FACES_L : FACES_S)[e])));
  const frames = [drawEgg("coral"), ...PET_STAGES.map((st) => drawPet("gentle", st, { expression: "sparkly", lit: true }))].map((c, stage) => ({ stage, ...frameFor(c) }));
  return { layers, anchors, frames };
}

/* ── choosing the look from the saved state (mirrors PetLook.sol) ─────────── */

const bits = (w: bigint, at: number, n: number) => Number((w >> BigInt(at)) & ((1n << BigInt(n)) - 1n));

export interface Look {
  stage: number;
  expression: Expression;
  lit: boolean;
}

export function lookOf(state: bigint): Look {
  const stored = bits(state, 148, 3);
  const stage = stored >= 4 ? 4 : stored; // elders wear the adult picture for now
  const food = bits(state, 64, 10);
  const joy = bits(state, 74, 10);
  const energy = bits(state, 84, 10);
  if (bits(state, 151, 1)) return { stage, expression: "asleep", lit: false };
  if (bits(state, 219, 1)) return { stage, expression: "dizzy", lit: false };
  if (food < 200) return { stage, expression: "sad", lit: false };
  if (energy < 200) return { stage, expression: "sleepy", lit: false };
  if (joy >= 750) return { stage, expression: "sparkly", lit: true };
  if (joy >= 500) return { stage, expression: "happy", lit: false };
  if (joy < 200) return { stage, expression: "sulk", lit: false };
  return { stage, expression: "neutral", lit: false };
}

/** The picture PetLook draws for a look, as a pixel canvas (for checking the contract). */
export function composeLook(look: Look, built: LookLayers = buildLayers()): PixelCanvas {
  const c = new PixelCanvas(SIZE, SIZE);
  const paint = (key: number, dx = 0, dy = 0) => {
    const l = built.layers.find((x) => x.key === key)!;
    const b = l.data.slice(2).match(/../g)?.map((h) => parseInt(h, 16)) ?? [];
    for (let i = 0; i < b.length; i += 4) for (let k = 0; k < b[i + 2]!; k++) c.set(b[i]! + k + dx, b[i + 1]! + dy, ROLES[b[i + 3]!]!);
  };
  paint(BODY(look.stage));
  if (look.stage === 0) return c;
  if (look.lit) paint(LIT(look.stage));
  const a = built.anchors.find((x) => x.stage === look.stage)!;
  const e = EXPRESSIONS.indexOf(look.expression);
  paint(FACE(a.large, e), a.at[e]![0], a.at[e]![1]);
  return c;
}

/** The game's own sprite for a look, for comparison. */
export function gameSprite(look: Look): PixelCanvas {
  return look.stage === 0 ? drawEgg("coral") : drawPet("gentle", PET_STAGES[look.stage - 1]!, { expression: look.expression, lit: look.lit });
}

/* ── installing the art ───────────────────────────────────────────────────── */

/** A palette as PetLook stores it: 16 colours, role 1..16, 4 bytes RGBA each. */
export function paletteBytes(pal: Partial<Record<Role, string>>): `0x${string}` {
  const out: number[] = [];
  for (let r = 1; r <= 16; r++) {
    const c = pal[ROLES[r]!] ?? "#00000000";
    const h = c.replace("#", "");
    const full = h.length === 6 ? `${h}ff` : h;
    for (let k = 0; k < 4; k++) out.push(parseInt(full.slice(k * 2, k * 2 + 2), 16));
  }
  return hex(out);
}

/** The calls that install the art on a PetLook: layer batches, face positions, palettes. */
export function installCalls(built: LookLayers, petPalette: Partial<Record<Role, string>>, eggPalette: Partial<Record<Role, string>>) {
  const batches: Array<{ keys: bigint[]; data: `0x${string}`[] }> = [];
  let cur: { keys: bigint[]; data: `0x${string}`[] } = { keys: [], data: [] };
  let size = 0;
  for (const l of built.layers) {
    const n = (l.data.length - 2) / 2;
    if (size + n > 6000 && cur.keys.length) {
      batches.push(cur);
      cur = { keys: [], data: [] };
      size = 0;
    }
    cur.keys.push(BigInt(l.key));
    cur.data.push(l.data);
    size += n;
  }
  if (cur.keys.length) batches.push(cur);
  const faces = built.anchors.map((a) => ({ stage: BigInt(a.stage), large: a.large, at: hex(a.at.flat()) }));
  const frames = built.frames.map((f) => ({ stage: BigInt(f.stage), x: f.x, y: f.y, size: f.size }));
  return { batches, faces, frames, palettes: [paletteBytes(petPalette), paletteBytes(eggPalette)] as const };
}

/** Reads an SVG drawn by PetLook back into colour roles, for checking it against the game. */
export function canvasOfSvg(svg: string): PixelCanvas {
  const c = new PixelCanvas(SIZE, SIZE);
  for (const m of svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="1" class="c(\d+)"\/>/g)) {
    for (let k = 0; k < Number(m[3]); k++) c.set(Number(m[1]) + k, Number(m[2]), ROLES[Number(m[4])]!);
  }
  return c;
}

/* ── names (H2) ───────────────────────────────────────────────────────────── */

/** The same name rules PetLook enforces, so the app can explain a refusal before any transaction. */
export function nameProblem(name: string): "empty" | "long" | "space" | "chars" | null {
  const b = new TextEncoder().encode(name);
  if (b.length === 0) return "empty";
  if (b.length > 24) return "long";
  if (name.startsWith(" ") || name.endsWith(" ")) return "space";
  for (const ch of name) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 || cp === 0x7f || `"\\<>&`.includes(ch) || hiddenCodePoint(cp)) return "chars";
  }
  return null;
}

/** Invisible or direction-changing code points PetLook refuses in names. */
export function hiddenCodePoint(cp: number): boolean {
  return (
    (cp >= 0x80 && cp <= 0xa0) || cp === 0xad || cp === 0x34f || cp === 0x115f || cp === 0x1160 || cp === 0x180e || (cp >= 0x2000 && cp <= 0x206f) ||
    cp === 0x3000 || cp === 0x3164 || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0xfeff || cp === 0xffa0 || (cp >= 0xfff0 && cp <= 0xfffb) || (cp >= 0xe0000 && cp <= 0xe0fff)
  );
}
