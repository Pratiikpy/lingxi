/**
 * P5: the pet in words, for a player who cannot see the room: its name, its stage, what its circuit has it doing now
 * and what it needs. The pet button carries it as its description; a quiet live region reads out a change.
 */
import type { Pet } from "@lingxi/game";
import { needsOf } from "../game/badge";
import { WANT_NAMES } from "./ruleText";

type Lang = "en" | "zh";
type Need = ReturnType<typeof needsOf>[number];

const NEED_WORDS: Record<Lang, Record<Need, string>> = {
  en: { food: "hungry", clean: "wants a bath", rest: "tired", joy: "bored", medicine: "unwell" },
  zh: { food: "饿了", clean: "想洗澡", rest: "累了", joy: "无聊", medicine: "不舒服" },
};

/** What the pet is doing now, in a few words. */
export function petDoing(pet: Pet, lang: Lang): string {
  if (pet.asleep) return lang === "zh" ? "在睡觉" : "asleep";
  const want = WANT_NAMES[lang][pet.last.want];
  if (!want) return lang === "zh" ? "在发呆" : "resting";
  return lang === "zh" ? `想${want}` : `wants to ${want}`;
}

/** The pet's needs, in words, or "" when it needs nothing. */
export function petNeeds(pet: Pet, lang: Lang): string {
  const words = needsOf(pet).map((n) => NEED_WORDS[lang][n]);
  return words.join(lang === "zh" ? "、" : ", ");
}

/** The pet in one sentence: "Pip, baby: wants to play. Hungry, tired." / "Pip，宝宝：想玩。饿了、累了。" */
export function petSpoken(pet: Pet, stageWord: string, lang: Lang): string {
  const needs = petNeeds(pet, lang);
  if (lang === "zh")
    return `${pet.name}，${stageWord}：${petDoing(pet, lang)}。${needs ? `${needs}。` : "什么都不缺。"}`;
  const tail = needs ? `${needs.charAt(0).toUpperCase()}${needs.slice(1)}.` : "Needs nothing.";
  return `${pet.name}, ${stageWord}: ${petDoing(pet, lang)}. ${tail}`;
}
