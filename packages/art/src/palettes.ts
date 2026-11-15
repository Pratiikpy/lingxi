/**
 * Sunrise Pet palettes. One per egg line; every pet drawing uses the same roles,
 * so a line is a recolour plus its own silhouette details.
 * Ink, shine and trace colours are shared so faces and circuits read the same on
 * every pet.
 */

import type { Palette } from "./pixel";

const shared = {
  e: "#2B2140", // plum ink (eyes, mouth)
  w: "#FFFFFF",
  p: "#FF6F8E",
  t: "#FFC83D", // sunny trace
  n: "#2F7FD6", // sky node
  s: "#2B214033", // ground shadow, 20% ink
};

/** Gentle line, coral: Mochi. */
export const CORAL: Palette = {
  ...shared,
  O: "#7A2E3A",
  o: "#B24A45",
  D: "#C9483A",
  d: "#E8604A",
  m: "#FF7A59",
  l: "#FF9A78",
  h: "#FFD8C6",
  b: "#FF5C86",
  x: "#7FCB8E",
  X: "#4E9E6A",
};

/** Curious line, sky: Sora. */
export const SKY: Palette = {
  ...shared,
  O: "#21406F",
  o: "#3C6BA8",
  D: "#3F7FC4",
  d: "#5D9EE0",
  m: "#7FC0F2",
  l: "#A4D6F8",
  h: "#E6F5FF",
  b: "#FF8FAE",
  t: "#FFD45E",
  n: "#FF7A59",
  x: "#FFC83D",
  X: "#E0A21F",
};

/** Bold line, sunny: Hoshi. */
export const SUNNY: Palette = {
  ...shared,
  O: "#7A4614",
  o: "#B5752A",
  D: "#D98C1C",
  d: "#F0A92A",
  m: "#FFC83D",
  l: "#FFD970",
  h: "#FFF3C9",
  b: "#FF7F6A",
  t: "#FF7A59",
  n: "#2F7FD6",
  x: "#FF7A59",
  X: "#D9573A",
};

/** Egg shell, shared by every line; the line shows in the spots. */
export const SHELL: Palette = {
  ...shared,
  O: "#6B4A5C",
  o: "#A7849A",
  D: "#D9C6CF",
  d: "#EADDE2",
  m: "#FFF7E8",
  l: "#FFFDF7",
  h: "#FFFFFF",
  b: "#FF9DB6",
  x: "#FF7A59",
  X: "#E8604A",
};
