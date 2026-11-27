/**
 * What a community goal counts and how it says so (plan 4.10), in a module of its own: plain data and text, with no
 * game code under it, so the live numbers page shows a goal without loading the world it pays rewards into (R43).
 * goals.ts re-exports every name here, so its readers are unchanged.
 */

import type { Text } from "./story";

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
export function goalAmountText(g: { readonly metric: GoalMetric }, n: number): string {
  if (g.metric !== "burned") return n.toLocaleString("en");
  const bem = n / 1e8;
  return bem.toLocaleString("en", { maximumFractionDigits: bem < 1 ? 4 : 2 });
}
