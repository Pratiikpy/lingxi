import { now } from "./gameClock";
/** "Good sport": a pat soon after losing a spar counts as comfort (quests count it). */

const WINDOW_MS = 10 * 60_000;
let lostAt = 0;

export const markLoss = (): void => {
  lostAt = now();
};

/** True once for a pat within ten minutes of a loss. */
export function takeComfort(): boolean {
  if (!lostAt || now() - lostAt > WINDOW_MS) return false;
  lostAt = 0;
  return true;
}
