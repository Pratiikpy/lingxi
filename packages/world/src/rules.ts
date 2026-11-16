/**
 * The world's rules as circuits (plan 4.11). Each is taped out on Lingxi's processor; the game reads its answers
 * from the compiled circuit (`ruleFromCircuit`), and the page checks on start that every circuit it compiles is the
 * one stored on X Layer.
 */

import { type RuleCircuit, ruleFromCircuit } from "@lingxi/brain";
import { FOLK, type Folk, folkReference } from "./folk";

/* ── finds: rarity tier to weight, rare or not, and familiarity gained ──────────────────────────────────────────
 *   in  bits 0-3  rarity tier (1 rare … 15 common; 0 means no tier)
 *       bit  4    the room's kind matches the pet
 *   out bits 0-3  weight exponent (a find of tier t weighs 2^(t-1)); bit 4 has a weight; bit 5 rare (tiers 1-4)
 *       bits 6-7  familiarity a look around adds (2 where the pet is at home, else 1)
 */
export const DROP_RULE: RuleCircuit = {
  name: "drop",
  about: { en: "How much each rarity tier weighs in a find, which tiers are rare, and how much a look around makes a place familiar.", zh: "每个稀有度在寻找时的权重、哪些算稀有，以及四处找找让一个地方熟悉多少。" },
  inBits: 5,
  reference: (w) => {
    const tier = w & 15;
    const home = (w >> 4) & 1;
    const has = tier >= 1 ? 1 : 0;
    return (has ? tier - 1 : 0) | (has << 4) | ((tier >= 1 && tier <= 4 ? 1 : 0) << 5) | ((home ? 2 : 1) << 6);
  },
};

const drop = ruleFromCircuit(DROP_RULE);
const dropWord = (tier: number, home = false) => Math.max(0, Math.min(15, Math.floor(tier))) | (home ? 16 : 0);

/** The weight of a find of this tier, from the circuit: 2^(tier-1), and 0 without a tier. */
export const tierWeight = (tier: number): number => {
  const a = drop(dropWord(tier));
  return (a >> 4) & 1 ? 1 << (a & 15) : 0;
};
/** Rare tiers (1 to 4), the ones skills and full familiarity bars reach for. */
export const isRareTier = (tier: number): boolean => ((drop(dropWord(tier)) >> 5) & 1) === 1;
/** Familiarity a look around adds. */
export const familiarStep = (home: boolean): number => (drop(dropWord(1, home)) >> 6) & 3;

/* ── trust with a resident: its level, and what a gift adds ──────────────────────────────────────────────────────
 *   in  bits 0-6  trust points (127 and over read as 127)
 *       bits 7-8  the gift's taste (0 loved, 1 liked, 2 neutral, 3 disliked)
 *       bit  9    a gift already counted today
 *   out bits 0-2  level (0-5, from 0, 5, 15, 30, 50, 80 points); bits 3-5 points the gift adds; bit 6 refused
 */
export const TRUST_POINTS = [0, 5, 15, 30, 50, 80] as const;
const GIFT_POINTS = [4, 2, 1, 0] as const;

export const TRUST_RULE: RuleCircuit = {
  name: "trust",
  about: { en: "A resident's trust level from trust points, and how many points a gift adds (only the first gift of a day counts; a disliked one is refused).", zh: "由信任点数得出居民的信任等级，以及一份礼物加多少点（每天只算第一份；不喜欢的会被拒收）。" },
  inBits: 10,
  reference: (w) => {
    const points = w & 127;
    const taste = (w >> 7) & 3;
    const counted = (w >> 9) & 1;
    const level = TRUST_POINTS.reduce<number>((lvl, at, i) => (points >= at ? i : lvl), 0);
    const refused = taste === 3 ? 1 : 0;
    const gain = refused || counted ? 0 : GIFT_POINTS[taste]!;
    return level | (gain << 3) | (refused << 6);
  },
};

const trust = ruleFromCircuit(TRUST_RULE);
const TASTES = ["love", "like", "neutral", "dislike"] as const;
const trustWord = (points: number, taste: (typeof TASTES)[number] = "love", counted = false) =>
  Math.max(0, Math.min(127, Math.floor(points))) | (TASTES.indexOf(taste) << 7) | (counted ? 512 : 0);

/** Trust level 0-5, from the circuit. */
export const trustLevelOf = (points: number): number => trust(trustWord(points)) & 7;
/** What a gift of this taste adds now (0 when refused or not the first of the day), and whether it is refused. */
export function giftTrust(taste: (typeof TASTES)[number], countedToday: boolean): { points: number; refused: boolean } {
  const a = trust(trustWord(0, taste, countedToday));
  return { points: (a >> 3) & 7, refused: ((a >> 6) & 1) === 1 };
}

/* ── each resident's mood and line (see folk.ts for the inputs) ─────────────────────────────────────────────── */
export const folkRule = (f: Folk): RuleCircuit => ({
  name: `folk:${f.id}`,
  about: { en: "How this resident greets you: their mood and which line they choose, from the time, trust, today's gift, your pet and their quests.", zh: "这位居民怎样跟你打招呼：心情和说哪句话，取决于时间、信任、今天的礼物、你的宠物和他们的任务。" },
  inBits: 10,
  reference: (w) => folkReference(f, w),
});

export const FOLK_RULES: readonly RuleCircuit[] = FOLK.map(folkRule);
const folkAnswers = new Map<string, (w: number) => number>(FOLK.map((f, i) => [f.id, ruleFromCircuit(FOLK_RULES[i]!)]));

/** A resident's mood (0-3) and line slot (0-7), from their circuit. */
export function folkAnswer(id: string, word: number): { mood: number; slot: number } | null {
  const f = folkAnswers.get(id);
  if (!f) return null;
  const a = f(word);
  return { mood: a & 3, slot: (a >> 2) & 7 };
}

export const WORLD_RULES: readonly RuleCircuit[] = [DROP_RULE, TRUST_RULE, ...FOLK_RULES];
