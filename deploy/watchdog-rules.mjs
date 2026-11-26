/**
 * What the watchdog does on each beat, kept apart from the loop so it can be tested. Two readings a beat: the
 * server's health asked here on the PC, and the site's health asked from outside through the tunnel. A server that
 * stops answering even here is hung (pm2 restarts a crash, not a hang); a server that answers here while the site does
 * not answer outside means the tunnel has gone stale, as it once did after two days. Either is acted on only after
 * FAILS_TO_ACT beats in a row, and nothing is done again for QUIET_MS after acting, so a slow start is not restarted
 * over and over.
 *
 * P3b: a server that answers here, only too slowly (the beat times out), is alive: on a machine short of memory it was
 * slow for minutes, and the restart it got took about four minutes to listen. So a streak of beats that are all slow is
 * acted on only after SLOW_FAILS_TO_ACT; any refusal or bad answer in the streak brings back FAILS_TO_ACT.
 */

/** Missed beats in a row before acting. */
export const FAILS_TO_ACT = 3;
/** Missed beats in a row before acting, when every one of them was the server here answering too slowly. */
export const SLOW_FAILS_TO_ACT = 6;
/** After acting, the time to leave things alone. */
export const QUIET_MS = 5 * 60_000;

/** @returns {{ localFails: number; localSlowOnly: boolean; publicFails: number; quietUntil: number }} */
export const initialWatch = () => ({ localFails: 0, localSlowOnly: true, publicFails: 0, quietUntil: 0 });

/**
 * @param {{ localFails: number; localSlowOnly?: boolean; publicFails: number; quietUntil: number }} w
 * @param {{ local: boolean | "slow"; public: boolean }} beat  `local` is "slow" when the server here timed out
 * @param {number} now
 * @returns {{ watch: { localFails: number; localSlowOnly: boolean; publicFails: number; quietUntil: number }; action: "restart-server" | "restart-tunnel" | null }}
 */
export function decide(w, beat, now) {
  const localOk = beat.local === true;
  const localFails = localOk ? 0 : w.localFails + 1;
  // whether every missed beat of the current streak was only slow
  const localSlowOnly = localOk
    ? true
    : (w.localFails === 0 ? true : (w.localSlowOnly ?? true)) && beat.local === "slow";
  const publicFails = beat.public ? 0 : w.publicFails + 1;
  const next = { localFails, localSlowOnly, publicFails, quietUntil: w.quietUntil };
  if (now < w.quietUntil) return { watch: next, action: null };
  const acted = { localFails: 0, localSlowOnly: true, publicFails: 0, quietUntil: now + QUIET_MS };
  if (localFails >= (localSlowOnly ? SLOW_FAILS_TO_ACT : FAILS_TO_ACT))
    return { watch: acted, action: "restart-server" };
  if (localOk && publicFails >= FAILS_TO_ACT) return { watch: acted, action: "restart-tunnel" };
  return { watch: next, action: null };
}

/**
 * A beat in one line for the log: what the server here and the site outside each answered ("ok", "refused",
 * "timed out", or the HTTP status).
 * @param {{ local: string; public: string }} why
 */
/**
 * R17: the watchdog's last action, read back from the status it last wrote. The watchdog is itself restarted with every
 * release of its code and every reboot, and it began each time with "no action yet", so the health report lost the
 * one line that says the server was restarted and why. A status that is missing or not ours gives the empty answer.
 */
export function lastFrom(statusText) {
  const none = { action: null, at: null, result: null };
  try {
    const last = JSON.parse(statusText)?.last;
    if (!last || typeof last !== "object") return none;
    const text = (v) => (typeof v === "string" ? v.slice(0, 200) : null);
    const action = last.action === "restart-server" || last.action === "restart-tunnel" ? last.action : null;
    return action ? { action, at: text(last.at), result: text(last.result) } : none;
  } catch {
    return none;
  }
}

export const describeBeat = (why) => `here ${why.local}, outside ${why.public}`;
