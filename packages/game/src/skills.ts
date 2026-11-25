/**
 * Levels and the four skill trees (plan 4.4, note B §1, §2, §9.3).
 *
 * Copied from the source: four trees of six tiers by three; tiers 1, 2, 4 and 5 hold rank skills of up to five
 * points, tiers 3 and 6 hold one-point capstones that exclude each other; a tier opens when its tree holds enough
 * points, from one table; one skill point per level; a respec item returns every point; XP is spent at level-up.
 *
 * Changed where the source went wrong: the exclusions are written here for every pair (their skill 262 excluded
 * itself instead of 263, so a pet could hold two capstones); the tier table below is the only one, and the screen
 * reads it (theirs had a sheet and a config that disagreed); a refused upgrade says why; and the level curve is a
 * gentle line tuned by simulating real play (theirs reaches the last tier at about 12 million XP).
 *
 * Each skill either tunes a number of the pet's life, widens the budget its circuit lives in (gates, memory bits,
 * lesson slots), or, for four capstones, adds a rule to the circuit itself.
 */

import { type Rule, type RuleCircuit, ruleFromCircuit } from "@lingxi/brain";
import { ROWS } from "./skillRows";

export type Tree = "care" | "mind" | "explore" | "spar";
export const TREES: readonly Tree[] = ["care", "mind", "explore", "spar"];

/** Points a tree must hold before each tier opens (tiers 1 to 6): the reference of the skill-gate circuit. */
export const TIER_GATE = [0, 5, 15, 25, 40, 55] as const;

/**
 * Skill gates as a circuit (plan 4.11), taped out with the other rules; the rules and the skills screen both read it.
 *   in  bits 0-5  points held in the tree (0-63; a full tree holds 62)
 *       bits 6-8  tier (1-6; 0 and 7 are no tier)
 *   out bit  0    the tier is open; bits 1-6 points it needs (63 for no tier)
 */
export const SKILL_RULE: RuleCircuit = {
  name: "skills",
  about: {
    en: "Which tier of a skill tree is open for the points held in it, and how many points each tier needs.",
    zh: "技能树里，按已投入的点数哪一层开放，以及每层需要多少点。",
  },
  inBits: 9,
  fields: {
    inputs: [
      {
        name: "held",
        lo: 0,
        bits: 6,
        meaning: {
          en: "points held in the tree (0 to 63; a full tree holds 62)",
          zh: "这棵树里已投入的点数（0 到 63；满树 62）",
        },
      },
      {
        name: "tier",
        lo: 6,
        bits: 3,
        meaning: {
          en: "the tier asked about: 1 to 6 (0 and 7 are no tier)",
          zh: "问的是第几层：1 到 6（0 和 7 不是层）",
        },
      },
    ],
    outputs: [
      { name: "open", lo: 0, bits: 1, meaning: { en: "1 when the tier is open", zh: "这一层已开放时为 1" } },
      {
        name: "needs",
        lo: 1,
        bits: 6,
        meaning: {
          en: "points the tier needs: tier 1 0, tier 2 5, tier 3 15, tier 4 25, tier 5 40, tier 6 55 (63 for no tier)",
          zh: "这一层需要的点数：第 1 层 0，第 2 层 5，第 3 层 15，第 4 层 25，第 5 层 40，第 6 层 55（不是层时为 63）",
        },
      },
    ],
  },
  reference: (w) => {
    const held = w & 63;
    const tier = (w >> 6) & 7;
    const need = tier >= 1 && tier <= 6 ? TIER_GATE[tier - 1]! : 63;
    return (tier >= 1 && tier <= 6 && held >= need ? 1 : 0) | (need << 1);
  },
};
const gate = ruleFromCircuit(SKILL_RULE);
const gateWord = (held: number, tier: number) => Math.max(0, Math.min(63, held)) | ((tier & 7) << 6);
/** Points a tier needs, from the circuit. */
export const tierNeed = (tier: number): number => (gate(gateWord(0, tier)) >> 1) & 63;
/** Whether a tier is open for these points, from the circuit. */
export const tierOpenFor = (held: number, tier: number): boolean => (gate(gateWord(held, tier)) & 1) === 1;

