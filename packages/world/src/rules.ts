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
  fields: {
    inputs: [
      { name: "tier", lo: 0, bits: 4, meaning: { en: "rarity tier: 1 rarest … 15 most common; 0 means no tier", zh: "稀有度：1 最稀有 … 15 最常见；0 表示没有稀有度" } },
      { name: "home", lo: 4, bits: 1, meaning: { en: "1 when the room's kind matches the pet", zh: "房间的类型和宠物相合时为 1" } },
    ],
    outputs: [
      { name: "exponent", lo: 0, bits: 4, meaning: { en: "weight exponent: a find of tier t weighs 2^(t-1)", zh: "权重指数：稀有度 t 的东西权重为 2^(t-1)" } },
      { name: "weighted", lo: 4, bits: 1, meaning: { en: "1 when the tier has a weight", zh: "这个稀有度有权重时为 1" } },
      { name: "rare", lo: 5, bits: 1, meaning: { en: "1 for a rare tier (1 to 4)", zh: "稀有（1 到 4）时为 1" } },
      { name: "familiarity", lo: 6, bits: 2, meaning: { en: "familiarity a look around adds: 2 where the pet is at home, else 1", zh: "四处找找增加的熟悉度：在宠物合适的房间为 2，否则为 1" } },
    ],
  },
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
  fields: {
    inputs: [
      { name: "points", lo: 0, bits: 7, meaning: { en: "trust points (127 and over read as 127)", zh: "信任点数（127 及以上按 127 算）" } },
      { name: "taste", lo: 7, bits: 2, meaning: { en: "the gift's taste: 0 loved, 1 liked, 2 neutral, 3 disliked", zh: "礼物合不合口味：0 最爱，1 喜欢，2 一般，3 不喜欢" } },
      { name: "counted", lo: 9, bits: 1, meaning: { en: "1 when a gift was already counted today", zh: "今天已经算过一份礼物时为 1" } },
    ],
    outputs: [
      { name: "level", lo: 0, bits: 3, meaning: { en: "trust level 0 to 5 (from 0, 5, 15, 30, 50, 80 points)", zh: "信任等级 0 到 5（从 0、5、15、30、50、80 点起）" } },
      { name: "gain", lo: 3, bits: 3, meaning: { en: "points the gift adds: 4 loved, 2 liked, 1 neutral; 0 when refused or already counted today", zh: "这份礼物加的点数：最爱 4，喜欢 2，一般 1；被拒收或今天已算过时为 0" } },
      { name: "refused", lo: 6, bits: 1, meaning: { en: "1 when the gift is refused", zh: "礼物被拒收时为 1" } },
    ],
  },
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
/** Every resident's circuit reads and answers the same fields (folk.ts); each ranks the line slots in its own order. */
const FOLK_FIELDS: RuleCircuit["fields"] = {
  inputs: [
    { name: "time", lo: 0, bits: 2, meaning: { en: "time of day: 0 night, 1 morning, 2 day, 3 evening", zh: "一天中的时间：0 夜里，1 早上，2 白天，3 傍晚" } },
    { name: "trust", lo: 2, bits: 3, meaning: { en: "trust level with this resident (0 to 5)", zh: "和这位居民的信任等级（0 到 5）" } },
    { name: "gift", lo: 5, bits: 2, meaning: { en: "today's gift to them: 0 none, 1 loved or liked, 2 accepted politely, 3 refused", zh: "今天送他们的礼物：0 没送，1 最爱或喜欢，2 礼貌收下，3 被拒收" } },
    { name: "petHappy", lo: 7, bits: 1, meaning: { en: "1 when the pet is happy (joy at 600 or more)", zh: "宠物开心（心情 600 及以上）时为 1" } },
    { name: "petHungry", lo: 8, bits: 1, meaning: { en: "1 when the pet is hungry (food under 300)", zh: "宠物饿了（饱腹 300 以下）时为 1" } },
    { name: "questReady", lo: 9, bits: 1, meaning: { en: "1 when a quest of theirs is ready to hand in", zh: "他们的任务可以交时为 1" } },
  ],
  outputs: [
    { name: "mood", lo: 0, bits: 2, meaning: { en: "mood: 0 low, 1 calm, 2 glad, 3 delighted", zh: "心情：0 低落，1 平静，2 高兴，3 很开心" } },
    {
      name: "line",
      lo: 2,
      bits: 3,
      meaning: {
        en: "which line: 0 their usual hello, 1 morning, 2 evening or night, 3 thanks for today's gift, 4 after a refused gift, 5 an old friend, 6 the pet looks hungry, 7 something is ready for them",
        zh: "说哪句话：0 平常的招呼，1 早上，2 傍晚或夜里，3 谢谢今天的礼物，4 礼物被拒之后，5 老朋友，6 宠物看起来饿了，7 有东西可以交给他们",
      },
    },
  ],
};

export const folkRule = (f: Folk): RuleCircuit => ({
  name: `folk:${f.id}`,
  about: { en: "How this resident greets you: their mood and which line they choose, from the time, trust, today's gift, your pet and their quests.", zh: "这位居民怎样跟你打招呼：心情和说哪句话，取决于时间、信任、今天的礼物、你的宠物和他们的任务。" },
  inBits: 10,
  fields: FOLK_FIELDS,
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
