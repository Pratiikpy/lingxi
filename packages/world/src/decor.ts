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
  /**
   * an on-chain piece (plan 4.6): an item on X Layer, held in a wallet and tradable, never bought with coins.
   * "shop" pieces are sold for BEM (the price is burned); "keepsake" pieces are claimed by helping finish a
   * community goal (the goal named here).
   */
  chain?: { kind: "shop"; supply: number } | { kind: "keepsake"; goal: string };
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

/** The on-chain pieces (plan 4.6), drawn for Lingxi: four in the BEM shop, four keepsakes of the community goals. */
export const CHAIN_DECOR: readonly Decor[] = [
  {
    id: "star-lamp",
    name: { en: "Star lamp", zh: "星星灯" },
    price: 0,
    chain: { kind: "shop", supply: 500 },
    rows: ["....y....", "...yYy...", "yyyYwYyyy", ".yYwwwYy.", "..yYwYy..", ".yYy.yYy.", ".yy...yy.", "....o....", "...ooo...", "..ooooo.."],
    colors: { y: "#FFD45E", Y: "#F2A93B", w: "#FFF6C8", o: OUT },
  },
  {
    id: "circuit-rug",
    name: { en: "Circuit rug", zh: "电路地毯" },
    price: 0,
    flat: true,
    chain: { kind: "shop", supply: 500 },
    rows: ["oooooooooooooo", "onnnnnnnnnnnno", "onggggnnggggno", "ongnngnngnngno", "ongnnggggnngno", "ongnnnnnnnngno", "onggggnnggggno", "onnnnnnnnnnnno", "oooooooooooooo"],
    colors: { o: OUT, n: "#2E3570", g: "#7FE0C2" },
  },
  {
    id: "tape-shelf",
    name: { en: "Tape reel shelf", zh: "磁带架" },
    price: 0,
    chain: { kind: "shop", supply: 500 },
    rows: ["oooooooooooo", "owwwwwwwwwwo", "owkkowkkowko", "owkrowkbowko", "owkkowkkowko", "oooooooooooo", "owwwwwwwwwwo", "owkkowkkowko", "owkyowkgowko", "owkkowkkowko", "oooooooooooo"],
    colors: { o: OUT, w: "#C98B5A", k: "#3A3048", r: "#FF6B5A", b: "#7FB7F0", y: "#FFD45E", g: "#7FCB8E" },
  },
  {
    id: "moon-window",
    name: { en: "Moon window", zh: "月窗" },
    price: 0,
    chain: { kind: "shop", supply: 500 },
    rows: ["...oooooo...", "..onnnnnno..", ".onnnnnwwno.", "onnnnnwwwwno", "onnnnnnwwwno", "onnynnnnwwno", "onnnnnnnnnno", ".onnnnynnno.", "..onnnnnno..", "...oooooo..."],
    colors: { o: OUT, n: "#2E3570", w: "#FFF6C8", y: "#FFD45E" },
  },
  {
    id: "goal-saves",
    name: { en: "Keeper's banner", zh: "守护者之旗" },
    price: 0,
    chain: { kind: "keepsake", goal: "g1" },
    rows: ["o.......", "orrrrrr.", "orrwwrr.", "orwwwwr.", "orrwwrr.", "orrrrrr.", "o.......", "o.......", "o.......", "oo......"],
    colors: { o: OUT, r: "#FF6B5A", w: "#FFF6C8" },
  },
  {
    id: "goal-hatch",
    name: { en: "Hatchling's nest", zh: "雏鸟巢" },
    price: 0,
    chain: { kind: "keepsake", goal: "g2" },
    rows: ["...ww...", "..wpww..", "..wwww..", "ottttttO", "otbtbttO", ".otttto.", "..oooo.."],
    colors: { o: OUT, O: OUT, w: "#FFF7E8", p: "#FF9DB6", t: "#C98B5A", b: "#8C5A3A" },
  },
  {
    id: "goal-family",
    name: { en: "Family tree sapling", zh: "家族小树苗" },
    price: 0,
    chain: { kind: "keepsake", goal: "g3" },
    rows: ["..gGg..", ".gGgGg.", "gGgpgGg", ".gGgGg.", "..gGg..", "...t...", "...t...", ".ooooo.", ".otttO.", "..ooo.."],
    colors: { g: "#7FCB8E", G: "#4E9E6A", p: "#FF9DB6", t: "#8C5A3A", o: OUT, O: OUT },
  },
  {
    id: "goal-ember",
    name: { en: "Ember brazier", zh: "余烬火盆" },
    price: 0,
    chain: { kind: "keepsake", goal: "g4" },
    rows: ["...r.y..", "..ryry..", ".ryyyyr.", "..ryyr..", "oooooooo", ".okkkko.", "..okko..", "..oooo.."],
    colors: { r: "#FF6B5A", y: "#FFD45E", o: OUT, k: "#3A3048" },
  },
];

