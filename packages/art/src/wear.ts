/**
 * Wearables (PRD S4): cosmetic only, never stats. Three slots after Uni and
 * Aavegotchi: head, face and a held item. Each piece is drawn in its own
 * colours and placed from the drawn body itself (the top of the head, the eye
 * line, the right side), so it sits right on every egg line, stage and adult
 * form without hand-placed anchors.
 */

import { FACES_L, FACES_S } from "./faces";
import { ANCHORS, type Form, type Line, type Stage, faceAnchor } from "./pets";
import type { PixelCanvas } from "./pixel";

export const SLOTS = ["head", "face", "held"] as const;
export type Slot = (typeof SLOTS)[number];

export interface Wearable {
  id: string;
  slot: Slot;
  name: { en: string; zh: string };
  /** a face piece has one drawing for each face size */
  rows: readonly string[];
  rowsSmall?: readonly string[];
  colors: Record<string, string>;
  /** pieces that belong to one set (see sets) */
  set?: string;
}

const O = "#2B2140";

export const WEARABLES: readonly Wearable[] = [
  {
    id: "sunhat",
    slot: "head",
    set: "picnic",
    name: { en: "Straw sunhat", zh: "草编遮阳帽" },
    rows: ["....OOOOO....", "...OyyyyyO...", "...OyyyyyO...", "..OrrrrrrrO..", "OOyyyyyyyyyOO", "OyyyyyyyyyyyO", ".OOOOOOOOOOO."],
    colors: { O, y: "#F2CF73", r: "#E8604A" },
  },
  {
    id: "beanie",
    slot: "head",
    set: "winter",
    name: { en: "Knit beanie", zh: "毛线帽" },
    rows: ["....OwO....", "...OwwwO...", "..OOOOOOO..", ".OsbsbsbsO.", "OsbsbsbsbsO", "OSSSSSSSSSO", ".OOOOOOOOO."],
    colors: { O, w: "#FFFFFF", s: "#7FB7F0", b: "#5B8FD6", S: "#3F6FB8" },
  },
  {
    id: "crown",
    slot: "head",
    set: "royal",
    name: { en: "Little crown", zh: "小皇冠" },
    rows: ["O...O...O", "OgO.OgO.OgO".slice(0, 9), "OgggggggO", "OgrgggrgO", "OgggggggO", ".OOOOOOO."],
    colors: { O, g: "#FFC83D", r: "#E5486C" },
  },
  {
    id: "bow",
    slot: "head",
    set: "picnic",
    name: { en: "Big ribbon bow", zh: "大蝴蝶结" },
    rows: [".OO.....OO.", "OppO...OppO", "OpppOOOpppO", "OpppPkPpppO", "OppO.O.OppO", ".OO.....OO."],
    colors: { O, p: "#FF8FAE", P: "#E5486C", k: "#FFFFFF" },
  },
  {
    id: "glasses",
    slot: "face",
    set: "scholar",
    name: { en: "Round glasses", zh: "圆框眼镜" },
    rows: [".OOOO..OOOO.", "OggggOOggggO", ".OOOO..OOOO."],
    rowsSmall: [".OOO..OOO.", "OgggOOgggO", ".OOO..OOO."],
    colors: { O, g: "#CFE8FF80" },
  },
  {
    id: "shades",
    slot: "face",
    set: "royal",
    name: { en: "Sunglasses", zh: "墨镜" },
    rows: ["OOOOOOOOOOOO", "OkkkkOOkkkkO", ".OkkO..OkkO."],
    rowsSmall: ["OOOOOOOOOO", "OkkkOOkkkO", ".OkO..OkO."],
    colors: { O, k: "#3A3352" },
  },
  {
    id: "hearts",
    slot: "face",
    set: "picnic",
    name: { en: "Heart cheek stickers", zh: "爱心脸贴" },
    rows: ["............", "............", "pp........pp", ".p........p."],
    rowsSmall: ["..........", "..........", "pp......pp", ".p......p."],
    colors: { p: "#FF5C86" },
  },
  {
    id: "balloon",
    slot: "held",
    set: "picnic",
    name: { en: "Party balloon", zh: "派对气球" },
    rows: [".OOO.", "OrrhO", "OrrrO", "OrrrO", ".OrO.", "..O..", "..s..", "...s.", "..s..", "..s.."],
    colors: { O, r: "#B07FE0", h: "#EBDDFB", s: "#5B4E73" },
  },
  {
    id: "flag",
    slot: "held",
    set: "winter",
    name: { en: "Little pennant", zh: "小三角旗" },
    rows: ["Obbb.", "Obwbb", "Obbb.", "Ob...", "O....", "O....", "O....", "O...."],
    colors: { O, b: "#2F7FD6", w: "#FFC83D" },
  },
  {
    id: "lantern",
    slot: "held",
    set: "royal",
    name: { en: "Red lantern", zh: "红灯笼" },
    rows: ["..O..", ".OgO.", "OrrrO", "OrgrO", "OrrrO", ".OgO.", "..y..", "..y.."],
    colors: { O, r: "#E5486C", g: "#FFC83D", y: "#FFC83D" },
  },
  {
    id: "sunflower",
    slot: "held",
    set: "scholar",
    name: { en: "Sunflower", zh: "向日葵" },
    rows: [".y.y.", "yybyy", ".ybby".slice(0, 5), "yybyy", ".y.y.", "..G..", ".GG..", "..G..", "..G.."],
    colors: { y: "#FFC83D", b: "#7A5236", G: "#4E9E6A" },
  },
  // ── keepsakes from the story quests (plan 4.2): never sold or sewn, only given ──
  {
    id: "charm",
    slot: "head",
    set: "story",
    name: { en: "Lantern charms", zh: "灯笼发饰" },
    rows: ["..O.....O..", ".OgO...OgO.", "OrrrO.OrrrO", "OrgrO.OrgrO", "OrrrO.OrrrO", ".OgO...OgO."],
    colors: { O, r: "#E5486C", g: "#FFC83D" },
  },
  {
    id: "ribbon",
    slot: "head",
    set: "story",
    name: { en: "Memorial ribbon", zh: "纪念丝带" },
    rows: [".OO.....OO.", "OwwO...OwwO", "OwwwOOOwwwO", "OwwwOyOwwwO", "OwwO.O.OwwO", ".OO.....OO."],
    colors: { O, w: "#FFFFFF", y: "#FFD45E" },
  },
  {
    id: "ranger",
    slot: "head",
    set: "story",
    name: { en: "Wayfinder's hat", zh: "引路人帽" },
    rows: [".......ff....", "....OOOfOO...", "...OgggggggO.", "..OgggGGGgggO", "OOOOOOOOOOOOO", "OGGGGGGGGGGGO", ".OOOOOOOOOOO."],
    colors: { O, g: "#6FA86A", G: "#4E7E4A", f: "#E8604A" },
  },
  {
    id: "nurse",
    slot: "head",
    set: "story",
    name: { en: "Nurse's cap", zh: "护士帽" },
    rows: ["..OOOOOOO..", ".OwwwrwwwO.", ".OwwrrrwwO.", ".OwwwrwwwO.", "OOOOOOOOOOO", "OwwwwwwwwwO", ".OOOOOOOOO."],
    colors: { O, w: "#FFFFFF", r: "#E5486C" },
  },
  {
    id: "headband",
    slot: "head",
    set: "story",
    name: { en: "Sweatband", zh: "运动发带" },
    rows: ["OOOOOOOOOOOOO", "OrrrrwwwrrrrO", "OOOOOOOOOOOOO"],
    colors: { O, r: "#E8604A", w: "#FFFFFF" },
  },
  {
    id: "dream",
    slot: "head",
    set: "story",
    name: { en: "Star hairpin", zh: "星星发卡" },
    rows: ["....O....", "...OyO...", "OOOyyyOOO", "OyyyYyyyO", ".OyyyyyO.", "..OyOyO..", "..OO.OO.."],
    colors: { O, y: "#FFC83D", Y: "#FFF1B0" },
  },
  {
    id: "goggles",
    slot: "face",
    set: "story",
    name: { en: "Tinker's goggles", zh: "修补匠护目镜" },
    rows: [".OOOO..OOOO.", "OgwwgOOgwwgO", ".OOOO..OOOO."],
    rowsSmall: [".OOO..OOO.", "OgwgOOgwgO", ".OOO..OOO."],
    colors: { O, g: "#B88A34", w: "#BFE6FF" },
  },
  {
    id: "net",
    slot: "held",
    set: "story",
    name: { en: "Butterfly net", zh: "捕蝶网" },
    rows: [".OOO.", "OwwwO", "OwwwO", "OwwwO", ".OOO.", "..b..", "..b..", "..b..", "..b.."],
    colors: { O, w: "#FFFFFFB0", b: "#7A5236" },
  },
  {
    id: "whistle",
    slot: "held",
    set: "story",
    name: { en: "Coach's whistle", zh: "教练哨子" },
    rows: ["s...s", ".s.s.", "..s..", "OOOO.", "OyyyO", "OyyOO", ".OO.."],
    colors: { O, y: "#FFC83D", s: "#5B4E73" },
  },
  {
    id: "seal",
    slot: "held",
    set: "story",
    name: { en: "Keeper's seal", zh: "守护者印章" },
    rows: [".OOO.", "OrrrO", "OrwrO", "OrrrO", ".OOO.", "..b..", "..b..", "..b.."],
    colors: { O, r: "#B03A48", w: "#FFC83D", b: "#7A5236" },
  },
  {
    id: "laurel",
    slot: "head",
    set: "champion",
    name: { en: "Champion's laurel", zh: "冠军桂冠" },
    rows: ["GG.......GG", "GgG.....GgG", ".GgGGGGGgG.", "..GgGyGgG..", "....OOO...."],
    colors: { O, G: "#4E9E6A", g: "#7FCB8E", y: "#FFC83D" },
  },
];

