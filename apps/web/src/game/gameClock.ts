/**
 * The game's one clock, as the pages use it (clock.ts holds the rules). Everything the game times (a pet's beats, a
 * day's rewards, a shift's pay, a sitting's end) reads `now()`, never the device clock directly. The time it trusts is
 * the game server's; the on-chain copy, which has no server, takes the time of X Layer's latest block instead.
 */

import { createClock } from "./clock";
import { keepInTime, savedClock, serverTime } from "./clockSources";
import { saveWrite } from "./saveRuntime";

export const clock = createClock({
  wall: () => Date.now(),
  mono: () => performance.now(),
  storage: savedClock,
  write: (k, v) => void saveWrite(k, v),
  serverTime,
});

/** The game's time now, in milliseconds since the epoch. */
export const now = (): number => clock.now();

/**
 * Asks the server for the time now, again every half hour and whenever the page comes back into view. Resolves once
 * the first answer is in, or after a moment without one: the game never waits long.
 */
export const startClock = keepInTime(clock);
