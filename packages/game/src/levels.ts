/**
 * Levels and skills on the pet (plan 4.4): the moves the owner makes. The rules themselves are in skills.ts; here
 * they are applied to a pet, with its log segments kept right when a skill changes what its circuit holds.
 */

import { withSegment } from "./lessons";
import type { Pet } from "./sim";
import { type Growth, type UpgradeRefusal, levelUp, migrateGrowth, newGrowth, respec, ruleSkillIds, upgrade } from "./skills";

/** A pet from before levels were spent keeps the level it showed: its XP buys that level once, here. */
export function withGrowth(p: Pet): Pet {
  if (p.growth) return p;
  const m = migrateGrowth(p.xp);
  return { ...p, growth: m.growth, xp: m.xp };
}

export const growthOf = (p: Pet): Growth => p.growth ?? newGrowth();

/** Spend XP for a level and a skill point. */
export function levelUpPet(p0: Pet): { ok: true; pet: Pet; level: number } | { ok: false; reason: "xp" | "max" } {
  const p = withGrowth(p0);
  const r = levelUp(growthOf(p), p.xp);
  if (!r.ok) return r;
  return { ok: true, pet: { ...p, growth: r.growth, xp: r.xp }, level: r.growth.level };
}

/** Rule skills change what the circuit holds, so the log starts a new segment there (Rewind and the proof page replay it). */
function settle(before: Pet, after: Pet): Pet {
  const was = ruleSkillIds(before.growth).join(",");
  return ruleSkillIds(after.growth).join(",") === was ? after : withSegment(after);
}

export function learnSkill(p0: Pet, id: number): { ok: true; pet: Pet } | { ok: false; reason: UpgradeRefusal } {
  const p = withGrowth(p0);
  const r = upgrade(growthOf(p), id);
  if (!r.ok) return r;
  return { ok: true, pet: settle(p, { ...p, growth: r.growth }) };
}

/** The Fresh Start Tea: every point back. (The game takes the tea from the bag.) */
export function respecPet(p0: Pet): Pet {
  const p = withGrowth(p0);
  return settle(p, { ...p, growth: respec(growthOf(p)) });
}
