/**
 * Community goals (plan 4.10). Everyone works towards one shared target; what counts is read from X Layer, never
 * from a browser, so the total is the same for every player and anyone can recount it.
 *
 * Kept from the source's goals: one objective per goal, the total stops at the target, tiers that stack (reaching
 * 75% pays 25, 50 and 75), a reward for everyone once the goal is complete, and a leaderboard with each player's
 * share. Changed where the source's goals went wrong: every goal has a start and a deadline, a goal that ends short
 * still pays the tiers it reached, a contribution of 0 never counts, and tier rewards are fixed amounts, not
 * multiplied by what a player gave (a ratio set for a small goal breaks a big one).
 */

import type { QuestLine, Reward, Text } from "./story";
import { payReward } from "./story";
import type { WorldResult, WorldState } from "./world";
import { type GoalMetric, SAVES_PER_WALLET_DAY } from "./goalText";

export {
  GOAL_METHOD,
  GOAL_METRICS,
  type GoalMetric,
  SAVES_PER_WALLET_DAY,
  SETTLED_DAYS,
  goalAmountText,
} from "./goalText";

/** One counted thing, as the server's ledger and the recount both keep it. */
export interface GoalCredit {
  m: GoalMetric;
  w: string;
  n: number;
  /** block time, seconds */
  t: number;
}

/**
 * What each wallet counts for in goal `g`: its credits in the goal's window, its saves at most SAVES_PER_WALLET_DAY a
 * day, and the whole at most walletCap(g). The server's ledger and the recount script both count with this.
 */
export function goalCounts(
  g: Pick<GoalDef, "metric" | "start" | "end" | "target">,
  credits: readonly GoalCredit[],
): Map<string, number> {
  const by = new Map<string, number>();
  const daily = new Map<string, number>();
  for (const c of credits) {
    if (c.m !== g.metric || c.t < g.start || c.t >= g.end) continue;
    let n = c.n;
    if (c.m === "saves") {
      const day = `${c.w} ${Math.floor(c.t / 86_400)}`;
      const so = daily.get(day) ?? 0;
      n = Math.max(0, Math.min(n, SAVES_PER_WALLET_DAY - so));
      daily.set(day, so + n);
    }
    if (n > 0) by.set(c.w, (by.get(c.w) ?? 0) + n);
  }
  // no wallet counts for more than its share, so no one finishes a goal alone
  for (const [w, n] of by) by.set(w, Math.min(n, walletCap(g)));
  return by;
}

/** The largest share of a goal's target one wallet's contributions count for. */
export const WALLET_SHARE = 0.2;

/** The most one wallet counts for in goal `g`, in the goal's units: a fifth of the target, at least 1. */
export function walletCap(g: Pick<GoalDef, "target">): number {
  return Math.max(1, Math.floor(g.target * WALLET_SHARE));
}

/** The share of the target at which each tier is reached. */
export const TIER_PCTS = [25, 50, 75, 100] as const;
export type TierPct = (typeof TIER_PCTS)[number];

export interface GoalDef {
  id: string;
  title: Text;
  /** the resident who asks for it, and what they say (their portraits, as in their talk) */
  giver: string;
  story: readonly QuestLine[];
  metric: GoalMetric;
  /** in the metric's units (base units of BEM for "burned") */
  target: number;
  /** how one unit reads, in both languages ("days saved") */
  unit: Text;
  /** the window, in unix seconds: events at or after start and before end count */
  start: number;
  end: number;
  /** one reward list per tier, paid to each world whose wallet gave at least once */
  tiers: Readonly<Record<TierPct, readonly Reward[]>>;
  /** once the goal is complete: something for every player, wallet or not */
  everyone: { text: Text; rewards: readonly Reward[] };
}

/** What the chain says about a goal, as the API reports it. */
export interface GoalStanding {
  /** everything counted in the window (it may pass the target; progress stops there) */
  total: number;
  /** what this player's wallets gave in the window */
  mine: number;
}

export type GoalState = "upcoming" | "open" | "complete" | "ended";

/** The amount at which a tier is reached: a share of the target, rounded up so 25% of 10 needs 3. */
export const tierAt = (g: GoalDef, pct: TierPct): number => Math.ceil((g.target * pct) / 100);

/** Progress towards the target, from 0 to 1; it stops at the target. */
export const goalProgress = (g: GoalDef, total: number): number => Math.min(1, Math.max(0, total) / g.target);

export function tiersReached(g: GoalDef, total: number): TierPct[] {
  return TIER_PCTS.filter((p) => total >= tierAt(g, p));
}

/** The next tier still to reach, or null when all four are. */
export function nextTier(g: GoalDef, total: number): TierPct | null {
  return TIER_PCTS.find((p) => total < tierAt(g, p)) ?? null;
}

export function goalState(g: GoalDef, total: number, nowSec: number): GoalState {
  if (total >= g.target) return "complete";
  if (nowSec < g.start) return "upcoming";
  return nowSec >= g.end ? "ended" : "open";
}

export interface GoalClaims {
  /** tiers already taken, per goal */
  tiers: Record<string, TierPct[]>;
  /** goals whose reward for everyone was taken */
  everyone: string[];
}

export const claimsOf = (w: WorldState): GoalClaims => w.goals ?? { tiers: {}, everyone: [] };

/** Tiers this world can take now: reached, not yet taken, and only for a player who gave at least once. */
export function claimableTiers(w: WorldState, g: GoalDef, s: GoalStanding): TierPct[] {
  if (!(s.mine > 0)) return [];
  const taken = claimsOf(w).tiers[g.id] ?? [];
  return tiersReached(g, s.total).filter((p) => !taken.includes(p));
}

export const canClaimEveryone = (w: WorldState, g: GoalDef, s: GoalStanding): boolean =>
  s.total >= g.target && !claimsOf(w).everyone.includes(g.id);

/** Take every tier waiting (they stack), paying each tier's rewards once. */
export function claimGoalTiers(
  w: WorldState,
  g: GoalDef,
  s: GoalStanding,
): WorldResult<{ tiers: TierPct[]; rewards: Reward[] }> {
  if (!(s.mine > 0)) return { ok: false, reason: "notContributed" };
  const tiers = claimableTiers(w, g, s);
  if (!tiers.length) return { ok: false, reason: tiersReached(g, s.total).length ? "claimed" : "noTier" };
  const c = claimsOf(w);
  let next: WorldState = { ...w, goals: { ...c, tiers: { ...c.tiers, [g.id]: [...(c.tiers[g.id] ?? []), ...tiers] } } };
  const rewards = tiers.flatMap((p) => g.tiers[p]);
  for (const r of rewards) next = payReward(next, r);
  return { ok: true, world: next, tiers, rewards };
}

/** Take the reward for everyone, once the goal is complete. */
export function claimGoalEveryone(
  w: WorldState,
  g: GoalDef,
  s: GoalStanding,
): WorldResult<{ rewards: readonly Reward[] }> {
  if (s.total < g.target) return { ok: false, reason: "notComplete" };
  const c = claimsOf(w);
  if (c.everyone.includes(g.id)) return { ok: false, reason: "claimed" };
  let next: WorldState = { ...w, goals: { ...c, everyone: [...c.everyone, g.id] } };
  for (const r of g.everyone.rewards) next = payReward(next, r);
  return { ok: true, world: next, rewards: g.everyone.rewards };
}

/** Ids of the goals that are complete, for the GOAL_DONE condition. */
export const goalsDoneOf = (goals: readonly GoalDef[], totals: Readonly<Record<string, number>>): string[] =>
  goals.filter((g) => (totals[g.id] ?? 0) >= g.target).map((g) => g.id);
