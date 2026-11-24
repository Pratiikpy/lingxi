/**
 * Garden art (PRD W2, C4): compost, seed packets, the new crops and the four
 * growth stages of a plot. 24×24 like the item sprites, drawn in Lingxi's own
 * plum outline. A seed packet is one drawing recoloured per crop.
 */

export interface Sprite24 {
  rows: readonly string[];
  colors: Record<string, string>;
}

const O = "#2B2140";

/** a sack of compost: earthy, with a leaf on top */
export const COMPOST: Sprite24 = {
  rows: [
    "........................",
    "..........gG............",
    ".........gggG...........",
    "........ggGgG...........",
    "..........G.............",
    "......OOOOOOOOOOO.......",
    ".....OtttttttttttO......",
    ".....OtTTTTTTTTTtO......",
    "......OtttttttttO.......",
    ".....OssssssssssO.......",
    "....OsSSsssSSsssSO......",
    "...OssssSssssssSssO.....",
    "...OsSssssSSsssssSO.....",
    "..OssssSsssssSssssO.....",
    "..OsSssssssSsssSssO.....",
    "..OssssSSsssssssssSO....",
    "..OsssssssSssSsssssO....",
    "..OssSssssssssssSssO....",
    "...OssssSsssSsssssO.....",
    "...OOssssssssssssOO.....",
    ".....OOOOOOOOOOOO.......",
    "....pppppppppppppp......",
    "........................",
    "........................",
  ],
  colors: { O, t: "#C79A6B", T: "#A37A4F", s: "#7A5236", S: "#5A3A24", g: "#7FCB8E", G: "#4E9E6A", p: "#2B214033" },
};

/** a seed packet; c and C are the crop's colours, d its seed dots */
export const PACKET = (crop: string, shade: string): Sprite24 => ({
  rows: [
    "........................",
    "........................",
    "......OOOOOOOOOOOO......",
    "......OwwwwwwwwwwO......",
    "......OwWWWWWWWWwO......",
    "......OOOOOOOOOOOO......",
    "......OwwwwwwwwwwO......",
    "......OwwwccccwwwO......",
    "......OwwccccccwwO......",
    "......OwccccCcccwO......",
    "......OwccCccccCwO......",
    "......OwcccccCccwO......",
    "......OwwcCcccCwwO......",
    "......OwwwccccwwwO......",
    "......OwwwwggwwwwO......",
    "......OwwwwggwwwwO......",
    "......OwwwwwwwwwwO......",
    "......OwdwwdwwdwwO......",
    "......OwwwwwwwwwwO......",
    "......OWWWWWWWWWWO......",
    "......OOOOOOOOOOOO......",
    ".......pppppppppppp.....",
    "........................",
    "........................",
  ],
  colors: { O, w: "#FFF7E8", W: "#EBD9BC", c: crop, C: shade, g: "#4E9E6A", d: "#7A5236", p: "#2B214033" },
});

/** a sheaf of rice */
export const RICE: Sprite24 = {
  rows: [
    "........................",
    ".........y..y...........",
    "........yYy.yYy..y......",
    ".......yYy..yYy.yYy.....",
    "......yYy..yYy..yYy.....",
    ".....yYy...yY...Yy......",
    "......Yy..yY...Yy.......",
    ".......Y..Y...Yy........",
    "........Y.Y..Y..........",
    ".........YYYY...........",
    "........OGGGGO..........",
    ".........GGGG...........",
    "........OrrrrO..........",
    ".........GGGG...........",
    ".........GGgG...........",
    "........GGgGgG..........",
    ".......GGgG.GgG.........",
    "......GgG....GgG........",
    ".....GgG......GgG.......",
    "....OGG........GGO......",
    "........................",
    ".....pppppppppppp.......",
    "........................",
    "........................",
  ],
  colors: { O, y: "#FFE08A", Y: "#E0A21F", G: "#6E9A3A", g: "#9CC45A", r: "#C9483A", p: "#2B214033" },
};

/** a red garden pepper */
export const PEPPER: Sprite24 = {
  rows: [
    "........................",
    "...........GG...........",
    "..........GgG...........",
    ".........OGGO...........",
    "........OGGGGO..........",
    ".......OrrrrrrO.........",
    "......OrhhrrrrRO........",
    "......OrhrrrrrRO........",
    "......OrrrrrrrRO........",
    "......OrrrrrrrRO........",
    "......OrrrrrrRRO........",
    ".......OrrrrrRO.........",
    ".......OrrrrrRO.........",
    "........OrrrRO..........",
    "........OrrrRO..........",
    ".........OrRO...........",
    ".........OrRO...........",
    "..........OO............",
    "........................",
    "......pppppppppp........",
    "........................",
    "........................",
    "........................",
    "........................",
  ],
  colors: { O, r: "#E8604A", R: "#B24A45", h: "#FFD8C6", G: "#4E9E6A", g: "#7FCB8E", p: "#2B214033" },
};

/** a garden plot in four stages: 0 bare soil, 1 sprout, 2 leafy, 3 ripe (c = the crop's colour) */
export function plotRows(stage: 0 | 1 | 2 | 3): readonly string[] {
  const soil = [
    "....OOOOOOOOOOOOOOOO....",
    "...OsSsssSsssssSssssO...",
    "..OssssSsssSsssssSsssO..",
    "..OsSsssssssssSsssssSO..",
    "...OOOOOOOOOOOOOOOOOO...",
  ];
  const above: Record<number, string[]> = {
    0: Array(12).fill("........................"),
    1: [
      "........................",
      "........................",
      "........................",
      "........................",
      "........................",
      "........................",
      "........................",
      "...........gG...........",
      "..........gGgG..........",
      "...........gG...........",
      "...........G............",
      "...........G............",
    ],
    2: [
      "........................",
      "........................",
      "........................",
      "........................",
      ".........gg..gg.........",
      "........gGGggGGg........",
      ".......gGgGGGGgGg.......",
      "........gGGGGGGg........",
      ".......gGgGGGGgGg.......",
      "........ggGGGGgg........",
      "...........GG...........",
      "...........GG...........",
    ],
    3: [
      "........................",
      ".........gg..gg.........",
      "........gGcCggCcg.......",
      ".......gGcccGcccGg......",
      "......gGgcCcGcCcgGg.....",
      ".......gGcccGcccGg......",
      "......gGgGcCGCcGgGg.....",
      ".......gGGcccccGGg......",
      "........ggGcCcGgg.......",
      "..........gGGGg.........",
      "...........GG...........",
      "...........GG...........",
    ],
  };
  return [...Array(7).fill("........................"), ...above[stage]!, ...soil];
}

export const PLOT_COLORS = (crop: string, shade: string): Record<string, string> => ({
  O,
  s: "#7A5236",
  S: "#5A3A24",
  g: "#7FCB8E",
  G: "#4E9E6A",
  c: crop,
  C: shade,
});
