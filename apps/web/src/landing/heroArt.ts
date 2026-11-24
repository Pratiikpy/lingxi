/**
 * The hero's landscape, shared by the living scene (HeroScene.tsx, PIXI) and its still (HeroStill.tsx, a plain canvas):
 * one 128-pixel room per time of day, tiled across the band at a whole-number scale, every other copy mirrored.
 */
import type { HeroPhase } from "./heroPhase";

export const ROOM = 128;
/** The ground line in the room's own pixels, where the pet and the cat stand. */
export const GROUND = 121;
/** Where across the band the pet starts, as a share of its width. */
export const PET_AT = 0.68;

export const BG: Record<HeroPhase, string> = {
  day: "art/rooms/49_clearing/backgrounds/playtest-a.png",
  evening: "art/rooms/49_clearing/backgrounds/playtest-b.png",
  night: "art/rooms/49_clearing/backgrounds/playtest-c.png",
};

/** The whole-number scale that makes one room cover the band's height (never below 2). */
export const heroScale = (height: number): number => Math.max(2, Math.ceil(height / ROOM));

/** The names software WebGL renderers report: Chrome's SwiftShader, Mesa's llvmpipe and softpipe, Windows' Basic Render. */
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/**
 * Whether this device draws WebGL on its graphics chip. Where WebGL is software only (no GPU, a blocked driver, a
 * headless server), the animated scene turns every frame into a long task on the main thread, so the hero shows its
 * still instead (P3). Software is recognised two ways: the browser refuses a context that would carry a major
 * performance caveat, or the renderer it names is a known software one (Chrome's SwiftShader grants the context).
 */
export function hardwareWebGl(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ??
      canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true });
    if (!gl) return false;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return !SOFTWARE_RENDERER.test(renderer);
  } catch {
    return false;
  }
}
