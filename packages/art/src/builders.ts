/**
 * Builders' Lane (PRD R2): the colours and props of the five resident pets.
 * Behemoth wears its four accumulator lamps (one piece for each of the sixteen
 * numbers they can show, high bit on the left), Little Mars holds a telescope,
 * Tapboy a handheld, Hardhat a helmet, and Diver a snorkel mask and notebook.
 */

import type { Palette } from "./pixel";
import { type Wearable, registerWearables } from "./wear";

const shared = { e: "#2B2140", w: "#FFFFFF", p: "#FF6F8E", t: "#FFC83D", n: "#2F7FD6", s: "#2B214033" };

/** Behemoth: dark silicon with a gold trace. */
export const SILICON: Palette = { ...shared, O: "#141B2B", o: "#26324A", D: "#33435F", d: "#465A7C", m: "#5D7499", l: "#7F96B8", h: "#C9D6EA", b: "#FF8FAE", x: "#FFC83D", X: "#E0A21F", t: "#FFD86B", n: "#7FE0B0" };
/** Little Mars: a warm red planet. */
export const MARS: Palette = { ...shared, O: "#6B1F1A", o: "#9C3324", D: "#B8412B", d: "#D4553A", m: "#EC6E4E", l: "#F7906E", h: "#FFD2BE", b: "#FF5C86", x: "#FFC83D", X: "#E0A21F" };

const O = "#2B2140";
const ON = "#FFD86B";
const OFF = "#3A3352";

/** The lamps for one accumulator value: bit 3 on the left, bit 0 on the right. */
function lamps(value: number): Wearable {
  return {
    id: `b:lamps${value}`,
    slot: "head",
    name: { en: "Accumulator lamps", zh: "累加器指示灯" },
    rows: ["OOOOOOOOOOOOO", "OddOccObbOaaO", "OddOccObbOaaO", "OOOOOOOOOOOOO", "..O.......O.."],
    colors: { O, a: value & 1 ? ON : OFF, b: value & 2 ? ON : OFF, c: value & 4 ? ON : OFF, d: value & 8 ? ON : OFF },
  };
}

export const BUILDER_WEARABLES: readonly Wearable[] = [
  ...Array.from({ length: 16 }, (_, v) => lamps(v)),
  { ...lamps(0), id: "b:lamps" },
  {
    id: "b:telescope",
    slot: "held",
    name: { en: "Brass telescope", zh: "黄铜望远镜" },
    rows: ["......OOO", ".....OwwO", "....OggO.", "...OggO..", "..OGGO...", ".OGGO....", "OGGO.k...", ".OO..k...", "....kkk.."],
    colors: { O, g: "#E0B45A", G: "#B88A34", w: "#BFE6FF", k: "#5B4E73" },
  },
  {
    id: "b:handheld",
    slot: "held",
    name: { en: "Little handheld", zh: "小掌机" },
    rows: ["OOOOOOO", "OkkkkkO", "OksgskO", "OkgsskO", "OkkkkkO", "OkrkbkO", "OOOOOOO"],
    colors: { O, k: "#E6E3F2", s: "#8FE3A2", g: "#2F7F54", r: "#E5486C", b: "#2F7FD6" },
  },
  {
    id: "b:hardhat",
    slot: "head",
    name: { en: "Builder's helmet", zh: "安全帽" },
    rows: ["...OOOOO...", "..OhhwhhO..", ".OhhhwhhhO.", ".OhhhwhhhO.", "OOOOOOOOOOO", "OhhhhhhhhhO", ".OOOOOOOOO."],
    colors: { O, h: "#FF8A3D", w: "#FFF3E0" },
  },
  {
    id: "b:snorkel",
    slot: "face",
    name: { en: "Snorkel mask", zh: "潜水面镜" },
    rows: ["OOOOOOOOOOOOYY", "OggggOOggggOYY", ".OOOO..OOOO.YY"],
    rowsSmall: ["OOOOOOOOOOYY", "OgggOOgggOYY", ".OOO..OOO.YY"],
    colors: { O, g: "#9BE8FFA0", Y: "#FF8A3D" },
  },
  {
    id: "b:notebook",
    slot: "held",
    name: { en: "Observation diary", zh: "观察日记" },
    rows: ["OOOOOO", "OrwwwO", "OrwkwO", "OrwwwO", "OrwkwO", "OrwwwO", "OOOOOO"],
    colors: { O, r: "#E5486C", w: "#FFFDF8", k: "#9A8FB0" },
  },
];

registerWearables(BUILDER_WEARABLES);
