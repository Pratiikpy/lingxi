/**
 * The team's further wallets (C2): kept in a file outside the repo (`data/team.json`, `{"wallets": ["0x…"]}`), so the
 * numbers page can count the team's activity apart without naming a wallet its owner has not chosen to name. A missing
 * or damaged file, or an entry that is not an address, counts nothing rather than stopping the server.
 */
import { readFileSync } from "node:fs";

export function readTeamFile(path: string): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  const wallets = (raw as { wallets?: unknown } | null)?.wallets;
  if (!Array.isArray(wallets)) return [];
  return [
    ...new Set(
      wallets
        .filter((w): w is string => typeof w === "string" && /^0x[0-9a-fA-F]{40}$/.test(w))
        .map((w) => w.toLowerCase()),
    ),
  ];
}
