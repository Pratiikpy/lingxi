/**
 * What every part of the world store shares (P7: out of world.ts): the world saved on this device, the room a
 * happening is in, the ids of the notices, and the pet's energy and Explore skills that the world's numbers follow.
 */
import { happeningAt } from "@lingxi/world";
import { useBadges } from "./badges";
import { exert, exploreMods } from "@lingxi/game";
import { type WorldState, give as giveItem, newWorld, backfillTally, withFlag } from "@lingxi/world";
import { cleanWorld } from "./saveClean";
import { brainOf, useGame } from "./store";
import { saveWrite } from "./saveRuntime";
import { now } from "./gameClock";

export const KEY = "lingxi.world.v1";

export function load(): WorldState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const w = JSON.parse(raw) as WorldState;
      if (w.version === 1) {
        const clean = cleanWorld(w);
        // a save from before tools (plan 4.5) that already took the pebbles gets the screwdriver that quest now gives, once
        const screwdriver =
          clean.claimed.includes("q07") && !(clean.flags ?? []).includes("tools-given") && !(clean.bag[23102] ?? 0)
            ? withFlag(giveItem(clean, 23102, 1), "tools-given")
            : clean;
        // and one that already finished Praline's apprentice quest gets the burner it now gives (2026-11-18), once
        const tooled =
          screwdriver.claimed.includes("q22") &&
          !(screwdriver.flags ?? []).includes("burner-given") &&
          !(screwdriver.bag[23101] ?? 0)
            ? withFlag(giveItem(screwdriver, 23101, 1), "burner-given")
            : screwdriver;
        // an older save is counted into the tally once, from what it and the badge ledger already record
        const counted = backfillTally(tooled, useBadges.getState().ledger);
        if (counted !== clean) save(counted);
        return counted;
      }
    }
  } catch {
    // fall through to a new world
  }
  const seed = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  return newWorld(seed);
}

export function save(w: WorldState): void {
  try {
    saveWrite(KEY, JSON.stringify(w));
  } catch {
    // keeps working in memory
  }
}

/** D24: the room today's lucky happening is in (or -1 on another kind of day). */
export const happeningRoom = (w: import("@lingxi/world").WorldState): number => {
  const h = happeningAt(w, now());
  return h.kind === "lucky" ? h.room : -1;
};

let n = 0;
/** the next notice's id: every notice is new, so the screen shows it even when its words repeat */
export const nextId = () => ++n;
export const petEnergy = () => {
  const p = useGame.getState().pet;
  return p ? Math.floor(p.meters.energy / 60) : 0;
};
/** The world's numbers for the pet on screen: its Explore skills change them (plan 4.4). */
export const petMods = () => exploreMods(useGame.getState().pet?.growth);

export function tirePet(energy: number): void {
  const g = useGame.getState();
  const p = g.pet;
  if (!p) return;
  g.replace(exert(p, energy, now(), brainOf(p)));
}
