/**
 * The world's catalogue (P7: out of world.ts): every item and what it is worth, the shops' shelves, the drops
 * a room can give, and every recipe with what it takes and makes.
 */
/**
 * The world: rooms on a grid you walk between, things to find, a shop, a
 * workbench and quests. Pure functions over a small saved state; every random
 * find is decided by a hash of (seed, room, hour), so it cannot be rerolled by
 * reloading.
 */

import data from "./data/world.json";
import { ITEMS, type ItemDef, RECIPE_NAMES } from "./items";

export interface Item extends ItemDef {
  index: number;
  art: string;
}

export interface Recipe {
  index: number;
  name: { en: string; zh: string };
  out: number;
  outAmount: number;
  ins: Array<{ item: number; amount: number }>;
  /** a tool that must be in the bag; it is not used up (plan 4.5) */
  tool?: number;
  /** pet energy the work costs */
  energy: number;
  /** experience it gives the pet */
  xp: number;
  /** the only room it can be made in */
  room?: number;
}

/** Rooms that sell things, and what. Praline's shop has the crafting tools ("hobby tools for anyone who likes to mix and craft"). */
export const SHOPS: Record<number, number[]> = {
  13: [
    11130, 11110, 11120, 11140, 11302, 11304, 11313, 21201, 21202, 21203, 11201, 11203, 11204, 11233, 7104, 7103, 7102,
    7101, 23100, 23101, 23102,
  ],
  4: [11301, 11303, 11409, 21201, 11201, 11202],
};

/** Lingxi's own items, drawn for the garden rather than taken from the world data */
const OWN_ART: Record<number, string> = {
  7001: "art/items/garden/compost.png",
  7101: "art/items/garden/seed_apple.png",
  7102: "art/items/garden/seed_rice.png",
  7103: "art/items/garden/seed_pepper.png",
  7104: "art/items/garden/seed_clover.png",
  7201: "art/items/garden/rice_sheaf.png",
  7202: "art/items/garden/garden_pepper.png",
};

export const ITEM: Record<number, Item> = Object.fromEntries([
  ...(data.items as Array<{ index: number; art: string }>)
    .filter((i) => ITEMS[i.index])
    .map((i) => [i.index, { ...ITEMS[i.index]!, index: i.index, art: i.art }]),
  ...Object.entries(OWN_ART).map(([k, art]) => [Number(k), { ...ITEMS[Number(k)]!, index: Number(k), art }]),
]);

/** A rarity tier from the world sheet becomes a weight: tier 9 is 256 times as common as tier 1, tier 0 never drops. */

/** Walk the cumulative weights with a random number; one rule for looking around, walks and away finds. */
export function pickDrop(drops: ReadonlyArray<{ item: number; weight: number }>, r: number): number {
  const total = drops.reduce((s, d) => s + d.weight, 0);
  let x = r % total;
  for (const d of drops) {
    if (x < d.weight) return d.item;
    x -= d.weight;
  }
  return drops[0]!.item;
}

/**
 * The workbench's recipes with the source's own amounts (plan 4.5): no more squashing hundreds of pollen into a
 * handful, which made one extraction last a hundred brews. Its stamina becomes pet energy at the same ratio as a
 * move (5 stamina to 15 energy); its account XP becomes pet experience by square root, so a 10,000-XP recipe gives
 * 100 against a caring day's 27.
 */
export const craftEnergy = (stamina: number) => stamina * 3;

export const craftXp = (sourceXp: number) => Math.round(Math.sqrt(Math.max(0, sourceXp)));

/**
 * Small batches beside the source's bulk recipes (G6, G8): a handful made by hand at the bench, no tool, for a player
 * who needs one now. Quest 37's "three pebbles make a stone block" is the first. Every building material (plank, metal
 * bar, stone block, from either source) has one.
 */
export const small = (index: number, en: string, zh: string, out: number, item: number): Recipe => ({
  index,
  name: { en, zh },
  out,
  outAmount: 1,
  ins: [{ item, amount: 3 }],
  energy: craftEnergy(10),
  xp: craftXp(9),
});

export const SMALL_BATCH_RECIPES: readonly Recipe[] = [
  small(30001, "Shape a Stone Block", "拼一个石块", 1301, 1002),
  small(30002, "Chip a Stone Block from Fossil", "用化石凿一个石块", 1301, 1020),
  small(30003, "Lash a Plank", "绑一块木板", 1302, 1001),
  small(30004, "Weave a Plank from Stems", "用干茎编一块木板", 1302, 1016),
  small(30005, "Hammer a Metal Bar", "敲一根金属条", 1303, 1005),
  small(30006, "Bend a Bar from Pipe", "用旧管子弯一根金属条", 1303, 1017),
];

/**
 * The source's bulk recipes turn 100 of a material into one plank, bar or block with a tool and 150 energy: worse in
 * every way than three of it by hand (G6). A bulk batch now yields BULK_YIELD, so a player who gathered a hundred and
 * owns the tool makes more per piece and per energy than by hand.
 */
export const BULK_YIELD = 50;

const BULK_RECIPES = new Set([31, 32, 33, 34, 35, 36]);