export type Effect =
  // Care: per-mille of the meter's hourly decay removed, per point
  | "FOOD_DECAY"
  | "JOY_DECAY"
  | "CLEAN_DECAY"
  | "ENERGY_DECAY"
  | "ALL_DECAY"
  // Care: percent added
  | "SLEEP_GAIN"
  | "FOOD_ITEM"
  | "JOY_ITEM"
  | "BATH_JOY"
  | "SICK_GRACE"
  | "HIBERNATE_GRACE"
  | "KINSHIP_KEEP"
  | "XP_GAIN"
  // Mind
  | "TEACH_XP"
  | "GATES"
  | "LESSONS"
  /** tenths of a lesson slot, so five points of a 2 make one more lesson */
  | "LESSON_TENTHS"
  | "KINSHIP_SOONER"
  | "TRAIT_GROWTH"
  // Explore
  | "MOVE_ENERGY"
  | "FORAGE_ENERGY"
  | "FIND_EXTRA"
  | "FIND_RARE"
  | "FORAGE_WAIT"
  | "WALK_FINDS"
  | "WALK_STEPS"
  | "DAY_FIND"
  | "TRIP_EXTRA"
  // Spar (POWER and STAMINA in tenths, so five points of a 2 make one whole; spar2.ts says how LX-SPAR/2 reads each)
  | "SPAR_POWER"
  | "SPAR_HP"
  | "SPAR_STAMINA"
  | "SPAR_GUARD"
  | "SPAR_DODGE"
  | "SPAR_HEAL"
  | "SPAR_WIN_COINS"
  | "SPAR_LOSS_COINS"
  // a capstone that adds a rule to the circuit
  | "RULE";

export interface Text {
  en: string;
  zh: string;
}

export interface SkillDef {
  /** tree digit, tier digit, column digit: 132 is Care, tier 3, third */
  id: number;
  tree: Tree;
  tier: number;
  max: number;
  name: Text;
  desc: Text;
  effect: Effect;
  /** per point */
  value: number;
  /** for RULE skills: the rule it adds, below the owner's lessons and the hatch instincts */
  rule?: Rule;
  /** capstones of the same tier, written for every pair below */
  excludes: number[];
}

const TREE_OF: Record<string, Tree> = { "1": "care", "2": "mind", "3": "explore", "4": "spar" };

const capstoneTier = (tier: number) => tier === 3 || tier === 6;

/** Every skill, with the exclusions written for every pair of capstones in a tier (both directions). */
export const SKILLS: readonly SkillDef[] = ROWS.map(([id, name, desc, effect, value, rule]) => {
  const tree = TREE_OF[String(id)[0]!]!;
  const tier = Number(String(id)[1]);
  const peers = capstoneTier(tier)
    ? ROWS.map((r) => r[0]).filter((o) => o !== id && Math.floor(o / 10) === Math.floor(id / 10))
    : [];
  return {
    id,
    tree,
    tier,
    max: capstoneTier(tier) ? 1 : 5,
    name,
    desc,
    effect,
    value,
    ...(rule ? { rule } : {}),
    excludes: peers,
  };
});
export const SKILL_BY_ID: Readonly<Record<number, SkillDef>> = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

/* ── levels ─────────────────────────────────────────────────────────────── */

export const MAX_LEVEL = 99;
/**
 * XP to go from `level` to the next: a gentle line, tuned in the 90-day simulator (G3) now that only care answering a
 * need teaches anything: the three-visit player finishes one tree and starts a second (level 64) on day 78, and no
 * player can tap their way past it (target "level-not-by-tapping": the tapper stands below the carer on day 30).
 */
export const levelCost = (level: number): number => 6 + Math.floor(level / 5);

/** What the pet holds of its own growth: level, unspent points, points per skill. */
export interface Growth {
  level: number;
  points: number;
  skills: Record<number, number>;
}

/** The source's level-up: spend the XP, gain a level and one point. */
export function canLevelUp(g: Growth, xp: number): boolean {
  return g.level < MAX_LEVEL && xp >= levelCost(g.level);
}

export function levelUp(
  g: Growth,
  xp: number,
): { ok: true; growth: Growth; xp: number } | { ok: false; reason: "xp" | "max" } {
  if (g.level >= MAX_LEVEL) return { ok: false, reason: "max" };
  const cost = levelCost(g.level);
  if (xp < cost) return { ok: false, reason: "xp" };
  return { ok: true, growth: { ...g, level: g.level + 1, points: g.points + 1 }, xp: xp - cost };
}

/** A pet from before levels were spent: keep the level it showed (the old triangular curve) and its points. */
export function migrateGrowth(xp: number): { growth: Growth; xp: number } {
  let level = 1;
  while (25 * ((level * (level + 1)) / 2) <= xp) level++;
  const spent = 25 * (((level - 1) * level) / 2);
  return { growth: { level, points: level, skills: {} }, xp: xp - spent };
}

export const newGrowth = (): Growth => ({ level: 1, points: 1, skills: {} });

/* ── the trees ──────────────────────────────────────────────────────────── */

