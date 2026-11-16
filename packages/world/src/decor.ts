/**
 * Decorations for the pet's home (S5): small pixel pieces drawn for Lingxi, bought
 * with coins and placed anywhere in the home room. Each piece is owned once and
 * placed once; moving it means picking it up and putting it down again.
 */

import type { WorldState, WorldResult } from "./world";
import { bumpAll } from "./tally";

export interface Decor {
  id: string;
  name: { en: string; zh: string };
  price: number;
  /** pixel rows; each letter is a colour from `colors`, "." is clear */
  rows: readonly string[];
  colors: Record<string, string>;
  /** lies on the floor: always drawn beneath the pet */
  flat?: boolean;
  /** a keepsake from a story quest: never sold, only given (price is 0) */
  gift?: true;
}

const OUT = "#2B2140";

export const DECOR: readonly Decor[] = [
  {
    id: "fern",
    name: { en: "Potted fern", zh: "盆栽蕨" },
    price: 40,
    rows: ["..g.g.g..", ".gGgGgGg.", "gGg.g.gGg", ".g.gGg.g.", "..ggGgg..", "..ooooo..", ".otttttO.", ".otttttO.", "..ooooo.."],
    colors: { g: "#7FCB8E", G: "#4E9E6A", o: OUT, O: OUT, t: "#E07A4F" },
  },
  {
    id: "lantern",
    name: { en: "Paper lantern", zh: "纸灯笼" },
    price: 60,
    rows: ["...o...", "..ooo..", ".orrro.", "orryrro", "oryyyro", "orryrro", ".orrro.", "..ooo..", "...o..."],
    colors: { o: OUT, r: "#FF6B5A", y: "#FFD45E" },
  },
  {
    id: "mushroom",
    name: { en: "Mushroom lamp", zh: "蘑菇灯" },
    price: 70,
    rows: ["..oooooo..", ".orrwrrro.", "orwrrrwrro", "orrrrrrrro", ".oooooooo.", "...owwo...", "...owwo...", "..oooooo.."],
    colors: { o: OUT, r: "#E8604A", w: "#FFF7E8" },
  },
  {
    id: "flowers",
    name: { en: "Flower pot", zh: "花盆" },
    price: 35,
    rows: [".p...y.", "pPp.yYy", ".p.g.y.", "..ggg..", ".ooooo.", ".obbbo.", "..ooo.."],
    colors: { p: "#FF9DB6", P: "#FFE3EA", y: "#FFD45E", Y: "#FFF3C9", g: "#5FBF86", o: OUT, b: "#7FB7F0" },
  },
  {
    id: "star",
    name: { en: "Star sticker", zh: "星星贴纸" },
    price: 15,
    rows: ["....o....", "...oyo...", "oooyyyooo", "oyyyYyyyo", ".oyyyyyo.", "..oyyyo..", ".oyyoyyo.", ".oyo.oyo.", ".oo...oo."],
    colors: { o: OUT, y: "#FFC83D", Y: "#FFF1B0" },
  },
  {
    id: "heart",
    name: { en: "Heart sticker", zh: "爱心贴纸" },
    price: 15,
    rows: [".oo.oo.", "oppoppo", "oPppppo", "opppppo", ".opppo.", "..opo..", "...o..."],
    colors: { o: OUT, p: "#FF7A9A", P: "#FFD3DE" },
  },
  {
    id: "bunting",
    name: { en: "Bunting", zh: "彩旗" },
    price: 45,
    rows: ["oooooooooooooooo", ".rr..yy..bb..pp.", ".rr..yy..bb..pp.", "..r...y...b...p."],
    colors: { o: OUT, r: "#FF6B5A", y: "#FFC83D", b: "#7FB7F0", p: "#FF9DB6" },
  },
  {
    id: "rug",
    name: { en: "Round rug", zh: "圆地毯" },
    price: 80,
    rows: ["...pppppppp...", ".ppPPPPPPPPpp.", "ppPPwwwwwwPPpp", ".ppPPPPPPPPpp.", "...pppppppp..."],
    colors: { p: "#F2A0B4", P: "#FFD9E2", w: "#FFEAF0" },
    flat: true,
  },
  {
    id: "books",
    name: { en: "Book stack", zh: "一摞书" },
    price: 30,
    rows: [".oooooo.", ".obbbbo.", "oooooooo", "oyyyyyyo", ".oooooo.", ".orrrro.", "oooooooo"],
    colors: { o: OUT, b: "#7FB7F0", y: "#FFC83D", r: "#FF6B5A" },
  },
  {
    id: "crystal",
    name: { en: "Glow crystal", zh: "发光水晶" },
    price: 90,
    rows: ["...o...", "..oco..", ".ocCco.", ".occco.", "ocCcCco", ".occco.", "..ooo.."],
    colors: { o: OUT, c: "#B98BE0", C: "#EAD9FF" },
  },
  {
    id: "globe",
    name: { en: "Snow globe", zh: "雪花球" },
    price: 100,
    rows: ["..ooooo..", ".owbwbwo.", "obwgwbwbo", "obbgggbbo", ".obbbbbo.", "..ooooo..", ".ottttto.", ".ooooooo."],
    colors: { o: OUT, b: "#BFD9F5", w: "#FFFFFF", g: "#5FBF86", t: "#C98A5A" },
  },
  {
    id: "ball",
    name: { en: "Toy ball", zh: "玩具球" },
    price: 25,
    rows: [".ooooo.", "obbbbbo", "owwwwwo", "obbbbbo", "obbbbbo", ".ooooo."],
    colors: { o: OUT, b: "#2F7FD6", w: "#FFFFFF" },
  },
  // ── keepsakes from the story quests (plan 4.2): never sold, only given ──
  {
    id: "postcard",
    name: { en: "Seaside postcard", zh: "海边明信片" },
    price: 0,
    gift: true,
    rows: ["oooooooooo", "obbbbbbywo", "obbbbbbbwo", "owwwwwwwwo", "ottttttwwo", "ottgtttwwo", "oooooooooo"],
    colors: { o: OUT, b: "#7FB7F0", y: "#FFD45E", w: "#FFFFFF", t: "#F2CF73", g: "#5FBF86" },
  },
  {
    id: "starmap",
    name: { en: "Star map", zh: "星图" },
    price: 0,
    gift: true,
    rows: ["oooooooooo", "onnnnynnno", "onynnnnnno", "onnnwnnyno", "onnnnnnnno", "onynnnwnno", "oooooooooo"],
    colors: { o: OUT, n: "#2E3570", y: "#FFD45E", w: "#FFFFFF" },
  },
  {
    id: "photo",
    name: { en: "Friendship photo", zh: "友谊合照" },
    price: 0,
    gift: true,
    rows: ["ooooooooo", "owwwwwwwo", "owsswppwo", "owsswppwo", "owwwwwwwo", "owwwwwwwo", "ooooooooo"],
    colors: { o: OUT, w: "#FFF7E8", s: "#7FB7F0", p: "#FF9DB6" },
  },
  {
    id: "portrait",
    name: { en: "Family portrait", zh: "全家福" },
    price: 0,
    gift: true,
    rows: ["ooooooooooo", "oyyyyyyyyyo", "oyrrybbyggo", "oyrrybbyggo", "oyyyyyyyyyo", "ooooooooooo"],
    colors: { o: OUT, y: "#E0B45A", r: "#FF8A6B", b: "#FFD45E", g: "#7FB7F0" },
  },
  {
    id: "firstaid",
    name: { en: "First-aid kit", zh: "急救箱" },
    price: 0,
    gift: true,
    rows: ["...ooo...", "..o...o..", "ooooooooo", "owwwrwwwo", "owwrrrwwo", "owwwrwwwo", "ooooooooo"],
    colors: { o: OUT, w: "#FFFFFF", r: "#E5486C" },
    flat: true,
  },
  {
    id: "pillow",
    name: { en: "Soft pillow", zh: "软枕头" },
    price: 0,
    gift: true,
    rows: [".oooooooo.", "oppPppPppo", "oppppppppo", "oppPppPppo", ".oooooooo."],
    colors: { o: OUT, p: "#C9B6F2", P: "#EFE6FF" },
    flat: true,
  },
  {
    id: "cloud",
    name: { en: "Cloud pillow", zh: "云朵枕头" },
    price: 0,
    gift: true,
    rows: ["...oo.oo...", "..owwowwo..", ".owwwwwwwo.", "owwwwbwwwwo", ".ooooooooo."],
    colors: { o: OUT, w: "#FFFFFF", b: "#CFE8FF" },
    flat: true,
  },
  {
    id: "dreamjar",
    name: { en: "Dream jar", zh: "梦之瓶" },
    price: 0,
    gift: true,
    rows: ["..ooo..", ".ottto.", "ooooooo", "obbybbo", "obybbyo", "obbbybo", ".ooooo."],
    colors: { o: OUT, t: "#C98A5A", b: "#BFE6FF", y: "#FFD45E" },
  },
  {
    id: "eggshell",
    name: { en: "First eggshell", zh: "第一片蛋壳" },
    price: 0,
    gift: true,
    rows: [".o.o.o.", "ocococo", "occCcco", "occccco", ".occco.", "..ooo.."],
    colors: { o: OUT, c: "#FFF1D6", C: "#FFFFFF" },
    flat: true,
  },
  {
    id: "nameplate",
    name: { en: "Home name plate", zh: "家门牌" },
    price: 0,
    gift: true,
    rows: ["ooooooooooo", "ottttttttto", "otwtwtwtwto", "ottttttttto", "ooooooooooo", "....o.o...."],
    colors: { o: OUT, t: "#C98A5A", w: "#FFF1D6" },
  },
  {
    id: "sign",
    name: { en: "Little warning sign", zh: "小警示牌" },
    price: 0,
    gift: true,
    rows: [".....o.....", "....oyo....", "...oyoyo...", "...oyoyo...", "..oyyoyyo..", "..oyyyyyo..", ".oyyyoyyyo.", "ooooooooooo", ".....o.....", ".....o....."],
    colors: { o: OUT, y: "#FFD45E" },
  },
  {
    id: "mapframe",
    name: { en: "Framed map", zh: "装裱的地图" },
    price: 0,
    gift: true,
    rows: ["oooooooooo", "ogggbbgggo", "oggrbbgggo", "ogggbgggro", "oyggbbgggo", "oooooooooo"],
    colors: { o: OUT, g: "#9ED29B", b: "#7FB7F0", r: "#E5486C", y: "#FFD45E" },
  },
];

