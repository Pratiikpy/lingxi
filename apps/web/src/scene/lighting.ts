/**
 * The room's light (P7: out of RoomScene): a warm pool around the pet at dusk and night that breathes a little, soft
 * corners always (deeper at night), and lights out while the pet sleeps: a deep veil over the room and the pet, under
 * the Zzz and the fireflies.
 */
import { type Container, Sprite, Texture } from "pixi.js";
import type { DayPhase } from "./dayPhase";
import { PET_FEET, ROOM } from "./floor";
import { glowTexture, vignetteTexture } from "./textures";

/** How deep the room goes while the pet sleeps (0 bright, 1 black): dim enough to read as lights out, the pet still seen. */
const LIGHTS_OUT = 0.42;

export interface Lighting {
  update: (
    now: number,
    p: { phase: DayPhase; reduceMotion: boolean; asleep: boolean; absent?: boolean },
    PET_X: number,
  ) => void;
}

/** `under`: the floor layer, which the light pool sits beneath; `below`: the effects layer, which the veil sits beneath. */
export function createLighting(world: Container, { under, below }: { under: Container; below: Container }): Lighting {
  // B7: lights out while the pet sleeps: a deep veil over the room and the pet, under the Zzz and the fireflies
  const lightsOut = new Sprite(Texture.WHITE);
  lightsOut.eventMode = "none";
  lightsOut.tint = 0x120d26;
  lightsOut.width = ROOM;
  lightsOut.height = ROOM;
  lightsOut.alpha = 0;
  world.addChildAt(lightsOut, world.getChildIndex(below));
  const glow = new Sprite(glowTexture());
  // light only: it must never catch a tap meant for the pet, the cat or a visitor
  glow.eventMode = "none";
  glow.anchor.set(0.5);
  glow.blendMode = "add";
  glow.alpha = 0;
  world.addChildAt(glow, world.getChildIndex(under));
  const vignette = new Sprite(vignetteTexture());
  vignette.eventMode = "none";
  vignette.width = ROOM;
  vignette.height = ROOM;
  world.addChild(vignette);
  const update: Lighting["update"] = (now, p, PET_X) => {
    // the light breathes a little; it is warm and gold in the evening, cool and low at night
    const lightAlpha = p.phase === "night" ? 0.22 : p.phase === "evening" ? 0.18 : 0;
    glow.alpha += (lightAlpha * (p.reduceMotion ? 1 : 0.92 + 0.08 * Math.sin(now / 900)) - glow.alpha) * 0.08;
    glow.tint = p.phase === "night" ? 0xffb85c : 0xffa45a;
    glow.x = PET_X;
    glow.y = PET_FEET - 14;
    glow.width = glow.height = 80;
    vignette.alpha = p.phase === "night" ? 0.42 : p.phase === "evening" ? 0.3 : 0.16;
    const dark = p.asleep && !p.absent ? LIGHTS_OUT : 0;
    lightsOut.alpha = p.reduceMotion ? dark : lightsOut.alpha + (dark - lightsOut.alpha) * 0.06;
  };
  return { update };
}
