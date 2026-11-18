/**
 * The game's clock (P1 S6): real time as nearly as this page can know it, so a device clock set wrong moves neither a
 * pet's day nor its rewards.
 *
 * - Whenever the game can reach its server, the device clock is corrected by the server's (`/api/time`, the round trip
 *   halved): the game's time is then real time, whatever the device says, and it comes back to real time the moment
 *   the server answers after the device clock was wrong (converging even after a clock that ran ahead).
 * - Within a visit, the browser's monotonic timer says how much time really passed. A device clock set back is cancelled
 *   at once. A jump forward could be the device clock set ahead or the device waking from sleep, so it is held while
 *   the server is asked: confirmed, it is real time; with no answer, it is accepted as sleep.
 * - Before the server has answered on a visit, the game never goes back past the last moment it saw: a device clock set
 *   back offline holds the game there, and time runs on from it.
 * - Small corrections backwards (the round trip's noise) are absorbed rather than run backwards.
 */

export const CLOCK_KEY = "lingxi.clock.v1";
/** A difference between device time and monotonic time larger than this is the device clock being changed. */
const JUMP_MS = 2_000;
/** A correction backwards this small is absorbed: the game's time waits instead of going back. */
const ABSORB_MS = 5_000;
/** A server answer slower than this says too little about the time to be used. */
const MAX_ROUND_TRIP_MS = 10_000;
/** How often the moment last seen is written down. */
const PERSIST_EVERY_MS = 60_000;

export interface ClockDeps {
  /** the device's clock (Date.now) */
  wall: () => number;
  /** the browser's monotonic timer (performance.now) */
  mono: () => number;
  storage: { getItem(k: string): string | null };
  /** writes the clock's state; the save module decides whether this tab may */
  write: (k: string, v: string) => void;
  /** the server's time in milliseconds, or a rejection when it cannot be reached */
  serverTime?: () => Promise<number>;
}

interface Saved {
  offset: number;
  seen: number;
}

export function createClock(d: ClockDeps) {
  let saved: Partial<Saved> = {};
  try {
    saved = (JSON.parse(d.storage.getItem(CLOCK_KEY) ?? "{}") as Partial<Saved>) ?? {};
  } catch {
    saved = {};
  }
  /** the correction added to the device clock */
  let offset = Number.isFinite(saved.offset) ? saved.offset! : 0;
  /** the latest moment the game has seen, kept across visits */
  let seen = Number.isFinite(saved.seen) ? saved.seen! : 0;
  /** whether the server has answered on this visit */
  let synced = false;
  /** a forward jump of the device clock waiting for the server to say whether it was real */
  let held = 0;
  let last = -Infinity;
  let anchorWall = d.wall();
  let anchorMono = d.mono();
  let persistedAt = 0;
  let asking: Promise<boolean> | null = null;

  const persist = (t: number) => {
    persistedAt = t;
    try {
      d.write(CLOCK_KEY, JSON.stringify({ offset, seen } satisfies Saved));
    } catch {
      // the clock still runs for this visit
    }
  };

  /** Asks the server for its time; true when the game's time now rests on it. */
  const sync = (): Promise<boolean> => {
    if (!d.serverTime) return Promise.resolve(false);
    asking ??= (async () => {
      const m0 = d.mono();
      try {
        const server = await d.serverTime!();
        const m1 = d.mono();
        if (!Number.isFinite(server) || m1 - m0 > MAX_ROUND_TRIP_MS) throw new Error("no usable answer");
        // the server's time at the moment its answer arrived, against the device's at that moment
        offset = server + (m1 - m0) / 2 - d.wall();
        held = 0;
        synced = true;
        anchorWall = d.wall();
        anchorMono = d.mono();
        seen = d.wall() + offset;
        persist(seen);
        return true;
      } catch {
        // no answer: a held jump was the device waking from sleep, not a clock set ahead
        if (held) {
          offset += held;
          held = 0;
        }
        return false;
      } finally {
        asking = null;
      }
    })();
    return asking;
  };

  /** The game's time now, in milliseconds since the epoch. */
  const now = (): number => {
    const wall = d.wall();
    const mono = d.mono();
    const drift = wall - (anchorWall + (mono - anchorMono));
    anchorWall = wall;
    anchorMono = mono;
    if (drift < -JUMP_MS) {
      // the device clock was set back during this visit: real time did not go back
      offset -= drift;
    } else if (drift > JUMP_MS) {
      // forward: set ahead, or the device slept. Hold it until the server says which.
      offset -= drift;
      held += drift;
      void sync();
    }
    let t = wall + offset;
    if (!synced && t < seen) {
      // before the server answers, never earlier than the last moment seen
      offset += seen - t;
      t = seen;
    }
    if (t < last && last - t <= ABSORB_MS) t = last;
    last = t;
    if (t > seen) seen = t;
    if (Math.abs(t - persistedAt) >= PERSIST_EVERY_MS) persist(t);
    return t;
  };

  return { now, sync, synced: () => synced };
}

export type Clock = ReturnType<typeof createClock>;
