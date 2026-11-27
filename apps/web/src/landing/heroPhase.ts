/**
 * The time of day the landing's hero shows, kept apart from the scene (P3): the page reads it at once, while the scene
 * and its PIXI engine load after the first paint.
 */
import { timeOfDay } from "@lingxi/brain";

export type HeroPhase = "day" | "evening" | "night";

/** The three times of day, in the order the page offers them. */
export const PHASES: readonly HeroPhase[] = ["day", "evening", "night"];

/** The time of day at `hour` (0 to 23), by the brain's own hours. */
export function phaseAt(hour: number): HeroPhase {
  const t = timeOfDay(hour);
  return t === 0 ? "night" : t === 3 ? "evening" : "day";
}

export function phaseNow(): HeroPhase {
  return phaseAt(new Date().getHours());
}

/**
 * R53: the script the page drawn at build time runs before its first paint, marking the visitor's time of day among the
 * page's three choices (the build cannot know the hour, so it drew Day, and the page then flipped to Dusk or Night when
 * its code arrived). The hours are written in from phaseAt, so the script and the page's code agree on every hour.
 */
export function phaseScript(): string {
  const byHour = Array.from({ length: 24 }, (_, h) => PHASES.indexOf(phaseAt(h))).join("");
  return `(function(){var p=+"${byHour}".charAt(new Date().getHours()),b=document.querySelectorAll("#root .l-phase [role=radio]");for(var i=0;i<b.length;i++)b[i].setAttribute("aria-checked",String(i%${PHASES.length}===p))})()`;
}
