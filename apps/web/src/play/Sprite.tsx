/** A hand-drawn pixel sprite rendered into a small canvas at a whole-number scale. */

import { useEffect, useRef } from "react";
import { type OverlayPixel, type Palette, type PixelCanvas, paintOverlay, toRgba } from "@lingxi/art";

export function Sprite({ canvas, palette, scale, crop, label, overlay }: { canvas: PixelCanvas; palette: Palette; scale: number; crop?: { x: number; y: number; w: number; h: number }; label?: string; overlay?: readonly OverlayPixel[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const c = crop ?? { x: 0, y: 0, w: canvas.w, h: canvas.h };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = el.getContext("2d")!;
    const img = ctx.createImageData(canvas.w, canvas.h);
    const rgba = toRgba(canvas, palette, 1);
    if (overlay?.length) paintOverlay(rgba, canvas.w, overlay);
    img.data.set(rgba);
    const tmp = document.createElement("canvas");
    tmp.width = canvas.w;
    tmp.height = canvas.h;
    tmp.getContext("2d")!.putImageData(img, 0, 0);
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
  }, [canvas, palette, overlay, c.x, c.y, c.w, c.h]);
  return (
    <canvas
      ref={ref}
      width={c.w}
      height={c.h}
      className="pixel"
      style={{ width: c.w * scale, height: c.h * scale, display: "block" }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
