/**
 * The time of day the landing's hero shows, kept apart from the scene (P3): the page reads it at once, while the scene
 * and its PIXI engine load after the first paint.
 */
import { timeOfDay } from "@lingxi/brain";

export type HeroPhase = "day" | "evening" | "night";

export function phaseNow(): HeroPhase {
  const t = timeOfDay(new Date().getHours());
  return t === 0 ? "night" : t === 3 ? "evening" : "day";
}
