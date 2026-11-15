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

/* Companion palettes: the arena's helpers wear their own colours so they never read as your pet. */

/** Mint companions. */
export const MINT: Palette = { ...shared, O: "#1F5A47", o: "#2F8A6A", D: "#3FA27E", d: "#5CC39A", m: "#7FDCB4", l: "#A6EBCD", h: "#E2FBF0", b: "#FF8FAE", x: "#FFC83D", X: "#E0A21F" };
/** Lilac companions. */
export const LILAC: Palette = { ...shared, O: "#4A2F70", o: "#6E4AA0", D: "#8763BC", d: "#A27FD6", m: "#BC9EEB", l: "#D4BFF5", h: "#F3EBFF", b: "#FF8FAE", x: "#7FCB8E", X: "#4E9E6A" };
/** Peach companions. */
export const PEACH: Palette = { ...shared, O: "#7A4A2E", o: "#B5774F", D: "#D9936A", d: "#F0AE84", m: "#FFC7A2", l: "#FFDCC4", h: "#FFF3EA", b: "#FF6F8E", x: "#7FB7F0", X: "#3F7FC4" };
/** Night companions. */
export const NIGHT: Palette = { ...shared, O: "#141A33", o: "#2A3460", D: "#3A4880", d: "#4E5FA0", m: "#6B7CC0", l: "#93A1DB", h: "#D7DDF7", b: "#FF8FAE", x: "#FFC83D", X: "#E0A21F", t: "#9BE8FF" };