export const WEARABLE: Readonly<Record<string, Wearable>> = Object.fromEntries(WEARABLES.map((w) => [w.id, w]));

/** Player-made pieces (designs.ts), registered at run time beside Lingxi's own. */
const custom = new Map<string, Wearable>();
export function registerWearables(list: readonly Wearable[]): void {
  for (const w of list) custom.set(w.id, w);
}
/** Any wearable by id: Lingxi's own, or a registered player design. */
export const wearableOf = (id: string): Wearable | undefined => WEARABLE[id] ?? custom.get(id);

export type Outfit = Partial<Record<Slot, string>>;

/** Sets: wearing every piece of one gives a title and a little sparkle (cosmetic, PRD M3). */
export const SETS: Readonly<Record<string, { name: { en: string; zh: string }; title: { en: string; zh: string } }>> = {
  picnic: { name: { en: "Picnic", zh: "野餐" }, title: { en: "Picnic star", zh: "野餐之星" } },
  winter: { name: { en: "Winter walk", zh: "冬日散步" }, title: { en: "Snow strider", zh: "踏雪者" } },
  royal: { name: { en: "Royal", zh: "皇家" }, title: { en: "Little monarch", zh: "小小君主" } },
  scholar: { name: { en: "Scholar", zh: "学者" }, title: { en: "Bookish", zh: "书卷气" } },
  story: { name: { en: "Keepsakes", zh: "纪念品" }, title: { en: "Storyteller", zh: "讲故事的人" } },
};

