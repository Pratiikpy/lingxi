/**
 * The visitor album (PRD M9, after Neko Atsume): while you are away, the friends
 * who wander by (U4's "friend" surprises) are travelling pets from other
 * villages, each with a name. Some are common, a few are rare. Who came on a
 * beat is fixed by the pet and the beat, like every away surprise, so an
 * absence always brings the same visitors on any device. The album keeps who
 * has been, how often, and when first.
 */

import { awayEvent } from "./away";
import { EVENT } from "./sim";

export interface Visitor {
  id: string;
  name: { en: string; zh: string };
  note: { en: string; zh: string };
  rarity: "common" | "uncommon" | "rare";
  /** how it is drawn: an egg line's body in a palette, with an outfit */
  look: { line: "gentle" | "bold" | "curious"; stage: "baby" | "child" | "teen" | "adult"; palette: "mint" | "lilac" | "peach" | "night" | "coral" | "sunny" | "sky"; form?: "blossom" | "scholar" | "moonpetal" | "dumpling"; outfit?: { head?: string; face?: string; held?: string } };
}

export const VISITORS: readonly Visitor[] = [
  { id: "pip", rarity: "common", name: { en: "Pip from the mill", zh: "磨坊的皮皮" }, note: { en: "Always passing by on an errand.", zh: "总是在跑腿的路上经过。" }, look: { line: "bold", stage: "baby", palette: "peach" } },
  { id: "moss", rarity: "common", name: { en: "Moss", zh: "青苔" }, note: { en: "Sat in the sun for an hour and left.", zh: "晒了一小时太阳就走了。" }, look: { line: "gentle", stage: "child", palette: "mint" } },
  { id: "lulu", rarity: "common", name: { en: "Lulu", zh: "露露" }, note: { en: "Hums a tune nobody else knows.", zh: "哼着一首别人都不会的歌。" }, look: { line: "curious", stage: "baby", palette: "lilac" } },
  { id: "dot", rarity: "common", name: { en: "Dot", zh: "小点" }, note: { en: "Very small. Very polite.", zh: "很小，很有礼貌。" }, look: { line: "gentle", stage: "baby", palette: "sky" } },
  { id: "bramble", rarity: "common", name: { en: "Bramble", zh: "荆棘" }, note: { en: "Came for the shade under the tree.", zh: "是来树下乘凉的。" }, look: { line: "bold", stage: "child", palette: "mint", outfit: { held: "flag" } } },
  { id: "pebble", rarity: "common", name: { en: "Pebble", zh: "石子" }, note: { en: "Left a smooth stone on the step.", zh: "在台阶上留了一颗光滑的石子。" }, look: { line: "curious", stage: "child", palette: "night" } },
  { id: "picnic", rarity: "uncommon", name: { en: "Picnic Pia", zh: "野餐的皮娅" }, note: { en: "Brought a basket and forgot to open it.", zh: "带了野餐篮，结果忘了打开。" }, look: { line: "gentle", stage: "teen", palette: "peach", outfit: { head: "sunhat", held: "balloon" } } },
  { id: "scholar", rarity: "uncommon", name: { en: "Professor Fen", zh: "芬教授" }, note: { en: "Asked your pet three questions and wrote down the answers.", zh: "问了你的宠物三个问题，还把答案记了下来。" }, look: { line: "curious", stage: "adult", palette: "lilac", form: "scholar", outfit: { face: "glasses" } } },
  { id: "snow", rarity: "uncommon", name: { en: "Snowcap", zh: "雪帽" }, note: { en: "Smelled of pine and cold air.", zh: "身上有松树和冷空气的味道。" }, look: { line: "bold", stage: "teen", palette: "sky", outfit: { head: "beanie" } } },
  { id: "bloom", rarity: "uncommon", name: { en: "Bloom", zh: "花开" }, note: { en: "Every step left a petal.", zh: "每走一步都落下一片花瓣。" }, look: { line: "gentle", stage: "adult", palette: "coral", form: "blossom" } },
  { id: "monarch", rarity: "rare", name: { en: "The Little Monarch", zh: "小小君主" }, note: { en: "Inspected the room, approved, departed.", zh: "巡视了一圈，点头，离开。" }, look: { line: "bold", stage: "adult", palette: "sunny", outfit: { head: "crown", face: "shades", held: "lantern" } } },
  { id: "moonwalker", rarity: "rare", name: { en: "Moonwalker", zh: "月行者" }, note: { en: "Only ever comes at night, and only for a moment.", zh: "只在夜里来，而且只待一会儿。" }, look: { line: "curious", stage: "adult", palette: "night", form: "moonpetal" } },
];

export const VISITOR: Readonly<Record<string, Visitor>> = Object.fromEntries(VISITORS.map((v) => [v.id, v]));
const WEIGHT = { common: 12, uncommon: 4, rare: 1 } as const;
const TOTAL = VISITORS.reduce((t, v) => t + WEIGHT[v.rarity], 0);

function mix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x5bd1e995, 0x27d4eb2f) ^ Math.imul(b ^ 0x165667b1, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Who a friend surprise on this beat was. */
export function visitorOn(petSeed: number, beat: number): Visitor {
  let r = mix(petSeed | 0, beat) % TOTAL;
  for (const v of VISITORS) {
    r -= WEIGHT[v.rarity];
    if (r < 0) return v;
  }
  return VISITORS[0]!;
}

/** Everyone who came by between two beats (the friend surprises of an absence), in order. */
export function visitorsDuring(petSeed: number, from: number, to: number): Array<{ beat: number; visitor: Visitor }> {
  const out: Array<{ beat: number; visitor: Visitor }> = [];
  for (let b = from + 1; b <= to; b++) if (awayEvent(petSeed, b) === EVENT.friend) out.push({ beat: b, visitor: visitorOn(petSeed, b) });
  return out;
}

export interface AlbumEntry {
  count: number;
  /** ms of the first visit */
  first: number;
}
export type Album = Record<string, AlbumEntry>;

/** The album with these visits added (beats are minutes). */
export function addToAlbum(album: Album, visits: ReadonlyArray<{ beat: number; visitor: Visitor }>): Album {
  const next: Album = { ...album };
  for (const v of visits) {
    const e = next[v.visitor.id];
    next[v.visitor.id] = e ? { count: e.count + 1, first: Math.min(e.first, v.beat * 60_000) } : { count: 1, first: v.beat * 60_000 };
  }
  return next;
}