export const treePoints = (g: Growth, tree: Tree): number =>
  SKILLS.filter((s) => s.tree === tree).reduce((n, s) => n + (g.skills[s.id] ?? 0), 0);
export const tierOpen = (g: Growth, tree: Tree, tier: number): boolean => tierOpenFor(treePoints(g, tree), tier);

export type UpgradeRefusal = "noSkill" | "maxed" | "tier" | "excluded" | "points";

/** Why an upgrade would be refused (the source gave one message for all five), or null when it can be taken. */
export function upgradeRefusal(
  g: Growth,
  id: number,
): { reason: UpgradeRefusal; need?: number; have?: number; by?: number } | null {
  const s = SKILL_BY_ID[id];
  if (!s) return { reason: "noSkill" };
  const have = g.skills[id] ?? 0;
  if (have >= s.max) return { reason: "maxed" };
  if (!tierOpen(g, s.tree, s.tier)) return { reason: "tier", need: tierNeed(s.tier), have: treePoints(g, s.tree) };
  const by = s.excludes.find((x) => (g.skills[x] ?? 0) > 0);
  if (by !== undefined) return { reason: "excluded", by };
  if (g.points < 1) return { reason: "points" };
  return null;
}

export function upgrade(g: Growth, id: number): { ok: true; growth: Growth } | { ok: false; reason: UpgradeRefusal } {
  const no = upgradeRefusal(g, id);
  if (no) return { ok: false, reason: no.reason };
  return { ok: true, growth: { ...g, points: g.points - 1, skills: { ...g.skills, [id]: (g.skills[id] ?? 0) + 1 } } };
}

/** The respec: every point back, every skill cleared. */
export function respec(g: Growth): Growth {
  const back = Object.values(g.skills).reduce((n, p) => n + p, 0);
  return { ...g, points: g.points + back, skills: {} };
}

/** Is this allocation one the rules could have produced? (Used to check what a client sends.) */
export function legalGrowth(g: Growth): boolean {
  if (!Number.isInteger(g.level) || g.level < 1 || g.level > MAX_LEVEL || !Number.isInteger(g.points) || g.points < 0)
    return false;
  let spent = 0;
  for (const [k, v] of Object.entries(g.skills)) {
    const s = SKILL_BY_ID[Number(k)];
    if (!s || !Number.isInteger(v) || v < 0 || v > s.max) return false;
    if (v > 0 && s.excludes.some((x) => (g.skills[x] ?? 0) > 0)) return false;
    spent += v;
  }
  if (spent + g.points !== g.level) return false;
  // every tier must have been open when its points went in: replay taking points lowest tier first
  for (const tree of TREES) {
    let held = 0;
    for (let tier = 1; tier <= 6; tier++) {
      const here = SKILLS.filter((s) => s.tree === tree && s.tier === tier).reduce(
        (n, s) => n + (g.skills[s.id] ?? 0),
        0,
      );
      if (here > 0 && !tierOpenFor(held, tier)) return false;
      held += here;
    }
  }
  return true;
}

/* ── what the skills do ─────────────────────────────────────────────────── */

/** The sum of an effect over the skills held. */
export function effectOf(g: Growth | undefined, effect: Effect): number {
  if (!g) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(g.skills)) {
    const s = SKILL_BY_ID[Number(k)];
    if (s && s.effect === effect) n += s.value * v;
  }
  return n;
}

/** The rules the held capstones add to the circuit, in id order. */
export function skillRules(g: Growth | undefined): Rule[] {
  if (!g) return [];
  return SKILLS.filter((s) => s.rule && (g.skills[s.id] ?? 0) > 0).map((s) => s.rule!);
}
export const ruleSkillIds = (g: Growth | undefined): number[] =>
  g ? SKILLS.filter((s) => s.rule && (g.skills[s.id] ?? 0) > 0).map((s) => s.id) : [];
/** The rule skills a log segment recorded, as a growth that composes the same brain (only its rules matter). */
export const ruleGrowth = (ids: readonly number[] = []): Growth => ({
  level: 1,
  points: 0,
  skills: Object.fromEntries(ids.filter((id) => SKILL_BY_ID[id]?.rule).map((id) => [id, 1])),
});

/** Care: how much of a meter's hourly decay is left, in per-mille (never below 400, i.e. at most 60% off). */
export function decayLeft(g: Growth | undefined, meter: "food" | "joy" | "clean" | "energy"): number {
  const own = { food: "FOOD_DECAY", joy: "JOY_DECAY", clean: "CLEAN_DECAY", energy: "ENERGY_DECAY" }[meter] as Effect;
  return Math.max(400, 1000 - effectOf(g, own) - effectOf(g, "ALL_DECAY"));
}
/** A percent boost as a factor applied by integer maths: value × (100 + pct) / 100, rounded down. */
export const boosted = (value: number, pct: number): number => Math.floor((value * (100 + pct)) / 100);

