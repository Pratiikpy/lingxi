/**
 * Day, evening or night, from the game's clock: the one reading the room, the mini-games and anything else drawn in
 * the world share (P6: the catch game showed the room's day picture at night).
 */
import { timeOfDay } from "@lingxi/brain";
import { now } from "../game/gameClock";

export type DayPhase = "day" | "evening" | "night";

/** The phase at `hour` (0-23): the brain's time-of-day bucket 0 is night, 3 evening, the rest day. */
export function phaseAt(hour: number): DayPhase {
  const t = timeOfDay(hour);
  return t === 0 ? "night" : t === 3 ? "evening" : "day";
}

/** The phase now, by the game's clock. */
export const phaseNow = (): DayPhase => phaseAt(new Date(now()).getHours());
