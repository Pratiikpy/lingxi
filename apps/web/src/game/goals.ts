/**
 * Community goals in the game (plan 4.10). The standing of every goal comes from our server, which reads it from
 * X Layer (services/api/src/goals.ts); this module fetches it for the wallets that own this device's pets, takes
 * the rewards into the saved world, and says when a tier this player can take has been reached. The DeWEB build
 * has no server, so there the goals say where to see them instead.
 */

import { create } from "zustand";
import {
  GOALS,
  GOAL_BY_ID,
  type GoalStanding,
  type Reward,
  type TierPct,
  claimGoalEveryone,
  claimGoalTiers,
  claimableTiers,
  canClaimEveryone,
} from "@lingxi/world";
import { deviceWallets, useChain } from "./chain";
import { play } from "./sound";
import { useQuestUi } from "./questUi";
import { useWorld } from "./world";
import { goalsQuery, withQuery } from "./requests";
import { API_BASE } from "./apiBase";

const BASE = API_BASE;

export interface GoalReport {
  id: string;
  state: "upcoming" | "open" | "complete" | "ended";
  total: number;
  tiers: TierPct[];
  contributors: number;
  top: Array<{ wallet: string; n: number; share: number }>;
  mine: number;
}

interface GoalsState {
  status: "idle" | "loading" | "ready" | "offline" | "error";
  reports: Record<string, GoalReport>;
  /** the block the server has read the chain to, and the server's clock (unix seconds) when it answered */
  indexedTo: number;
  now: number;
  wallets: string[];
  refresh: () => Promise<void>;
}

/** The goal ids last seen with something to take, so a toast is said once, not every minute. */
let waiting: Set<string> | null = null;

export const useGoals = create<GoalsState>((set, get) => ({
  status: BASE ? "idle" : "offline",
  reports: {},
  indexedTo: 0,
  now: 0,
  wallets: [],
  refresh: async () => {
    if (!BASE) return set({ status: "offline" });
    const wallets = deviceWallets();
    if (get().status !== "ready") set({ status: "loading" });
    try {
      const res = await fetch(`${BASE}${withQuery("/api/goals", goalsQuery(wallets))}`);
      const body = (await res.json()) as { ok: boolean; now: number; indexedTo: number; goals: GoalReport[] };
      if (!body.ok) throw new Error("goals");
      set({
        status: "ready",
        reports: Object.fromEntries(body.goals.map((g) => [g.id, g])),
        indexedTo: body.indexedTo,
        now: body.now,
        wallets,
      });
      announce();
    } catch {
      set({ status: get().status === "ready" ? "ready" : "error" });
    }
  },
}));

export const standingOf = (id: string): GoalStanding => {
  const r = useGoals.getState().reports[id];
  return { total: r?.total ?? 0, mine: r?.mine ?? 0 };
};

/** Complete goals, for the GOAL_DONE condition: from the reports given, or the store's. */
export const goalsDone = (reports = useGoals.getState().reports): string[] =>
  GOALS.filter((g) => (reports[g.id]?.total ?? 0) >= g.target).map((g) => g.id);

/** Anything this world can take from a goal now: its tiers, or the reward for everyone. */
export function waitingIn(id: string): { tiers: TierPct[]; everyone: boolean } {
  const g = GOAL_BY_ID[id];
  if (!g || useGoals.getState().status !== "ready") return { tiers: [], everyone: false };
  const w = useWorld.getState().world;
  const s = standingOf(id);
  return { tiers: claimableTiers(w, g, s), everyone: canClaimEveryone(w, g, s) };
}

/** A toast the first time something can be taken from a goal (not on the first look after loading). */
function announce(): void {
  const now = new Set(
    GOALS.filter((g) => {
      const x = waitingIn(g.id);
      return x.tiers.length > 0 || x.everyone;
    }).map((g) => g.id),
  );
  if (waiting) for (const id of now) if (!waiting.has(id)) useQuestUi.getState().push({ quest: id, kind: "goal" });
  waiting = now;
}

/** Take every tier waiting in a goal; returns what came, or null. */
export function takeGoalTiers(id: string): { tiers: TierPct[]; rewards: Reward[] } | null {
  const g = GOAL_BY_ID[id];
  if (!g) return null;
  const r = claimGoalTiers(useWorld.getState().world, g, standingOf(id));
  if (!r.ok) return null;
  useWorld.getState().setWorld(r.world);
  play("success");
  return { tiers: r.tiers, rewards: r.rewards };
}

export function takeGoalEveryone(id: string): readonly Reward[] | null {
  const g = GOAL_BY_ID[id];
  if (!g) return null;
  const r = claimGoalEveryone(useWorld.getState().world, g, standingOf(id));
  if (!r.ok) return null;
  useWorld.getState().setWorld(r.world);
  play("sparkle");
  return r.rewards;
}

if (typeof window !== "undefined" && BASE) {
  // once at start, every two minutes while the game is open, and when a pet is kept on chain (a new wallet)
  setTimeout(() => void useGoals.getState().refresh(), 3_000);
  setInterval(() => void useGoals.getState().refresh(), 120_000);
  let owner = useChain.getState().record?.owner;
  useChain.subscribe((s) => {
    if (s.record?.owner !== owner) {
      owner = s.record?.owner;
      void useGoals.getState().refresh();
    }
  });
}
