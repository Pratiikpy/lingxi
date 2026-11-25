/**
 * The room's art that is loaded or drawn once (P7: out of RoomScene): the quest mark over a resident's head, and the
 * background textures, still or animated, cached by address.
 */
import { Assets, type Graphics, Sprite, type Texture } from "pixi.js";
import { AnimatedGIF } from "@pixi/gif";

/** The quest mark: a little pixel sign, "!" in gold for a quest to take, a tick in green for one to hand in. */
const MARKS: Record<"!" | "✓" | "★", { rows: string[]; fill: string }> = {
  "!": {
    rows: [
      ".OOOOOOO.",
      "OyyyKyyyO",
      "OyyyKyyyO",
      "OyyyKyyyO",
      "OyyyyyyyO",
      "OyyyKyyyO",
      "OyyyyyyyO",
      ".OOOOOOO.",
      "...OyO...",
      "....O....",
    ],
    fill: "#FFC83D",
  },
  "✓": {
    rows: [
      ".OOOOOOO.",
      "OyyyyyyyO",
      "OyyyyyyKO",
      "OyKyyyKyO",
      "OyyKyKyyO",
      "OyyyKyyyO",
      "OyyyyyyyO",
      ".OOOOOOO.",
      "...OyO...",
      "....O....",
    ],
    fill: "#7FD48A",
  },
  // a friendship step is waiting (plan 4.3)
  "★": {
    rows: [
      ".OOOOOOO.",
      "OyyyKyyyO",
      "OyyKKKyyO",
      "OKKKKKKKO",
      "OyKKKKKyO",
      "OyKKyKKyO",
      "OyyyyyyyO",
      ".OOOOOOO.",
      "...OyO...",
      "....O....",
    ],
    fill: "#F49AC1",
  },
};
export function drawMark(g: Graphics, kind: "!" | "✓" | "★"): void {
  const m = MARKS[kind];
  m.rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === ".") return;
      g.rect(x, y, 1, 1).fill(ch === "y" ? m.fill : "#2B2140");
    }),
  );
}

const bgCache = new Map<string, Texture>();
export async function bgTexture(url: string): Promise<Texture> {
  const hit = bgCache.get(url);
  if (hit) return hit;
  const t: Texture = await Assets.load(url);
  t.source.scaleMode = "nearest";
  bgCache.set(url, t);
  return t;
}
const gifCache = new Map<string, Promise<ArrayBuffer>>();
/** A room background: a still image, or an animated GIF (three rooms move). */
export async function makeBg(url: string, still: boolean): Promise<Sprite> {
  if (!url.endsWith(".gif")) return new Sprite(await bgTexture(url));
  let buf = gifCache.get(url);
  if (!buf) {
    buf = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`background ${url}: ${r.status}`);
      return r.arrayBuffer();
    });
    gifCache.set(url, buf);
  }
  const gif = AnimatedGIF.fromBuffer(await buf, { scaleMode: "nearest", autoPlay: !still });
  return gif;
}
