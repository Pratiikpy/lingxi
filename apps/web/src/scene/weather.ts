/** The room's weather (D19: by the world's season, the one the home screen names). */
import { gameSeasonAt } from "@lingxi/game";

export type Weather = "clear" | "rain" | "snow" | "petals" | "leaves";

/** Today's weather: the same all day for everyone in the same world season, changing day to day. */
export function weatherFor(date: Date): Weather {
  const day = date.getFullYear() * 400 + date.getMonth() * 32 + date.getDate();
  let h = day * 2654435761;
  h = (h ^ (h >>> 15)) >>> 0;
  const r = (h % 1000) / 1000;
  // D19: the world's own season, the one the home screen names (Blossom Weeks spring, Lantern summer, Harvest autumn,
  // Frost winter), not the calendar's
  const season = gameSeasonAt(date.getTime());
  if (season === "winter") return r < 0.45 ? "snow" : "clear";
  if (season === "spring") return r < 0.4 ? "petals" : r < 0.6 ? "rain" : "clear";
  if (season === "autumn") return r < 0.4 ? "leaves" : r < 0.6 ? "rain" : "clear";
  return r < 0.25 ? "rain" : "clear";
}
