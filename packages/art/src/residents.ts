/**
 * World residents: small creatures that live in the rooms on their own and are
 * not part of play (28-UX-MOTION-FEEL.md §7g). First, the cat.
 *
 * The cat faces right on a 24×20 canvas, paws on row 19. Poses: sitting (three
 * tail positions), walking (two steps), loafing asleep, and grooming.
 */

import type { Palette } from "./pixel";
import { Mask, PixelCanvas, cleanOutline, groundShadow, paintBody } from "./pixel";

export const CAT_W = 24;
export const CAT_H = 20;

export const CAT: Palette = {
  O: "#5A4660",
  o: "#8A7488",
  D: "#D4BE9B",
  d: "#EAD8BA",
  m: "#FFF3DE",
  l: "#FFFFFF",
  h: "#FFFFFF",
  b: "#FFA3B8",
  e: "#2B2140",
  w: "#FFFFFF",
  p: "#FF8FA8",
  t: "#FFC83D",
  n: "#2F7FD6",
  x: "#F2A65A",
  X: "#D8873B",
  s: "#2B214029",
};

export type CatPose = "sit0" | "sit1" | "sit2" | "walk0" | "walk1" | "nap" | "groom" | "look";
export const CAT_POSES: readonly CatPose[] = ["sit0", "sit1", "sit2", "walk0", "walk1", "nap", "groom", "look"];

const TAILS_SIT = [
  ["##....", ".##...", "..##..", "...###"],
  ["#.....", "##....", ".##...", "..####"],
  [".#....", ".##...", "..##..", "...###"],
] as const;

export function drawCat(pose: CatPose): PixelCanvas {
  const c = new PixelCanvas(CAT_W, CAT_H);
  const m = new Mask(CAT_W, CAT_H);
  let eyesAt: [number, number] | null = null;
  let asleep = false;

  if (pose.startsWith("sit") || pose === "groom" || pose === "look") {
    groundShadow(c, 11, 18, 7);
    m.ellipse(10.5, 13.5, 5.5, 5);
    m.ellipse(15.5, 8, 4.5, 4);
    m.polygon([[12, 6], [12.6, 2], [15.2, 4.4]]);
    m.polygon([[16.4, 4.4], [19, 2], [19.4, 6.2]]);
    m.ellipse(14.5, 18, 2, 1.3);
    m.ellipse(11.5, 18.2, 2, 1.2);
    const tail = TAILS_SIT[pose === "sit1" ? 1 : pose === "sit2" ? 2 : 0];
    m.stamp(tail as unknown as string[], 2, 13);
    eyesAt = pose === "look" ? [15, 8] : [16, 8];
  } else if (pose === "walk0" || pose === "walk1") {
    groundShadow(c, 12, 18, 8);
    m.ellipse(11.5, 12.5, 7, 4);
    m.ellipse(18, 8.5, 4.2, 3.8);
    m.polygon([[14.8, 6.5], [15.3, 2.6], [17.8, 5]]);
    m.polygon([[18.8, 5], [21.3, 2.6], [21.6, 6.6]]);
    const step = pose === "walk0";
    m.rect(step ? 6 : 7, 15, 2, 4);
    m.rect(step ? 9 : 8, 15, 2, 3);
    m.rect(step ? 14 : 15, 15, 2, 4);
    m.rect(step ? 17 : 16, 15, 2, 3);
    m.stamp(["..#", ".##", "##.", "#.."], 3, 6);
    m.rect(4, 9, 2, 3);
    eyesAt = [19, 8];
  } else {
    // nap: a loaf with the tail wrapped round
    groundShadow(c, 12, 18, 9);
    m.ellipse(11.5, 15, 8, 3.6);
    m.ellipse(18, 13.5, 4, 3.2);
    m.polygon([[15, 12], [15.4, 8.6], [17.6, 10.6]]);
    m.polygon([[18.6, 10.6], [20.8, 8.6], [21, 12]]);
    m.stamp(["######...", ".#######."], 6, 17);
    eyesAt = [18, 13];
    asleep = true;
  }

  paintBody(c, m, { shade: 1, light: 1 });
  cleanOutline(c);

  // orange patches on the back and one ear
  if (pose === "walk0" || pose === "walk1") {
    c.stamp([".xxx.", "xxxXx", ".XX.."], 8, 9);
    c.stamp(["x", "x"], 16, 4);
  } else if (pose === "nap") {
    c.stamp([".xxxx.", "xxxxXX"], 7, 12);
    c.stamp(["x"], 16, 10);
  } else {
    c.stamp([".xx.", "xxXx", "xXX.", ".X.."], 7, 10);
    c.stamp(["x", "x"], 13, 4);
  }
  // inner ears
  if (pose !== "nap") {
    const earY = pose.startsWith("walk") ? 5 : 4;
    const earX = pose.startsWith("walk") ? 19 : 17;
    c.set(earX + 1, earY, "b");
  }
  if (eyesAt) {
    const [ex, ey] = eyesAt;
    if (asleep) {
      c.set(ex - 2, ey, "e");
      c.set(ex - 1, ey, "e");
      c.set(ex + 1, ey, "e");
      c.set(ex + 2, ey, "e");
    } else if (pose === "groom") {
      c.set(ex - 1, ey, "e");
      c.set(ex + 2, ey, "e");
      c.stamp(["p"], ex + 1, ey + 2);
      c.stamp(["mm", "mm"], ex - 3, ey + 2); // paw raised to the face
    } else {
      c.set(ex - 1, ey, "e");
      c.set(ex - 1, ey - 1, "e");
      c.set(ex + 2, ey, "e");
      c.set(ex + 2, ey - 1, "e");
    }
    c.set(ex, ey + 1, "p");
    c.set(ex + 1, ey + 1, "p");
  }
  return c;
}
