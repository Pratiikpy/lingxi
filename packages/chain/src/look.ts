/**
 * The pet's on-chain picture (PetLook): the game's own pixel art cut into layers
 * small enough to store on X Layer, and the rules for putting them together.
 *
 * Layers (each a list of horizontal runs: x, y, length, colour role; 4 bytes per run).
 * Each egg line (0 gentle, 1 bold, 2 curious) has its own bodies; a slot is
 * 10 * (line + 1) + stage for stages 1..4 and 0 for the egg, which all lines share:
 *   0            the egg
 *   100 + slot   the body without a face (trace unlit)
 *   200 + slot   the pixels that change when the circuit trace lights up
 *   1000..1031   16 small faces then 16 large faces, shared by every line
 * Face positions, face size and the frame are kept per slot; palettes 0..2 colour
 * the pets by line and 3..5 the eggs.
 *
 * `lookOf` chooses the stage, face and trace from the saved 256-bit state, exactly
 * as PetLook.sol does; `composeLook` builds the same picture in TypeScript so a test
 * can compare the contract's drawing with the game's sprite pixel by pixel.
 */

import { CORAL, EXPRESSIONS, FACES_L, FACES_S, ROLES, SHELL, SKY, SUNNY, PixelCanvas, boundingBox, drawBody, drawEgg, drawPet, faceAnchor, type Expression, type Role } from "@lingxi/art";

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

export const LOOK_LINES = ["gentle", "bold", "curious"] as const;
export type LookLine = (typeof LOOK_LINES)[number];

export interface LookLayers {
  /** key → bytes; keys as PetLook stores them */
  layers: Array<{ key: number; data: `0x${string}`; runs: number }>;
  /** per slot: which face set, and each face's top-left (faces differ in size) */
  anchors: Array<{ slot: number; large: boolean; at: Array<[number, number]> }>;
  /** per slot (0 = the egg): the square of the canvas the picture shows */
  frames: Array<{ slot: number; x: number; y: number; size: number }>;
}

/** A square around the sprite, a little roomier than the pet, ground near the bottom; growth still shows. */
export function frameFor(c: PixelCanvas): { x: number; y: number; size: number } {
  const b = boundingBox(c);
  const size = Math.min(40, Math.max(28, Math.ceil((Math.max(b.w, b.h) + 12) / 2) * 2));
  const x = Math.min(48 - size, Math.max(0, Math.round(b.x + b.w / 2 - size / 2)));
  const y = Math.min(48 - size, Math.max(0, b.y + b.h + 4 - size));
  return { x, y, size };
}

export const SLOT = (line: number, stage: number) => (stage === 0 ? 0 : 10 * (line + 1) + stage);
export const BODY = (line: number, stage: number) => (stage === 0 ? 0 : 100 + SLOT(line, stage));
export const LIT = (line: number, stage: number) => 200 + SLOT(line, stage);
export const FACE = (large: boolean, expr: number) => 1000 + (large ? 16 : 0) + expr;

export function buildLayers(): LookLayers {
  const layers: LookLayers["layers"] = [];
  const add = (key: number, runs: number[]) => {
    if (runs.length) layers.push({ key, data: hex(runs), runs: runs.length / 4 });
  };
  const egg = drawEgg("coral");
  add(BODY(0, 0), runsOf((x, y) => egg.get(x, y)));
  const anchors: LookLayers["anchors"] = [];
  const frames: LookLayers["frames"] = [{ slot: 0, ...frameFor(egg) }];
  LOOK_LINES.forEach((line, l) => {
    PET_STAGES.forEach((stage, i) => {
      const s = i + 1;
      const body = drawBody(line, stage, { lit: false });
      const lit = drawBody(line, stage, { lit: true });
      add(BODY(l, s), runsOf((x, y) => body.get(x, y)));
      add(LIT(l, s), runsOf((x, y) => (lit.get(x, y) !== body.get(x, y) ? lit.get(x, y) : null)));
      const a = faceAnchor(line, stage);
      const set = a.size === "L" ? FACES_L : FACES_S;
      // stampCentered's own placement, face by face
      const at = EXPRESSIONS.map((e): [number, number] => [Math.round(a.x - Math.max(...set[e].map((r) => r.length)) / 2), Math.round(a.y - set[e].length / 2)]);
      if (at.some(([x, y]) => x < 0 || y < 0 || x > 47 || y > 47)) throw new Error("face outside the canvas");
      anchors.push({ slot: SLOT(l, s), large: a.size === "L", at });
      frames.push({ slot: SLOT(l, s), ...frameFor(drawPet(line, stage, { expression: "sparkly", lit: true })) });
    });
  });
  for (const large of [false, true]) EXPRESSIONS.forEach((e, i) => add(FACE(large, i), stampRuns((large ? FACES_L : FACES_S)[e])));
  return { layers, anchors, frames };
}

