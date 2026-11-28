/**
 * R75: the seasonal hide-and-seek's hiding places, as pixel art in the game's own hand: an outlined mound in the
 * plum ink with a light from the upper left, its shade below and to the right, and a soft shadow on the ground, then
 * what makes it the season's (spring's flowers on a bush, summer's shell ridges, autumn's leaves, winter's sparkle). They
 * were flat pink domes of a smooth gradient beside the pixel pet and its pixel room.
 */
import type { Season } from "@lingxi/game";

export const COVER_W = 20;
export const COVER_H = 15;
/** the mound's foot: rows below it are the ground's shadow */
const FOOT = 12;

export interface PixelArt {
  rows: readonly string[];
  colors: Readonly<Record<string, string>>;
}

const OUTLINE = "#2b2140";
const SHADOW = "rgba(43, 33, 64, 0.28)";

/** Whether (x, y) lies in the mound: half an ellipse standing on its flat foot. */
const inMound = (x: number, y: number) =>
  y >= 0 &&
  y <= FOOT &&
  ((x + 0.5 - COVER_W / 2) / (COVER_W / 2)) ** 2 + ((y + 0.5 - (FOOT + 1)) / (FOOT + 1)) ** 2 <= 1;

/** A small fixed scatter, the same on every draw: the art never flickers between renders. */
const scatter = (x: number, y: number, every: number) => (x * 7 + y * 13 + x * y) % every === 0;

function mound(accent: (x: number, y: number) => string | null): string[] {
  const rows: string[] = [];
  for (let y = 0; y < COVER_H; y++) {
    let row = "";
    for (let x = 0; x < COVER_W; x++) {
      if (y > FOOT) {
        // the shadow on the ground, a little narrower than the mound
        row +=
          y === FOOT + 1 && x >= 2 && x <= COVER_W - 3 ? "x" : y === FOOT + 2 && x >= 5 && x <= COVER_W - 6 ? "x" : ".";
        continue;
      }
      if (!inMound(x, y)) {
        row += ".";
        continue;
      }
      const edge = !inMound(x - 1, y) || !inMound(x + 1, y) || !inMound(x, y - 1) || !inMound(x, y + 1);
      if (edge) {
        row += "o";
        continue;
      }
      const lit = (x - 6) ** 2 + (y - 4) ** 2 < 7;
      const shade = y >= FOOT - 1 || (x > 13 && y > 6);
      row += accent(x, y) ?? (lit ? "c" : shade ? "b" : "a");
    }
    rows.push(row);
  }
  return rows;
}

const FLOWERS: ReadonlyArray<[number, number]> = [
  [5, 6],
  [10, 3],
  [14, 6],
  [7, 9],
  [12, 9],
  [16, 9],
];

function flowerAt(x: number, y: number): string | null {
  for (const [fx, fy] of FLOWERS) {
    if (x === fx && y === fy) return "e";
    if (Math.abs(x - fx) + Math.abs(y - fy) === 1) return "d";
  }
  return null;
}

/** The shell's ridges: seven rays fanning from the middle of its foot, one pixel to a row so each is unbroken. */
const RIDGES: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  for (let k = 0; k < 7; k++) {
    const angle = ((25 + k * (130 / 6)) * Math.PI) / 180;
    for (let y = 1; y < FOOT - 1; y++) {
      const x = Math.round(COVER_W / 2 + (FOOT + 1 - (y + 0.5)) / Math.tan(angle) - 0.5);
      out.add(`${x},${y}`);
    }
  }
  return out;
})();
const ridgeAt = (x: number, y: number): string | null => (RIDGES.has(`${x},${y}`) ? "b" : null);

export const SEEK_COVERS: Readonly<Record<Season, PixelArt>> = {
  spring: {
    rows: mound(flowerAt),
    colors: { o: OUTLINE, a: "#6fc36a", b: "#4a9a52", c: "#a6e39a", d: "#ff8fb6", e: "#fff3c4", x: SHADOW },
  },
  summer: {
    rows: mound(ridgeAt),
    colors: { o: OUTLINE, a: "#ffd9b8", b: "#e39a73", c: "#fff3e2", x: SHADOW },
  },
  autumn: {
    rows: mound((x, y) => (scatter(x, y, 9) ? "d" : scatter(x, y, 11) ? "e" : null)),
    colors: { o: OUTLINE, a: "#e98a3a", b: "#b85a2a", c: "#ffc46b", d: "#d8453a", e: "#f3d36b", x: SHADOW },
  },
  winter: {
    rows: mound((x, y) => (scatter(x, y, 17) && y < FOOT - 2 ? "d" : null)),
    colors: { o: OUTLINE, a: "#eef4ff", b: "#bcd2ee", c: "#ffffff", d: "#9cc4ff", x: SHADOW },
  },
};
