/**
 * Lingxi's items: pixel item art with Lingxi's own names, words and
 * effects. Items not listed here (dark or farming-only ones) do not exist in
 * Lingxi. Effects are in visible meter units (0..1000).
 */

import { FOUND } from "./itemsFound";
import { FOOD } from "./itemsFood";
import { WORLD_ITEMS } from "./itemsWorld";
import { USE_ITEMS } from "./itemsUse";
export type ItemKind = "material" | "food" | "drink" | "treasure" | "box" | "tool";
export type Diet = "sweet" | "fruit" | "savory" | "grain";

export interface ItemDef {
  name: { en: string; zh: string };
  desc: { en: string; zh: string };
  kind: ItemKind;
  /** what using it does to the pet */
  use?: { food?: number; joy?: number; energy?: number; clean?: number; xp?: number; diet?: Diet; wake?: boolean };
  /** shop price in coins; absent = not sold */
  price?: number;
  /** at most this many may ever be used (the source's per-item limits) */
  limit?: number;
  /** a lasting effect for the next look around or spar (the source's NEXT and TEMP bonuses) */
  buff?: Buff;
  /** what comes back after use (the source's ITEM return, an empty cup from a potion) */
  returns?: number;
  /** a kind treat that can travel in a gift and be given to a friend's pet when they open it */
  friend?: true;
}

/** Bonuses held until they are spent: the next look around, the next spar. */
export interface Buff {
  forageExtra?: number;
  sparPower?: number;
  sparHp?: number;
  sparLossCoins?: number;
}

/** Every item, by id: the groups merged (numeric keys keep their order, so the table iterates as it always did). */
export const ITEMS: Record<number, ItemDef> = { ...FOUND, ...FOOD, ...WORLD_ITEMS, ...USE_ITEMS };

/** Recipes Lingxi keeps, by recipe index, with Lingxi names. */
export const RECIPE_NAMES: Record<number, { en: string; zh: string }> = {
  1: { en: "Brew Study Tea", zh: "泡学习茶" },
  2: { en: "Brew Scholar's Tea", zh: "泡学者茶" },
  18: { en: "Brew Fierce Tonic", zh: "熬斗志药水" },
  22: { en: "Make a Coin Magnet", zh: "做金币磁石" },
  23: { en: "Mix Spirit Glue", zh: "调灵胶" },
  26: { en: "Make Flash Charms", zh: "做闪光护符" },
  28: { en: "Brew Toadstool Brew", zh: "酿蘑菇酿" },
  33: { en: "Grind Fossil into Stone Blocks", zh: "把化石磨成石块" },
  38: { en: "Grind Litter into Sparkle Dust", zh: "把垃圾碎屑磨成闪粉" },
  3: { en: "Brew Fresh Start Tea", zh: "泡重新开始茶" },
  4: { en: "Brew Calm Tea", zh: "泡安神茶" },
  5: { en: "Brew Lucky Tea", zh: "泡好运茶" },
  6: { en: "Shake out Pollen", zh: "抖松花粉" },
  7: { en: "Grind Sparkle Dust", zh: "磨闪粉" },
  8: { en: "Press Daffodil Drops", zh: "压水仙露" },
  9: { en: "Shred Mint", zh: "切薄荷" },
  10: { en: "Press Poppy Ink", zh: "压罂粟墨" },
  11: { en: "Build the Sky Sextant", zh: "组装天空六分仪" },
  12: { en: "Scrape Berry Frost", zh: "刮莓霜" },
  13: { en: "Grind Amber", zh: "磨琥珀" },
  14: { en: "Stir Sweet Syrup", zh: "调甜糖浆" },
  15: { en: "Cook Resin Syrup", zh: "熬树脂糖浆" },
  16: { en: "Grind Mushroom Spice", zh: "磨蘑菇香料" },
  17: { en: "Carve a Stone Cup", zh: "凿石杯" },
  19: { en: "Mix Sparkle Soda", zh: "调气泡汽水" },
  20: { en: "Write a Sorry Note", zh: "写道歉信" },
  21: { en: "Make Festival Bells", zh: "做节日铃铛" },
  29: { en: "Brew Sage's Tea", zh: "泡贤者茶" },
  30: { en: "Join the Six Sparks", zh: "合成五感之心" },
  31: { en: "Press a Plank from Stems", zh: "用菌柄压木板" },
  32: { en: "Bend a Metal Bar", zh: "弯金属条" },
  34: { en: "Press a Plank", zh: "压木板" },
  35: { en: "Melt a Metal Bar", zh: "熔金属条" },
  36: { en: "Cut a Stone Block", zh: "切石块" },
  39: { en: "Make Glow Paste", zh: "做荧光膏" },
  40: { en: "Brew Moon Tonic", zh: "熬月光补剂" },
  41: { en: "Make a Dowsing Rod", zh: "做探水杖" },
  42: { en: "Make a Twig Charm", zh: "做树枝护身符" },
  10002: { en: "Offer an Old Coin", zh: "献上古钱币" },
};