/* ── choosing the look from the saved state (mirrors PetLook.sol) ─────────── */

const bits = (w: bigint, at: number, n: number) => Number((w >> BigInt(at)) & ((1n << BigInt(n)) - 1n));

export interface Look {
  line: number;
  stage: number;
  expression: Expression;
  lit: boolean;
}

export function lookOf(state: bigint): Look {
  const storedLine = bits(state, 152, 2);
  const line = storedLine > 2 ? 0 : storedLine;
  const stored = bits(state, 148, 3);
  const stage = stored >= 4 ? 4 : stored; // elders wear the adult picture for now
  const food = bits(state, 64, 10);
  const joy = bits(state, 74, 10);
  const energy = bits(state, 84, 10);
  const look = (expression: Expression, lit = false): Look => ({ line, stage, expression, lit });
  if (bits(state, 151, 1)) return look("asleep");
  if (bits(state, 219, 1)) return look("dizzy");
  if (food < 200) return look("sad");
  if (energy < 200) return look("sleepy");
  if (joy >= 750) return look("sparkly", true);
  if (joy >= 500) return look("happy");
  if (joy < 200) return look("sulk");
  return look("neutral");
}

/** The picture PetLook draws for a look, as a pixel canvas (for checking the contract). */
export function composeLook(look: Look, built: LookLayers = buildLayers()): PixelCanvas {
  const c = new PixelCanvas(SIZE, SIZE);
  const paint = (key: number, dx = 0, dy = 0) => {
    const l = built.layers.find((x) => x.key === key);
    if (!l) return;
    const b = l.data.slice(2).match(/../g)?.map((h) => parseInt(h, 16)) ?? [];
    for (let i = 0; i < b.length; i += 4) for (let k = 0; k < b[i + 2]!; k++) c.set(b[i]! + k + dx, b[i + 1]! + dy, ROLES[b[i + 3]!]!);
  };
  paint(BODY(look.line, look.stage));
  if (look.stage === 0) return c;
  if (look.lit) paint(LIT(look.line, look.stage));
  const a = built.anchors.find((x) => x.slot === SLOT(look.line, look.stage))!;
  const e = EXPRESSIONS.indexOf(look.expression);
  paint(FACE(a.large, e), a.at[e]![0], a.at[e]![1]);
  return c;
}

/** The game's own sprite for a look, for comparison. */
export function gameSprite(look: Look): PixelCanvas {
  return look.stage === 0 ? drawEgg("coral") : drawPet(LOOK_LINES[look.line]!, PET_STAGES[look.stage - 1]!, { expression: look.expression, lit: look.lit });
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
/** The game's palettes in PetLook's order: pets by line, then eggs by line (shell with the line's spots). */
export function lookPalettes() {
  const pets = [CORAL, SUNNY, SKY];
  return { pets, eggs: pets.map((p) => ({ ...SHELL, x: p.m, X: p.d })) };
}

/** The calls that install the art: layer batches, face positions, frames, and six palettes (pets by line, then eggs by line). */
export function installCalls(built: LookLayers, petPalettes: ReadonlyArray<Partial<Record<Role, string>>>, eggPalettes: ReadonlyArray<Partial<Record<Role, string>>>) {
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
  const faces = built.anchors.map((a) => ({ slot: BigInt(a.slot), large: a.large, at: hex(a.at.flat()) }));
  const frames = built.frames.map((f) => ({ slot: BigInt(f.slot), x: f.x, y: f.y, size: f.size }));
  return { batches, faces, frames, palettes: [...petPalettes, ...eggPalettes].map(paletteBytes) };
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
