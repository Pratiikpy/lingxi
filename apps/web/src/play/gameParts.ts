/**
 * The full game's code, loaded once (P3): the game screen, its crash guard and the game store. The entry loads it at once
 * for a returning player; a first visit's hatch screen (FirstVisit.tsx) loads it behind the screen the player is using.
 */
import type { ComponentType, ReactNode } from "react";
import type { useGame } from "../game/store";

export interface GameParts {
  PlayApp: ComponentType;
  CrashGuard: ComponentType<{ children: ReactNode }>;
  useGame: typeof useGame;
}

let loading: Promise<GameParts> | null = null;

export function loadGame(): Promise<GameParts> {
  loading ??= Promise.all([import("./PlayApp"), import("./Crash"), import("../game/store")]).then(([app, crash, store]) => ({
    PlayApp: app.PlayApp,
    CrashGuard: crash.CrashGuard,
    useGame: store.useGame,
  }));
  // a failed load is not remembered, so a later attempt (the player's next tap) asks again
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/**
 * Whether this visit is a first one the standalone hatch screen can serve: no pet saved on this device, no link that
 * brings something (a gift, a packet, a duel, a sitting, a shortcut, a return from the handheld: every one of them is
 * read from the address), and not inside Telegram, whose launch carries its own start data. Anything else starts the full
 * game at once, as before.
 */
export function isFirstVisit(storage: Pick<Storage, "getItem"> | null, address: Pick<Location, "search" | "hash">, telegram: boolean): boolean {
  if (telegram || address.search || address.hash || !storage) return false;
  try {
    if (storage.getItem("lingxi.pet.v1")) return false;
    const roster = JSON.parse(storage.getItem("lingxi.pets.v2") ?? "null") as { pets?: unknown[] } | null;
    return !(Array.isArray(roster?.pets) && roster.pets.length > 0);
  } catch {
    // a save that cannot be read is the full game's to deal with (its recovery screen)
    return false;
  }
}