export const DECOR_BY_ID: Readonly<Record<string, Decor>> = Object.fromEntries(DECOR.map((d) => [d.id, d]));

/** At most this many pieces stand in the room at once. */
export const MAX_PLACED = 12;
/** The room is 128 pixels square; pieces stand on the lower part, never under the top bar. */
export const PLACE_AREA = { x0: 6, x1: 122, y0: 34, y1: 124 } as const;

export interface DecorState {
  owned: string[];
  placed: Array<{ id: string; x: number; y: number }>;
}

export const decorOf = (w: WorldState): DecorState => w.decor ?? { owned: [], placed: [] };

export function buyDecor(w: WorldState, id: string): WorldResult {
  const d = DECOR_BY_ID[id];
  if (!d || d.gift) return { ok: false, reason: "notSold" };
  const s = decorOf(w);
  if (s.owned.includes(id)) return { ok: false, reason: "owned" };
  if (w.coins < d.price) return { ok: false, reason: "coins" };
  return { ok: true, world: bumpAll({ ...w, coins: w.coins - d.price, decor: { ...s, owned: [...s.owned, id] } }, [["BUY", 0, 1], ["COINS_SPENT", 0, d.price]]) };
}

export function placeDecor(w: WorldState, id: string, x: number, y: number): WorldResult {
  const s = decorOf(w);
  if (!s.owned.includes(id)) return { ok: false, reason: "notOwned" };
  if (s.placed.length >= MAX_PLACED && !s.placed.some((p) => p.id === id)) return { ok: false, reason: "full" };
  const cx = Math.round(Math.max(PLACE_AREA.x0, Math.min(PLACE_AREA.x1, x)));
  const cy = Math.round(Math.max(PLACE_AREA.y0, Math.min(PLACE_AREA.y1, y)));
  // placing a piece that is already out moves it
  const placed = [...s.placed.filter((p) => p.id !== id), { id, x: cx, y: cy }];
  return { ok: true, world: { ...w, decor: { ...s, placed } } };
}

export function removeDecor(w: WorldState, id: string): WorldResult {
  const s = decorOf(w);
  if (!s.placed.some((p) => p.id === id)) return { ok: false, reason: "notPlaced" };
  return { ok: true, world: { ...w, decor: { ...s, placed: s.placed.filter((p) => p.id !== id) } } };
}
