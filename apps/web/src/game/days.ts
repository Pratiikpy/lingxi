/**
 * A day, for the game, only ever moves forward (P1 S6): a day's allowance (shifts, daily care) is never handed out
 * again for a day earlier than the latest one already used, so turning a clock back cannot repeat a day's rewards.
 * Days are stored as `Date.toDateString()` text ("Wed Nov 18 2026"), which does not sort as text, so they are
 * compared by the moment each begins.
 */

const start = (day: string): number => {
  const t = Date.parse(day);
  return Number.isFinite(t) ? t : -Infinity;
};

/** The day to count as today: today, unless a later day was already used (the clock went back). */
export const dayAtLeast = (today: string, used: string | null | undefined): string => (used && start(used) > start(today) ? used : today);