/** Mind: the budget the circuit lives in, from the pet's stage capacity and its skills. */
export const BASE_GATES = 500;
export const gateBudget = (g: Growth | undefined): number => BASE_GATES + effectOf(g, "GATES");
/**
 * G7: gates a pet's taught lessons may add to its starter circuit, by stage (the PRD's capacity growing with age, M12),
 * widened by every Mind gate skill. The whole circuit still has to fit gateBudget, the on-chain limit; this is the budget
 * a player spends lesson by lesson. A school lesson costs 5 to 14 gates, so a teen's 32 hold three school lessons and rarely a fourth and a
 * fourth often has to be chosen.
 */
export const TAUGHT_BUDGET: Readonly<Record<"baby" | "child" | "teen" | "adult" | "elder", number>> = {
  baby: 28,
  child: 30,
  teen: 32,
  adult: 48,
  elder: 60,
};
/**
 * D3: a gate skill widens the lesson budget by a third of what it adds to the whole brain (Wide Mind's 10 gates a point
 * are 3 for lessons), so each point is a number a player sees without one point ending the choice, and an elder with
 * the slot skills and the gate skills on their path still has room to fill its slots with lessons that share logic.
 */
export const TAUGHT_SHARE = 3;
export const taughtBudget = (stage: keyof typeof TAUGHT_BUDGET, g: Growth | undefined): number =>
  TAUGHT_BUDGET[stage] + Math.floor(effectOf(g, "GATES") / TAUGHT_SHARE);
export const extraLessons = (g: Growth | undefined): number =>
  effectOf(g, "LESSONS") + Math.floor(effectOf(g, "LESSON_TENTHS") / 10);
/** The most gates any pet can hold with every gate skill taken: the relayer accepts no more than this. */
export const MAX_GATES_SKILLED =
  BASE_GATES +
  SKILLS.filter((s) => s.effect === "GATES" && s.max > 1).reduce((n, s) => n + s.value * s.max, 0) +
  // one capstone per tier at most: the largest gate capstone of each
  [3, 6].reduce(
    (n, tier) => n + Math.max(0, ...SKILLS.filter((s) => s.effect === "GATES" && s.tier === tier).map((s) => s.value)),
    0,
  );

/** Explore: the world's numbers for this pet. */
export interface ExploreMods {
  moveEnergy: number;
  forageEnergy: number;
  /** percent chance of a second find (the world's base is one in three) */
  extraFind: number;
  /** percent added to the weight of rare finds */
  rareBoost: number;
  /** minutes off the wait before a room can be looked around again */
  forageWaitOff: number;
  walksWithFinds: number;
  stepsOff: number;
  dayFind: number;
  tripExtra: number;
}
export function exploreMods(g: Growth | undefined): ExploreMods {
  return {
    moveEnergy: Math.max(5, 15 - effectOf(g, "MOVE_ENERGY")),
    forageEnergy: Math.max(2, 10 - effectOf(g, "FORAGE_ENERGY")),
    extraFind: effectOf(g, "FIND_EXTRA"),
    rareBoost: effectOf(g, "FIND_RARE"),
    forageWaitOff: effectOf(g, "FORAGE_WAIT"),
    walksWithFinds: effectOf(g, "WALK_FINDS"),
    stepsOff: effectOf(g, "WALK_STEPS"),
    dayFind: effectOf(g, "DAY_FIND"),
    tripExtra: effectOf(g, "TRIP_EXTRA"),
  };
}

/** Spar: what the pet brings to a fight. */
export interface SparMods {
  power: number;
  hp: number;
  stamina: number;
  /** percent of guarded damage stopped on top of the guard itself */
  guard: number;
  /** percent added to a dodge's chance */
  dodge: number;
  heal: number;
  winCoins: number;
  lossCoins: number;
}
export function sparMods(g: Growth | undefined): SparMods {
  return {
    power: Math.floor(effectOf(g, "SPAR_POWER") / 10),
    hp: effectOf(g, "SPAR_HP"),
    stamina: Math.floor(effectOf(g, "SPAR_STAMINA") / 10),
    guard: effectOf(g, "SPAR_GUARD"),
    dodge: effectOf(g, "SPAR_DODGE"),
    heal: effectOf(g, "SPAR_HEAL"),
    winCoins: effectOf(g, "SPAR_WIN_COINS"),
    lossCoins: effectOf(g, "SPAR_LOSS_COINS"),
  };
}
