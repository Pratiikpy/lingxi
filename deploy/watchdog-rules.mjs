/**
 * What the watchdog does on each beat, kept apart from the loop so it can be tested. Two readings a beat: the
 * server's health asked here on the PC, and the site's health asked from outside through the tunnel. A server that
 * stops answering even here is hung (pm2 restarts a crash, not a hang); a server that answers here while the site does
 * not answer outside means the tunnel has gone stale, as it once did after two days. Either is acted on only after
 * FAILS_TO_ACT beats in a row, and nothing is done again for QUIET_MS after acting, so a slow start is not restarted
 * over and over.
 */

/** Missed beats in a row before acting. */
export const FAILS_TO_ACT = 3;
/** After acting, the time to leave things alone. */
export const QUIET_MS = 5 * 60_000;

/** @returns {{ localFails: number; publicFails: number; quietUntil: number }} */
export const initialWatch = () => ({ localFails: 0, publicFails: 0, quietUntil: 0 });

/**
 * @param {{ localFails: number; publicFails: number; quietUntil: number }} w
 * @param {{ local: boolean; public: boolean }} beat
 * @param {number} now
 * @returns {{ watch: { localFails: number; publicFails: number; quietUntil: number }; action: "restart-server" | "restart-tunnel" | null }}
 */
export function decide(w, beat, now) {
  const localFails = beat.local ? 0 : w.localFails + 1;
  const publicFails = beat.public ? 0 : w.publicFails + 1;
  const next = { localFails, publicFails, quietUntil: w.quietUntil };
  if (now < w.quietUntil) return { watch: next, action: null };
  const acted = { localFails: 0, publicFails: 0, quietUntil: now + QUIET_MS };
  if (localFails >= FAILS_TO_ACT) return { watch: acted, action: "restart-server" };
  if (beat.local && publicFails >= FAILS_TO_ACT) return { watch: acted, action: "restart-tunnel" };
  return { watch: next, action: null };
}
