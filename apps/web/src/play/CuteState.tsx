/**
 * Empty, waiting and offline moments with company: the resident cat (napping when
 * there is nothing yet, looking up while something loads) or the pet itself, so a
 * blank list never feels like a broken one.
 */

import { useMemo } from "react";
import { CAT, type CatPose, boundingBox, drawCat, drawPet } from "@lingxi/art";
import type { Pet } from "@lingxi/game";
import { PALETTE_OF } from "../scene/palette";
import { Sprite } from "./Sprite";
import "./cute.css";

type Who = { cat: CatPose } | { pet: Pet; expression: "sleepy" | "shy" | "sad" | "happy" | "neutral" };

export function CuteState({ who, text, busy = false }: { who: Who; text: string; busy?: boolean }) {
  const art = useMemo(() => ("cat" in who ? drawCat(who.cat) : drawPet(who.pet.line, "baby", { expression: who.expression })), [who]);
  const palette = "cat" in who ? CAT : PALETTE_OF[who.pet.line];
  // each sprite cropped to its own outline (plus a pixel), so a napping cat isn't lost in empty space
  const box = useMemo(() => {
    const b = boundingBox(art);
    return { x: Math.max(0, b.x - 1), y: Math.max(0, b.y - 1), w: Math.min(art.w, b.w + 2), h: Math.min(art.h, b.h + 2) };
  }, [art]);
  return (
    <div className={`cute-state${busy ? " busy" : ""}`} role={busy ? "status" : undefined}>
      <span className="cute-art" aria-hidden="true">
        <Sprite canvas={art} palette={palette} scale={3} crop={box} />
      </span>
      <p className={`small${busy ? " thinking-dots" : ""}`}>{text}</p>
    </div>
  );
}
