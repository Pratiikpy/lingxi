/**
 * Whether a pet can start a family, in words: kept apart from the family screens (play/Family.tsx) so that the game's
 * start-up, which asks this for the pet card, does not load those screens (P3).
 */
import { type Pet, BOND_LEVELS, BREED_COOLDOWN_DAYS, FAMILY_BOND_LEVEL, bondLevel, canBreed, dayOf, stageOf } from "@lingxi/game";
import { MAX_PETS, useGame } from "./store";
import { bondName } from "./friends";
import { now } from "./gameClock";

type Lang = "en" | "zh";
const today = (p: Pet) => dayOf(p, now());

/** Why this pet cannot start a family right now, or null if it can. */
export function familyBlock(pet: Pet, partnerStage: string, lang: Lang): string | null {
  // families belong to owners: a pet staying with a friend, or away at one, waits
  if (pet.sitting || pet.away) return lang === "zh" ? `${pet.name}正在朋友家做客，回家后才能养小宝宝。` : `${pet.name} is staying away from home; little ones wait until it is back with its owner.`;
  const r = canBreed(
    { stage: stageOf(pet, now()), generation: pet.family?.generation ?? 0, ...(pet.lastBredDay !== undefined ? { lastBredDay: pet.lastBredDay } : {}) },
    { stage: (["baby", "child", "teen", "adult", "elder"].includes(partnerStage) ? partnerStage : "baby") as "baby" },
    today(pet),
  );
  if (r.ok) {
    if (useGame.getState().pets.length >= MAX_PETS) return lang === "zh" ? `你已经有 ${MAX_PETS} 只宠物了。` : `You already look after ${MAX_PETS} pets.`;
    return null;
  }
  if (r.reason === "secondGeneration")
    return lang === "zh" ? `${pet.name}是两只宠物的孩子，它的心智已经由两颗心智织成，不能再养小宝宝了。` : `${pet.name} was born of two parents. Its mind is already two minds woven together, so it can't have little ones of its own.`;
  if (r.reason === "notAdult") return lang === "zh" ? "两只宠物都要长大成年，才能一起养小宝宝。" : "Both pets need to be grown up before they can raise a little one.";
  return lang === "zh" ? `上次之后要休息 ${BREED_COOLDOWN_DAYS} 天。` : `Pets rest ${BREED_COOLDOWN_DAYS} days after having a little one.`;
}

/** Why two pets are not yet close enough for a family, or null when they are best friends. */
export function bondBlock(pet: Pet, points: number, other: string, lang: Lang): string | null {
  const level = bondLevel(points);
  if (level >= FAMILY_BOND_LEVEL) return null;
  const need = BOND_LEVELS[FAMILY_BOND_LEVEL]! - points;
  return lang === "zh"
    ? `${pet.name}和${other}要先成为${bondName(FAMILY_BOND_LEVEL, "zh")}（现在是${bondName(level, "zh")}，还差 ${need} 点）。多在一起玩、送心、切磋吧。`
    : `${pet.name} and ${other} need to be ${bondName(FAMILY_BOND_LEVEL, "en").toLowerCase()} first (now ${bondName(level, "en").toLowerCase()}, ${need} to go). Spend time together, send hearts, spar.`;
}
