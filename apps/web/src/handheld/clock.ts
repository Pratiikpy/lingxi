/**
 * The browser handheld's clock (A6). It lives by the game's time, never the device's: a trip's log is checked against
 * the game's clock when the pet comes home, and a phone whose own clock runs fast would otherwise write a log that
 * ends in the future. It starts from the clock state the game saved and asks the same server; it writes nothing.
 */

import { BEAT_MS } from "@lingxi/game";
import { createClock } from "../game/clock";
import { keepInTime, savedClock, serverTime } from "../game/clockSources";

export const handheldClock = createClock({
  wall: () => Date.now(),
  mono: () => performance.now(),
  storage: savedClock,
  write: () => undefined,
  serverTime,
});

/** Starts the handheld's clock; resolves once the server has answered, or after a moment without an answer. */
export const startHandheldClock = keepInTime(handheldClock);

/** The minute the handheld lives up to, by the game's time. */
export const wallBeat = (): number => Math.floor(handheldClock.now() / BEAT_MS);
