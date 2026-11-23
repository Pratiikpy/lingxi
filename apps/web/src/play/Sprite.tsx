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
  // rendered at build time (P3: the prerendered hatch screen) there is no canvas to draw on: the same pixels as an SVG
  if (typeof window === "undefined") return <SpriteSvg canvas={canvas} palette={palette} scale={scale} c={c} label={label} overlay={overlay} />;
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

/** The sprite as an SVG of its pixels, each row's runs of one colour as one rectangle: for pages rendered at build time. */
function SpriteSvg({ canvas, palette, scale, c, label, overlay }: { canvas: PixelCanvas; palette: Palette; scale: number; c: { x: number; y: number; w: number; h: number }; label?: string | undefined; overlay?: readonly OverlayPixel[] | undefined }) {
  const rgba = toRgba(canvas, palette, 1);
  if (overlay?.length) paintOverlay(rgba, canvas.w, overlay);
  const rects: Array<{ x: number; y: number; w: number; fill: string }> = [];
  for (let y = 0; y < c.h; y++) {
    let run: { x: number; fill: string } | null = null;
    for (let x = 0; x <= c.w; x++) {
      const i = ((c.y + y) * canvas.w + (c.x + x)) * 4;
      const fill = x < c.w && rgba[i + 3]! > 0 ? `rgba(${rgba[i]},${rgba[i + 1]},${rgba[i + 2]},${(rgba[i + 3]! / 255).toFixed(3)})` : null;
      if (run && fill !== run.fill) {
        rects.push({ x: run.x, y, w: x - run.x, fill: run.fill });
        run = null;
      }
      if (fill && !run) run = { x, fill };
    }
  }
  return (
    <svg className="pixel" width={c.w * scale} height={c.h * scale} viewBox={`0 0 ${c.w} ${c.h}`} shapeRendering="crispEdges" style={{ display: "block" }} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {rects.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  );
}