/** The set a full outfit completes, if any: one piece in each slot, all from the same set. */
export function completeSet(outfit: Outfit): string | null {
  const sets = SLOTS.map((s) => (outfit[s] ? wearableOf(outfit[s]!)?.set : undefined));
  if (sets.some((x) => !x)) return null;
  return sets.every((x) => x === sets[0]) && SETS[sets[0]!] ? sets[0]! : null;
}

/** Pieces in a set, by slot. */
export const setPieces = (set: string): Wearable[] => WEARABLES.filter((w) => w.set === set);

/** One overlay pixel: position and colour (#rrggbb or #rrggbbaa; "erase" clears the pet's pixel). */
export type OverlayPixel = [number, number, string];

/** body roles only: no leaf or horn accents, traces, moon, eyes, blush or shadow */
const BODY = new Set(["O", "o", "D", "d", "m", "l", "h"]);

/** The crown of the head: the first row with a solid run of body across the middle (ears and sprouts are too thin). */
function topOfHead(c: PixelCanvas): { x: number; y: number } {
  for (let y = 0; y < c.h; y++) {
    let best: [number, number] | null = null;
    let start = -1;
    for (let x = 12; x <= 36; x++) {
      const inBody = BODY.has(c.get(x, y));
      if (inBody && start < 0) start = x;
      if ((!inBody || x === 36) && start >= 0) {
        const end = inBody ? x : x - 1;
        if (!best || end - start > best[1] - best[0]) best = [start, end];
        start = -1;
      }
    }
    if (best && best[1] - best[0] >= 7) return { x: Math.round((best[0] + best[1]) / 2), y };
  }
  return { x: 24, y: 10 };
}