export const DECOR_BY_ID: Readonly<Record<string, Decor>> = Object.fromEntries([...DECOR, ...CHAIN_DECOR].map((d) => [d.id, d]));

/** Pieces a home holds free. Room packs bought on X Layer (plan 4.9) add more; see `roomCapacity`. */
export const MAX_PLACED = 12;
/** Room space and saved looks can each be bought this many times per wallet (the Extras contract's `MAX_PACKS`). */
export const MAX_PACKS = 3;
/** How many more pieces each room pack adds, and the most a home can ever hold. */
export const ROOM_PER_PACK = 4;
export const ROOM_MAX = MAX_PLACED + ROOM_PER_PACK * MAX_PACKS;

/** How many pieces this home holds: 12, plus 4 for each room pack last read from X Layer (clamped to the contract's limit). */
export function roomCapacity(w: WorldState): number {
  const n = w.extras?.room;
  const packs = typeof n === "number" && Number.isInteger(n) && n > 0 ? Math.min(MAX_PACKS, n) : 0;
  return MAX_PLACED + ROOM_PER_PACK * packs;
}
/** The room is 128 pixels square; pieces stand on the lower part, never under the top bar. */
export const PLACE_AREA = { x0: 6, x1: 122, y0: 34, y1: 124 } as const;

export interface DecorState {
  owned: string[];
  placed: Array<{ id: string; x: number; y: number }>;
  /** on-chain pieces the player's wallets hold, as last read from X Layer (plan 4.6) */
  chainHeld?: string[];
}

/** Can this piece be placed: bought or given in the game, or held on chain now. */
export const hasDecor = (s: DecorState, id: string): boolean => s.owned.includes(id) || (s.chainHeld ?? []).includes(id);

/**
 * What the wallets hold on chain, read again: pieces sold or sent away leave the home, new ones can be placed.
 * Only on-chain pieces are taken from this list; game pieces stay as they are.
 */
export function syncChainDecor(w: WorldState, held: readonly string[]): WorldState {
  const s = decorOf(w);
  const chainHeld = [...new Set(held.filter((id) => DECOR_BY_ID[id]?.chain))].sort();
  const placed = s.placed.filter((p) => !DECOR_BY_ID[p.id]?.chain || chainHeld.includes(p.id));
  const same = JSON.stringify(s.chainHeld ?? []) === JSON.stringify(chainHeld) && placed.length === s.placed.length;
  return same ? w : { ...w, decor: { ...s, chainHeld, placed } };
}

export const decorOf = (w: WorldState): DecorState => w.decor ?? { owned: [], placed: [] };

export function buyDecor(w: WorldState, id: string): WorldResult {
  const d = DECOR_BY_ID[id];
  // keepsakes are given, on-chain pieces are bought for BEM on chain: neither for coins
  if (!d || d.gift || d.chain) return { ok: false, reason: "notSold" };
  const s = decorOf(w);
  if (s.owned.includes(id)) return { ok: false, reason: "owned" };
  if (w.coins < d.price) return { ok: false, reason: "coins" };
  return { ok: true, world: bumpAll({ ...w, coins: w.coins - d.price, decor: { ...s, owned: [...s.owned, id] } }, [["BUY", 0, 1], ["COINS_SPENT", 0, d.price]]) };
}

export function placeDecor(w: WorldState, id: string, x: number, y: number): WorldResult {
  const s = decorOf(w);
  if (!hasDecor(s, id)) return { ok: false, reason: "notOwned" };
  if (s.placed.length >= roomCapacity(w) && !s.placed.some((p) => p.id === id)) return { ok: false, reason: "full" };
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
