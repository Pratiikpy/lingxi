/**
 * G6: no recipe or trust branch strictly worse than its alternative. Three checks, each a list of findings (empty means
 * met), read by the tests and by the balance simulator:
 *   - dominated: another everyday recipe (not one a trip or a friend teaches, which is meant to be the better way)
 *     makes the same thing from a subset of its inputs, no more of any per piece, with no tool it does not also need;
 *   - dearer than the shop: every input can be bought, and buying them costs at least the shop price of what it makes;
 *   - branch: a friend's recipe branch whose inputs cannot be had except as finds rarer than RARE_FIND (unless the
 *     branch hands them over), or whose bought inputs cost at least the friend's own shelf price.
 */
import { CROPS } from "./garden";
import { FRIENDS } from "./friends";
import { ITEM, RECIPES, ROOMS, TRAVEL_RECIPES, type Recipe } from "./world";

/** The rarest a find may be and still count as a way to get an input (one in two hundred looks in its best room). */
export const RARE_FIND = 0.005;

const ALL: readonly Recipe[] = [...RECIPES, ...TRAVEL_RECIPES];

/** The lowest coin price of an item in any shop, or null when no shop sells it. */
export function shopPrice(item: number): number | null {
  let best: number | null = null;
  for (const r of Object.values(ROOMS)) if ((r.shop ?? []).includes(item)) best = Math.min(best ?? Infinity, ITEM[item]?.price ?? Infinity);
  return best;
}

/** The best chance per look of finding an item, over every room. */
export function bestFindChance(item: number): number {
  let best = 0;
  for (const r of Object.values(ROOMS)) {
    const total = r.drops.reduce((s, d) => s + d.weight, 0);
    const d = r.drops.find((x) => x.item === item);
    if (d && total > 0) best = Math.max(best, d.weight / total);
  }
  return best;
}

/** Can a player get this item by buying it, growing it, finding it often enough, or extracting it from such a thing? */
export function obtainable(item: number, seen: ReadonlySet<number> = new Set()): boolean {
  if (seen.has(item)) return false;
  if (shopPrice(item) !== null) return true;
  if (CROPS.some((c) => c.yields === item && shopPrice(c.seed) !== null)) return true;
  if (bestFindChance(item) >= RARE_FIND) return true;
  const next = new Set([...seen, item]);
  return ALL.some((r) => r.out === item && r.outAmount >= 100 && r.ins.every((x) => obtainable(x.item, next)));
}

/** Coins to buy every input of one piece of a recipe's output, or null when some input is not sold. */
export function boughtCostPerPiece(r: Recipe): number | null {
  let total = 0;
  for (const x of r.ins) {
    const p = shopPrice(x.item);
    if (p === null) return null;
    total += p * x.amount;
  }
  return total / r.outAmount;
}

function dominates(a: Recipe, b: Recipe): boolean {
  if (a.index === b.index || a.out !== b.out) return false;
  if (a.tool !== undefined && a.tool !== b.tool) return false;
  if (a.room !== undefined && a.room !== b.room) return false;
  let strictly = false;
  for (const x of a.ins) {
    const y = b.ins.find((i) => i.item === x.item);
    if (!y) return false;
    const pa = x.amount / a.outAmount;
    const pb = y.amount / b.outAmount;
    if (pa > pb) return false;
    if (pa < pb) strictly = true;
  }
  return strictly || a.ins.length < b.ins.length;
}

export interface WorthFinding {
  recipe: number;
  why: string;
}

export function worthFindings(): WorthFinding[] {
  const out: WorthFinding[] = [];
  for (const b of ALL) {
    // a recipe a trip or a friend teaches may beat an everyday one: that is what choosing to learn it buys
    const better = RECIPES.find((a) => dominates(a, b));
    if (better) out.push({ recipe: b.index, why: `${b.name.en} is dominated by ${better.name.en}` });
    const cost = boughtCostPerPiece(b);
    const price = shopPrice(b.out);
    if (cost !== null && price !== null && cost >= price) out.push({ recipe: b.index, why: `${b.name.en} costs ${cost} a piece in bought inputs; the shop sells it for ${price}` });
  }
  for (const f of FRIENDS) {
    const steps = f.steps;
    for (const s of steps) {
      const u = s.unlock;
      if (u.kind !== "recipe") continue;
      const r = ALL.find((x) => x.index === u.index);
      if (!r) {
        out.push({ recipe: u.index, why: `${f.id}'s branch teaches a recipe that does not exist` });
        continue;
      }
      const given = new Set((u.rewards ?? []).flatMap((g) => (g.kind === "item" ? [g.item] : [])));
      for (const x of r.ins) {
        const viaGift = ALL.some((y) => y.out === x.item && y.ins.every((i) => given.has(i.item)));
        if (!obtainable(x.item) && !given.has(x.item) && !viaGift) out.push({ recipe: r.index, why: `${f.id}'s ${r.name.en} needs ${ITEM[x.item]?.name.en ?? x.item}, which cannot be had except as a rare find` });
      }
      const shelf = steps.map((t) => t.unlock).find((t) => t.kind === "shelf" && t.item === r.out);
      const cost = boughtCostPerPiece(r);
      if (shelf && shelf.kind === "shelf" && cost !== null && cost >= shelf.price) out.push({ recipe: r.index, why: `${f.id}'s ${r.name.en} costs ${cost} a piece in bought inputs against the shelf's ${shelf.price}` });
    }
  }
  return out;
}
