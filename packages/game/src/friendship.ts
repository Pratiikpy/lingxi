/**
 * Pet friendships (PRD M7, after Tamagotchi Connection): pets that spend time
 * together, wave, send hearts, spar and stay over build a friendship level with
 * each other. Raising a little one together needs best friends.
 *
 * Points per day with one friend are capped, so a friendship grows over days of
 * play rather than a minute of tapping.
 */

export interface Bond {
  /** the friend's pet, as last seen */
  name: string;
  line: string;
  points: number;
  /** the day index points were last earned, and how many that day */
  day: number;
  today: number;
  /** ms of the first meeting and the last time together */
  first: number;
  last: number;
}
export type Bonds = Readonly<Record<string, Bond>>;

export type BondEvent = "together" | "wave" | "heart" | "spar" | "stay" | "gift";

/** What each moment is worth. "together" is ten minutes in the same room. */
export const BOND_POINTS: Readonly<Record<BondEvent, number>> = { together: 1, wave: 1, heart: 2, spar: 3, stay: 6, gift: 3 };
/** The most a friendship can grow in one day. */
export const BOND_DAILY_CAP = 12;
/** Points at which each level starts: met, friends, good friends, best friends, inseparable. */
export const BOND_LEVELS = [0, 10, 30, 60, 100] as const;
/** The level two pets need to raise a little one together. */
export const FAMILY_BOND_LEVEL = 3;

export const BOND_NAMES: ReadonlyArray<{ en: string; zh: string }> = [
  { en: "Just met", zh: "刚认识" },
  { en: "Friends", zh: "朋友" },
  { en: "Good friends", zh: "好朋友" },
  { en: "Best friends", zh: "最好的朋友" },
  { en: "Inseparable", zh: "形影不离" },
];

const DAY = 86_400_000;
const dayOfMs = (ms: number) => Math.floor(ms / DAY);

export function bondLevel(points: number): number {
  let level = 0;
  for (let i = 0; i < BOND_LEVELS.length; i++) if (points >= BOND_LEVELS[i]!) level = i;
  return level;
}

/** How far into the current level (0..1); 1 at the top level. */
export function bondProgress(points: number): number {
  const l = bondLevel(points);
  if (l >= BOND_LEVELS.length - 1) return 1;
  const lo = BOND_LEVELS[l]!;
  return (points - lo) / (BOND_LEVELS[l + 1]! - lo);
}

/** The friendships with this moment added; also says whether a new level was reached. */
export function addBond(bonds: Bonds, id: string, who: { name: string; line: string }, event: BondEvent, now: number): { bonds: Bonds; levelUp: number | null; gained: number } {
  if (!id) return { bonds, levelUp: null, gained: 0 };
  const day = dayOfMs(now);
  const old = bonds[id];
  const base: Bond = old ?? { name: who.name, line: who.line, points: 0, day, today: 0, first: now, last: now };
  const today = base.day === day ? base.today : 0;
  const gained = Math.max(0, Math.min(BOND_POINTS[event], BOND_DAILY_CAP - today));
  const next: Bond = { ...base, name: who.name || base.name, line: who.line || base.line, points: base.points + gained, day, today: today + gained, last: now };
  const before = bondLevel(base.points);
  const after = bondLevel(next.points);
  return { bonds: { ...bonds, [id]: next }, levelUp: after > before ? after : null, gained };
}

/** Whether these two pets are close enough to raise a little one together. */
export const canStartFamily = (bonds: Bonds, id: string): boolean => bondLevel(bonds[id]?.points ?? 0) >= FAMILY_BOND_LEVEL;

/** Friends, closest first. */
export const friendsByCloseness = (bonds: Bonds): Array<[string, Bond]> => Object.entries(bonds).sort((a, b) => b[1].points - a[1].points || b[1].last - a[1].last);
