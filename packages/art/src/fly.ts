/**
 * A fruit fly, for brains brought in from TapeFly's brawl (PRD A1b). Drawn
 * front-on in the same pixel roles as the pets: red compound eyes, a plum body,
 * and pale wings veined with circuit traces.
 */

import type { Palette } from "./pixel";
import { PixelCanvas } from "./pixel";

const BODY = [
  "...OOOO....OOOO...",
  "..OxxxxO..OxxxxO..",
  "..OxwxxOOOOxwxxO..",
  "..OxxxXOmmOXxxxO..",
  "...OXXOmmmmOXXO...",
  "hh..OOmmllmmOO..hh",
  "hhhOOmmmmmmmmOOhhh",
  "hnhhOmmmllmmmOhhnh",
  ".hnhhOmmmmmmOhhnh.",
  "..hhhOmmmmmmOhhh..",
  "...O.OmmmmmmO.O...",
  "..O..OdmmmmdO..O..",
  ".O....OddddO....O.",
  "......O.OO.O......",
  ".....O..O..O......",
];

/** A wing beat: the wings lift one row. */
const WINGS_UP = [
  "hhh.OOmmllmmOO.hhh",
  "hnhhOmmmmmmmmOhhnh",
  ".hnhOmmmllmmmOhnh.",
];

export function drawFly(opt: { flap?: boolean; hurt?: boolean } = {}): PixelCanvas {
  const c = new PixelCanvas(18, 17);
  for (let x = 3; x < 15; x++) c.set(x, 16, "s");
  c.stamp(BODY, 0, 1);
  if (opt.flap) c.stamp(WINGS_UP, 0, 5);
  if (opt.hurt) {
    // squeezed eyes
    c.stamp(["..OeeeeO..OeeeeO.."], 0, 3);
  }
  return c;
}

export const FLY: Palette = {
  O: "#2B2140",
  o: "#2B2140",
  D: "#262838",
  d: "#34374D",
  m: "#4A4E69",
  l: "#6E7391",
  h: "#E6F0FF",
  b: "#FF8FAE",
  e: "#2B2140",
  w: "#FFFFFF",
  p: "#FF6F8E",
  t: "#FFC83D",
  n: "#7FB7F0",
  x: "#E5486C",
  X: "#B22F52",
  s: "#2B214033",
};