const SOURCE_RECIPES: Recipe[] = (
  data.recipes as Array<{
    index: number;
    out: number;
    outAmount: number;
    ins: Array<{ item: number; amount: number }>;
    stamina: number;
    xp: number;
    tool: number | null;
    room: number | null;
  }>
)
  .filter(
    (r) =>
      RECIPE_NAMES[r.index] && ITEM[r.out] && r.ins.every((x) => ITEM[x.item]) && (r.tool === null || ITEM[r.tool]),
  )
  .map((r) => ({
    index: r.index,
    name: RECIPE_NAMES[r.index]!,
    out: r.out,
    outAmount: BULK_RECIPES.has(r.index) ? BULK_YIELD : Math.max(1, r.outAmount),
    ins: r.ins.map((x) => ({ item: x.item, amount: x.amount })),
    ...(r.tool !== null ? { tool: r.tool } : {}),
    energy: craftEnergy(r.stamina),
    xp: craftXp(r.xp),
    ...(r.room !== null ? { room: r.room } : {}),
  }));

export const RECIPES: Recipe[] = [...SOURCE_RECIPES, ...SMALL_BATCH_RECIPES];

/** Recipes only a trip teaches: the garden's harvest turned into mochi. */
export const TRAVEL_RECIPES: readonly Recipe[] = [
  {
    index: 20001,
    name: { en: "Pound Rice Mochi", zh: "捣米麻薯" },
    out: 11130,
    outAmount: 2,
    ins: [
      { item: 7201, amount: 2 },
      { item: 11312, amount: 1 },
    ],
    energy: 30,
    xp: 5,
  },
  {
    index: 20002,
    name: { en: "Fold Apple Jam Mochi", zh: "包苹果酱麻薯" },
    out: 11120,
    outAmount: 2,
    ins: [
      { item: 11313, amount: 2 },
      { item: 7201, amount: 1 },
    ],
    energy: 30,
    xp: 5,
  },
  {
    index: 20003,
    name: { en: "Roll Honey Mochi", zh: "滚蜂蜜麻薯" },
    out: 11140,
    outAmount: 2,
    ins: [
      { item: 11312, amount: 2 },
      { item: 7201, amount: 1 },
    ],
    energy: 30,
    xp: 5,
  },
  // taught by friends at trust level 3 (friends/residents.ts), each the thing their shelf would otherwise sell
  // G6: two a stir, and Wick hands over two Glow Roots with the recipe (a root is a 0.19% find; the shelf sells one tonic for 60)
  {
    index: 20004,
    name: { en: "Stir Moon Tonic", zh: "调月光补剂" },
    out: 11004,
    outAmount: 2,
    ins: [
      { item: 1121, amount: 150 },
      { item: 1112, amount: 100 },
    ],
    energy: 30,
    xp: 5,
  },
  {
    index: 20005,
    name: { en: "Pound Taro Mochi", zh: "捣芋泥麻薯" },
    out: 11110,
    outAmount: 2,
    ins: [
      { item: 7201, amount: 2 },
      { item: 1201, amount: 100 },
    ],
    energy: 30,
    xp: 5,
  },
  {
    index: 20006,
    name: { en: "Yonder's Lucky Tea", zh: "阿远的好运茶" },
    out: 11405,
    outAmount: 1,
    ins: [
      { item: 1111, amount: 100 },
      { item: 1104, amount: 100 },
    ],
    energy: 30,
    xp: 5,
  },
  // G6: two from two candies (25 each at the shop), so it beats Twain's shelf price of 45
  {
    index: 20007,
    name: { en: "Double Wisdom Candy", zh: "炼大智慧糖" },
    out: 11202,
    outAmount: 2,
    ins: [
      { item: 11201, amount: 2 },
      { item: 1103, amount: 100 },
    ],
    energy: 30,
    xp: 5,
  },
  // G6: Bolt's trick beats three scrap by hand and needs no burner (it used to need thirty and an Old Coin for one bar)
  {
    index: 20008,
    name: { en: "Bolt's Quick Melt", zh: "阿栓的快熔法" },
    out: 1303,
    outAmount: 5,
    ins: [{ item: 1005, amount: 12 }],
    energy: 30,
    xp: 5,
  },
  {
    index: 20009,
    name: { en: "Warm Honeydrops", zh: "捂蜜露" },
    out: 11312,
    outAmount: 2,
    ins: [
      { item: 11311, amount: 1 },
      { item: 1011, amount: 1 },
    ],
    energy: 30,
    xp: 5,
  },
  {
    index: 20010,
    name: { en: "Nurse Why's Calm Tea", zh: "小慧的安神茶" },
    out: 11404,
    outAmount: 1,
    ins: [
      { item: 1111, amount: 100 },
      { item: 1110, amount: 50 },
    ],
    energy: 30,
    xp: 5,
  },
  {
    index: 20011,
    name: { en: "Grill a Burger", zh: "烤汉堡" },
    out: 11302,
    outAmount: 1,
    ins: [
      { item: 7202, amount: 1 },
      { item: 7201, amount: 1 },
    ],
    energy: 30,
    xp: 5,
  },
  {
    index: 20012,
    name: { en: "Spin Rock Candyfloss", zh: "转棉花岩糖" },
    out: 21205,
    outAmount: 1,
    ins: [
      { item: 1201, amount: 150 },
      { item: 1103, amount: 50 },
    ],
    energy: 30,
    xp: 5,
  },
];
