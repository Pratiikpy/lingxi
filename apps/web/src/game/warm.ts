/**
 * Code the game's start-up does not carry, fetched once the game is up (P3): the panels drawn on first use (play/Lazy.tsx)
 * and viem's client half (chainClient.ts) register here, and the play page starts the warm-up, so a tap or a first read
 * of X Layer later finds its code already here, even on a slow phone.
 */

const waiting: Array<() => Promise<unknown>> = [];

/** Adds code to fetch in the warm-up. */
export function warmLater(load: () => Promise<unknown>): void {
  waiting.push(load);
}

/** How long after the game is up its deferred code starts to arrive, unless the player touches the screen first. */
export const WARM_AFTER_MS = 6000;

/**
 * Fetches everything registered with warmLater, one at a time in idle moments, once the game has been up a while or the
 * player first touches it, so a tap or a first read of X Layer later finds its code here even on a slow phone. Returns a
 * stop function.
 */
export function warmDeferred(): () => void {
  let stopped = false;
  let started = false;
  const idle = (f: () => void) =>
    "requestIdleCallback" in window ? requestIdleCallback(() => f(), { timeout: 2000 }) : setTimeout(f, 50);
  const next = () => {
    if (stopped) return;
    const load = waiting.shift();
    if (load)
      load().then(
        () => idle(next),
        () => idle(next),
      );
  };
  const start = () => {
    if (started || stopped) return;
    started = true;
    window.removeEventListener("pointerdown", start);
    idle(next);
  };
  const timer = setTimeout(start, WARM_AFTER_MS);
  window.addEventListener("pointerdown", start, { once: true });
  return () => {
    stopped = true;
    clearTimeout(timer);
    window.removeEventListener("pointerdown", start);
  };
}