function rightEdge(c: PixelCanvas, y: number): number {
  for (let x = c.w - 1; x >= 0; x--) {
    const r = c.get(x, y);
    if (r !== "." && r !== "s") return x;
  }
  return 30;
}

/**
 * Where the outfit's pixels go on a drawn pet. `canvas` is the pet as drawn
 * (body and face), so the pieces follow its pose: breathing, squash and form.
 */
export function wearOverlay(canvas: PixelCanvas, line: Line, stage: Exclude<Stage, "egg">, outfit: Outfit, squash = 0, form?: Form): OverlayPixel[] {
  const out: OverlayPixel[] = [];
  // a hat replaces the scholar form's own cap: clear the cap's ink and tassel where it is drawn
  if (outfit.head && stage === "adult" && form === "scholar") {
    const [hx, hy] = ANCHORS[line].hat;
    for (let y = hy - 1; y < hy + 6; y++) for (let x = hx; x < hx + 9; x++) {
      const r = x >= 0 && y >= 0 && x < canvas.w && y < canvas.h ? canvas.get(x, y) : ".";
      if (r === "e" || r === "t") out.push([x, y, "erase"]);
    }
  }
  const put = (rows: readonly string[], colors: Record<string, string>, ox: number, oy: number) => {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i]!;
        if (ch === "." || !colors[ch]) continue;
        const x = ox + i;
        const y = oy + j;
        if (x >= 0 && y >= 0 && x < canvas.w && y < canvas.h) out.push([x, y, colors[ch]!]);
      }
    });
  };
  const face = faceAnchor(line, stage, squash);
  const faceRows = (face.size === "L" ? FACES_L : FACES_S).neutral.length;
  const eyeTop = face.y - Math.floor(faceRows / 2);
  const held = outfit.held ? wearableOf(outfit.held) : undefined;
  if (held) {
    const y = Math.min(canvas.h - 3, eyeTop + faceRows + 2);
    // held beside the body, never over it
    const w = Math.max(...held.rows.map((r) => r.length));
    const right = Math.min(canvas.w - w, rightEdge(canvas, y) + 1);
    put(held.rows, held.colors, right, y - held.rows.length + 2);
  }
  const head = outfit.head ? wearableOf(outfit.head) : undefined;
  if (head) {
    const t = topOfHead(canvas);
    const w = Math.max(...head.rows.map((r) => r.length));
    put(head.rows, head.colors, Math.round(t.x - w / 2), t.y + 2 - head.rows.length);
  }
  const fw = outfit.face ? wearableOf(outfit.face) : undefined;
  if (fw) {
    const rows = face.size === "S" && fw.rowsSmall ? fw.rowsSmall : fw.rows;
    const w = Math.max(...rows.map((r) => r.length));
    put(rows, fw.colors, Math.round(face.x - w / 2), eyeTop - 1);
  }
  return out;
}

/** Paints an overlay onto RGBA pixel data (as made by toRgba), blending translucent colours. */
export function paintOverlay(rgba: Uint8ClampedArray | Uint8Array, width: number, overlay: readonly OverlayPixel[]): void {
  for (const [x, y, hex] of overlay) {
    const i0 = (y * width + x) * 4;
    if (hex === "erase") {
      rgba[i0 + 3] = 0;
      continue;
    }
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    const i = (y * width + x) * 4;
    rgba[i] = Math.round(r * a + rgba[i]! * (1 - a));
    rgba[i + 1] = Math.round(g * a + rgba[i + 1]! * (1 - a));
    rgba[i + 2] = Math.round(b * a + rgba[i + 2]! * (1 - a));
    rgba[i + 3] = Math.max(rgba[i + 3]!, Math.round(255 * a));
  }
}
