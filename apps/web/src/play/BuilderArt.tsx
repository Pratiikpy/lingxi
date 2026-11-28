/**
 * A Builders' Lane pet drawn as itself, wearing what it wears at the hour `ms` (Behemoth's lamps follow its CPU). Out
 * of Builders.tsx (R71) so the list of neighbours draws the lane pets without loading the lane card's chain reads.
 */
import { useMemo } from "react";
import { boundingBox, drawPet, wearOverlay } from "@lingxi/art";
import type { BuilderPet } from "@lingxi/game";
import { PALETTES, builderOutfit } from "../game/builderScene";
import { Sprite } from "./Sprite";

export function BuilderArt({ b, scale, ms }: { b: BuilderPet; scale: number; ms: number }) {
  // the pieces worn change with the hour (ms); the picture is redrawn only when one does
  const { head, face, held } = builderOutfit(b, ms);
  const { canvas, overlay, crop } = useMemo(() => {
    const c = drawPet(b.look.line, b.look.stage, { expression: "happy", lit: b.mind.kind === "cpu" });
    const o = wearOverlay(
      c,
      b.look.line,
      b.look.stage,
      { ...(head ? { head } : {}), ...(face ? { face } : {}), ...(held ? { held } : {}) },
      0,
    );
    const box = boundingBox(c);
    const xs = [box.x, box.x + box.w - 1, ...o.map((p) => p[0])];
    const ys = [box.y, box.y + box.h - 1, ...o.map((p) => p[1])];
    const x0 = Math.max(0, Math.min(...xs) - 1);
    const y0 = Math.max(0, Math.min(...ys) - 1);
    return {
      canvas: c,
      overlay: o,
      crop: { x: x0, y: y0, w: Math.min(c.w, Math.max(...xs) + 2) - x0, h: Math.min(c.h, Math.max(...ys) + 2) - y0 },
    };
  }, [b, head, face, held]);
  return (
    <Sprite
      canvas={canvas}
      palette={PALETTES[b.look.palette]}
      scale={scale}
      overlay={overlay}
      crop={crop}
      label={b.name.en}
    />
  );
}
