/**
 * The hero as a still (P3), for a device whose WebGL is software only (heroArt.hardwareWebGl): the same room, scale and
 * mirrored tiling as the living scene, with the pet resting where the scene first places it, drawn once on a plain
 * canvas, again on a resize or a change of the time of day. No PIXI, no animation and no per-frame work.
 */
import { useEffect, useRef } from "react";
import type { HeroPhase } from "./heroPhase";
import { drawPet, toRgba } from "@lingxi/art";
import { BG, GROUND, PET_AT, ROOM, heroScale, isNarrowBand } from "./heroArt";
import { PALETTE_OF } from "../scene/palette";

/** The pet's resting frame as a small canvas, in the scene's size for this width (heroArt.ts). */
function petCanvas(narrow: boolean): HTMLCanvasElement {
  const art = drawPet("gentle", narrow ? "child" : "adult", { expression: "neutral" });
  const out = document.createElement("canvas");
  out.width = art.w;
  out.height = art.h;
  const img = new ImageData(art.w, art.h);
  img.data.set(toRgba(art, PALETTE_OF.gentle, 1));
  out.getContext("2d")!.putImageData(img, 0, 0);
  return out;
}

export function HeroStill({ phase }: { phase: HeroPhase }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const canvas = document.createElement("canvas");
    canvas.className = "pixel";
    el.appendChild(canvas);
    const img = new Image();
    let loaded = false;
    const draw = () => {
      if (!loaded) return;
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      const scale = heroScale(h) * dpr;
      const size = ROOM * scale;
      const top = canvas.height - size;
      for (let i = 0; i * size < canvas.width; i++) {
        ctx.save();
        if (i % 2 === 1) {
          // every other copy mirrored, so the edges meet cleanly
          ctx.translate((i + 1) * size, top);
          ctx.scale(-1, 1);
        } else ctx.translate(i * size, top);
        ctx.drawImage(img, 0, 0, size, size);
        ctx.restore();
      }
      // the pet stands on the ground line, centred where the living scene starts it
      const pet = petCanvas(isNarrowBand(w));
      const px = heroScale(h) * dpr;
      const x = Math.round(Math.round((w / heroScale(h)) * PET_AT) * px - (pet.width * px) / 2);
      ctx.drawImage(pet, x, top + GROUND * px - pet.height * px, pet.width * px, pet.height * px);
    };
    img.onload = () => {
      loaded = true;
      draw();
    };
    img.src = BG[phase];
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => {
      ro.disconnect();
      img.onload = null;
      canvas.remove();
    };
  }, [phase]);
  return <div ref={host} className="hero-scene" aria-hidden="true" />;
}
