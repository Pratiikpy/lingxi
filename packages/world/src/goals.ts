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

/**
 * What a goal counts, each from X Layer events. Only what a real player does counts: a save is one pet's day (a day
 * saved twice counts once), a new pet counts once it has been saved on SETTLED_DAYS different days (a pet hatched
 * and left does not), a child and a burn each cost BEM that is burned. No wallet counts for more than a fifth of a
 * goal (walletCap), so no one finishes a goal alone, however many pets they make.
 */
export type GoalMetric =
  /** PetRegistry Checkpoint: a day of a pet's life saved, each pet-day once, credited to the pet's owner at that block */
  | "saves"
  /** PetRegistry Hatched, counted when the pet is settled (its SETTLED_DAYS-th day saved), for the wallet it was hatched for */
  | "hatched"
  /** PetRegistry Bred: a child born (the breeder burns BEM for it), credited to the child's owner */
  | "children"
  /** Burned on Lingxi's BEM contracts: BEM sent to the dead address, in base units, credited to the payer */
  | "burned";

export const GOAL_METRICS: readonly GoalMetric[] = ["saves", "hatched", "children", "burned"];

/** A new pet counts towards a goal once it has been saved on this many different days. */
export const SETTLED_DAYS = 3;

/**
 * A wallet's saves count for at most this many pets a day (UTC, by block time): the most pets a player keeps (the
 * game's roster). Hatching is free, so without it one wallet's saves would grow with every pet it hatched (A64).
 */
export const SAVES_PER_WALLET_DAY = 8;

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

/** How each metric is counted, said plainly (the game's goal card and the numbers page say the same). */
export const GOAL_METHOD: Readonly<Record<GoalMetric, Text>> = {
  saves: {
    en: `Counts each day of a pet's life saved on X Layer (PetRegistry's Checkpoint, each day once), for the pet's owner, at most ${SAVES_PER_WALLET_DAY} a day for one wallet (the most pets a player keeps). One wallet counts for at most a fifth of the goal.`,
    zh: `统计 X Layer 上保存的宠物的每一天（PetRegistry 的 Checkpoint，同一天只算一次），算在宠物主人名下，一个钱包一天最多算 ${SAVES_PER_WALLET_DAY} 次（一个玩家最多养的宠物数）。一个钱包最多算目标的五分之一。`,
  },
  hatched: {
    en: `Counts each new pet on X Layer, children included, once it has been saved on ${SETTLED_DAYS} different days (PetRegistry's Hatched and Checkpoint), for the wallet it was hatched for. One wallet counts for at most a fifth of the goal.`,
    zh: `统计 X Layer 上的每一只新宠物（包括孩子），在它保存满 ${SETTLED_DAYS} 个不同的日子后才算（PetRegistry 的 Hatched 和 Checkpoint），算在它所属的钱包名下。一个钱包最多算目标的五分之一。`,
  },
  children: {
    en: "Counts every child born on X Layer (PetRegistry's Bred; the birth burns BEM), for the child's owner. One wallet counts for at most a fifth of the goal.",
    zh: "统计 X Layer 上出生的每一个孩子（PetRegistry 的 Bred；出生会烧掉 BEM），算在孩子主人名下。一个钱包最多算目标的五分之一。",
  },
  burned: {
    en: "Counts the BEM burned on Lingxi's contracts (the Burned events), for the wallet that paid. One wallet counts for at most a fifth of the goal.",
    zh: "统计在灵犀的合约上烧掉的 BEM（Burned 事件），算在付款的钱包名下。一个钱包最多算目标的五分之一。",
  },
};

/** An amount in a goal's own unit: BEM is kept in base units (8 decimals) and shown in BEM. */
export function goalAmountText(g: Pick<GoalDef, "metric">, n: number): string {
  if (g.metric !== "burned") return n.toLocaleString("en");
  const bem = n / 1e8;
  return bem.toLocaleString("en", { maximumFractionDigits: bem < 1 ? 4 : 2 });
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
