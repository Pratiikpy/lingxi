/**
 * The player's badge ledger: lifetime care across every pet, kept apart from any one
 * pet so it carries on when a new egg hatches. Newly earned tiers queue a little
 * celebration.
 */

import { create } from "zustand";
import { type Badge, type Ledger, type Metric, newTiers, record, visitRoom } from "@lingxi/game";
import { play } from "./sound";
import { saveWrite } from "./saveRuntime";

const KEY = "lingxi.badges.v1";

function load(): Ledger {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Ledger) : {};
  } catch {
    return {};
  }
}

interface BadgeState {
  ledger: Ledger;
  /** tiers just earned, shown one at a time */
  fresh: Array<{ id: number; badge: Badge; tier: 1 | 2 | 3 }>;
  note: (metric: Metric, amount?: number) => void;
  visit: (room: number) => void;
  dismiss: (id: number) => void;
}

let n = 0;

export const useBadges = create<BadgeState>((set, get) => {
  const apply = (next: Ledger) => {
    const before = get().ledger;
    if (next === before) return;
    try {
      saveWrite(KEY, JSON.stringify(next));
    } catch {
      // kept for this visit
    }
    const earned = newTiers(before, next).map((e) => ({ id: ++n, ...e }));
    if (earned.length) play("sparkle");
    set({ ledger: next, fresh: [...get().fresh, ...earned] });
  };
  return {
    ledger: load(),
    fresh: [],
    note: (metric, amount = 1) => apply(record(get().ledger, metric, amount)),
    visit: (room) => apply(visitRoom(get().ledger, room)),
    dismiss: (id) => set({ fresh: get().fresh.filter((f) => f.id !== id) }),
  };
});

/** Which care results count, and for which badge. */
export const CARE_METRIC: Partial<Record<string, Metric>> = {
  ate: "feed",
  played: "play",
  cleaned: "clean",
  petted: "petting",
  healed: "medicine",
};
