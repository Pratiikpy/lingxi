/**
 * Seasons of the world (G4): every four weeks the world turns to its next season, each with its own visitors and a
 * keepsake one of them brings. The cycle comes round again every sixteen weeks, so a season missed is never lost, and
 * nothing counts down: a season only changes who may wander by and what the welcome card mentions.
 */

export type WorldSeasonId = "blossom" | "lantern" | "harvest" | "frost";

export interface WorldSeason {
  id: WorldSeasonId;
  name: { en: string; zh: string };
  /** a line for the home screen while it lasts */
  air: { en: string; zh: string };
}

export const WORLD_SEASONS: readonly WorldSeason[] = [
  { id: "blossom", name: { en: "Blossom Weeks", zh: "花开时节" }, air: { en: "Petals drift past the window.", zh: "窗外飘过花瓣。" } },
  { id: "lantern", name: { en: "Lantern Weeks", zh: "灯笼时节" }, air: { en: "Paper lanterns glow along the lanes.", zh: "小巷里亮起了纸灯笼。" } },
  { id: "harvest", name: { en: "Harvest Weeks", zh: "丰收时节" }, air: { en: "The fields smell of apples and hay.", zh: "田野里有苹果和干草的味道。" } },
  { id: "frost", name: { en: "Frost Weeks", zh: "霜雪时节" }, air: { en: "A little frost sparkles on every step.", zh: "每级台阶上都闪着一点霜。" } },
];

/** Four weeks a season. The cycle began on Monday 16 November 2026 (UTC), with Blossom. */
export const SEASON_DAYS = 28;
export const SEASON_EPOCH = Date.UTC(2026, 10, 16);
const DAY_MS = 86_400_000;

const indexAt = (ms: number): number => Math.floor((ms - SEASON_EPOCH) / (SEASON_DAYS * DAY_MS));

/** The world's season at a moment. */
export function worldSeasonAt(ms: number): WorldSeason {
  const i = indexAt(ms);
  return WORLD_SEASONS[((i % WORLD_SEASONS.length) + WORLD_SEASONS.length) % WORLD_SEASONS.length]!;
}

/** When the season after the one at `ms` begins, and which it is. */
export function nextWorldSeason(ms: number): { season: WorldSeason; at: number } {
  const at = SEASON_EPOCH + (indexAt(ms) + 1) * SEASON_DAYS * DAY_MS;
  return { season: worldSeasonAt(at), at };
}
