/**
 * The castle quest's keys and the rest of the world's items that mean something here. (P7: out of the item table in items.ts, which merges every group.)
 */
import type { ItemDef } from "./items";
import { I } from "./itemMaker";

export const WORLD_ITEMS: Record<number, ItemDef> = {
  // keys of the castle quest
  100001: I("Star Disk", "星盘", "A golden disk engraved with strange stars.", "刻着奇怪星辰的金色圆盘。", "treasure"),
  100002: I(
    "Old Gear",
    "古老齿轮",
    "A sturdy part from some ancient machine.",
    "某台古老机器上的结实零件。",
    "treasure",
  ),
  100003: I(
    "Temple Map",
    "神殿地图",
    "A golden disk shaped like a map of a temple.",
    "做成神殿地图模样的金色圆盘。",
    "treasure",
  ),
  100004: I(
    "Sky Sextant",
    "天空六分仪",
    "It points the way to places beyond sight.",
    "能指向看不见的地方。",
    "treasure",
  ),
  100010: I("Dowsing Rod", "探水杖", "It twitches near hidden things.", "靠近藏起来的东西时会抖动。", "treasure"),
  100012: I(
    "Twig Charm",
    "树枝护身符",
    "A little charm of stick, pebble and honey.",
    "用树枝、小石子和树蜜做的小护身符。",
    "treasure",
  ),

  // plan 4.5: the rest of the world's items that mean something here
};
