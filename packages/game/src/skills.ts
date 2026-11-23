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
  about: { en: "Which tier of a skill tree is open for the points held in it, and how many points each tier needs.", zh: "技能树里，按已投入的点数哪一层开放，以及每层需要多少点。" },
  inBits: 9,
  fields: {
    inputs: [
      { name: "held", lo: 0, bits: 6, meaning: { en: "points held in the tree (0 to 63; a full tree holds 62)", zh: "这棵树里已投入的点数（0 到 63；满树 62）" } },
      { name: "tier", lo: 6, bits: 3, meaning: { en: "the tier asked about: 1 to 6 (0 and 7 are no tier)", zh: "问的是第几层：1 到 6（0 和 7 不是层）" } },
    ],
    outputs: [
      { name: "open", lo: 0, bits: 1, meaning: { en: "1 when the tier is open", zh: "这一层已开放时为 1" } },
      { name: "needs", lo: 1, bits: 6, meaning: { en: "points the tier needs: tier 1 0, tier 2 5, tier 3 15, tier 4 25, tier 5 40, tier 6 55 (63 for no tier)", zh: "这一层需要的点数：第 1 层 0，第 2 层 5，第 3 层 15，第 4 层 25，第 5 层 40，第 6 层 55（不是层时为 63）" } },
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

interface Text {
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

const T = (en: string, zh: string): Text => ({ en, zh });
type Row = [id: number, name: Text, desc: Text, effect: Effect, value: number, rule?: Rule];

const TREE_OF: Record<string, Tree> = { "1": "care", "2": "mind", "3": "explore", "4": "spar" };

const ROWS: Row[] = [
  // ── Care ──
  [111, T("Full Belly", "饱肚子"), T("Hunger grows 4% slower per point.", "每点让饥饿慢 4%。"), "FOOD_DECAY", 40],
  [112, T("Good Spirits", "好心情"), T("Joy fades 4% slower per point.", "每点让快乐消退慢 4%。"), "JOY_DECAY", 40],
  [113, T("Tidy Habits", "爱干净"), T("Gets dirty 4% slower per point.", "每点让变脏慢 4%。"), "CLEAN_DECAY", 40],
  [121, T("Deep Sleeper", "睡得香"), T("Sleep restores 6% more energy per point.", "每点让睡觉多恢复 6% 精神。"), "SLEEP_GAIN", 6],
  [122, T("Stamina", "体力好"), T("Tires 4% slower per point.", "每点让疲劳慢 4%。"), "ENERGY_DECAY", 40],
  [123, T("Hearty Eater", "胃口好"), T("Food fills 5% more per point.", "每点让食物多填饱 5%。"), "FOOD_ITEM", 5],
  [131, T("Iron Stomach", "铁胃"), T("Takes half as long again before neglect makes it ill.", "被冷落后要多一半时间才会生病。"), "SICK_GRACE", 50],
  [132, T("Early to Bed", "早睡"), T("A rule in its circuit: tired in the evening, it goes to bed by itself.", "电路里多一条规则：傍晚累了，自己去睡。"), "RULE", 1, { label: "skill: early to bed", when: { energy: [0, 1], time: [3] }, then: { want: 3, mood: 1 } }],
  [133, T("Sunny Nature", "阳光性格"), T("Play and treats bring 25% more joy.", "玩耍和零食多带来 25% 快乐。"), "JOY_ITEM", 25],
  [141, T("Bath Lover", "爱洗澡"), T("A bath also brings 10 joy per point.", "每点让洗澡还多带来 10 点快乐。"), "BATH_JOY", 10],
  [142, T("Hardy", "耐得住"), T("Waits 10% longer per point before it hibernates.", "每点让冬眠前多撑 10%。"), "HIBERNATE_GRACE", 10],
  [143, T("Kin Keeper", "念旧"), T("Kinship fades 10% slower per point.", "每点让亲密度消退慢 10%。"), "KINSHIP_KEEP", 10],
  [151, T("Comfort Food", "安心饭"), T("Hunger grows 3% slower per point.", "每点让饥饿再慢 3%。"), "FOOD_DECAY", 30],
  [152, T("Playful Heart", "玩心"), T("Joy fades 3% slower per point.", "每点让快乐消退再慢 3%。"), "JOY_DECAY", 30],
  [153, T("Quick Learner", "学得快"), T("Earns 4% more experience per point.", "每点多得 4% 经验。"), "XP_GAIN", 4],
  [161, T("Evergreen", "常青"), T("Every need fades 10% slower.", "所有需求都慢 10%。"), "ALL_DECAY", 100],
  [162, T("Cuddle Bug", "黏人精"), T("A rule in its circuit: happy and petted, it cuddles you back.", "电路里多一条规则：开心时被摸，会回抱你。"), "RULE", 1, { label: "skill: cuddle bug", when: { owner: [1], joy: [2, 3], action: [5] }, then: { want: 6, mood: 3, nudge: 6 } }],
  [163, T("Wise Keeper", "老练"), T("Earns 20% more experience.", "多得 20% 经验。"), "XP_GAIN", 20],
  // ── Mind ──
  [211, T("Wide Mind", "宽心"), T("Room for 10 more gates in its brain, 3 of them for lessons, per point.", "每点让大脑多 10 个门的空间，其中 3 个给课程。"), "GATES", 10],
  [212, T("Warm Memory", "温暖的记忆"), T("Kinship can grow an hour sooner per point (every 12 hours at first).", "每点让亲密度早 1 小时就能再涨（起初是每 12 小时）。"), "KINSHIP_SOONER", 60],
  [213, T("Eager Student", "好学"), T("2 more experience per point for each lesson taught.", "每教一课，每点多得 2 经验。"), "TEACH_XP", 2],
  [221, T("Wider Mind", "更宽的心"), T("Room for 10 more gates in its brain, 3 of them for lessons, per point.", "每点让大脑再多 10 个门的空间，其中 3 个给课程。"), "GATES", 10],
  [222, T("Attentive", "专心"), T("Earns 3% more experience per point.", "每点多得 3% 经验。"), "XP_GAIN", 3],
  [223, T("Long Memory", "长记性"), T("Kinship fades 10% slower per point.", "每点让亲密度消退慢 10%。"), "KINSHIP_KEEP", 10],
  [231, T("Extra Lesson", "多一课"), T("Holds one more lesson at every stage.", "每个阶段都多装一课。"), "LESSONS", 1],
  [232, T("Brave Heart", "勇敢的心"), T("A rule in its circuit: frightened with you near, it comes to you.", "电路里多一条规则：你在时受了惊吓，它会跑向你。"), "RULE", 1, { label: "skill: brave heart", when: { event: [3], owner: [1] }, then: { want: 6, mood: 1, nudge: 1 } }],
  [233, T("Big Brain", "大脑袋"), T("Room for 50 more gates in its brain, 16 of them for lessons.", "大脑多 50 个门的空间，其中 16 个给课程。"), "GATES", 50],
  [241, T("Broad Mind", "开阔"), T("Room for 10 more gates in its brain, 3 of them for lessons, per point.", "每点让大脑再多 10 个门的空间，其中 3 个给课程。"), "GATES", 10],
  [242, T("Deep Memory", "深记忆"), T("Its personality grows 10% faster per point.", "每点让性格成长快 10%。"), "TRAIT_GROWTH", 10],
  [243, T("Room to Learn", "学海"), T("Every five points hold one more lesson.", "每 5 点多装一课。"), "LESSON_TENTHS", 2],
  [251, T("Vast Mind", "浩瀚"), T("Room for 10 more gates in its brain, 3 of them for lessons, per point.", "每点让大脑再多 10 个门的空间，其中 3 个给课程。"), "GATES", 10],
  [252, T("Lesson Master", "课业精通"), T("2 more experience per point for each lesson taught.", "每教一课，每点再多得 2 经验。"), "TEACH_XP", 2],
  [253, T("Room to Grow", "成长空间"), T("Every five points hold one more lesson.", "每 5 点再多装一课。"), "LESSON_TENTHS", 2],
  [261, T("Two More Lessons", "再多两课"), T("Holds two more lessons at every stage.", "每个阶段都多装两课。"), "LESSONS", 2],
  [262, T("Thinks Ahead", "有远见"), T("A rule in its circuit: getting hungry with nothing going on, it goes to eat before it starves.", "电路里多一条规则：开始饿又没事做时，饿坏前就去吃。"), "RULE", 1, { label: "skill: thinks ahead", when: { hunger: [2], action: [0] }, then: { want: 1, mood: 1 } }],
  [263, T("Boundless", "无边"), T("Room for 100 more gates in its brain, 33 of them for lessons.", "大脑多 100 个门的空间，其中 33 个给课程。"), "GATES", 100],
  // ── Explore ──
  [311, T("Light Feet", "轻脚"), T("Walking to the next room costs 1 less energy per point.", "每点让走到下个房间少花 1 精神。"), "MOVE_ENERGY", 1],
  [312, T("Sharp Eyes", "眼尖"), T("Looking around costs 1 less energy per point.", "每点让四处找找少花 1 精神。"), "FORAGE_ENERGY", 1],
  [313, T("Lucky Paws", "好运爪"), T("5% more chance per point of a second find.", "每点多 5% 机会找到第二样。"), "FIND_EXTRA", 5],
  [321, T("Treasure Nose", "寻宝鼻"), T("Rare things turn up 8% more often per point, looking around and on walks.", "每点让四处找找和散步时稀有东西多出现 8%。"), "FIND_RARE", 8],
  [322, T("Wanderer", "爱游荡"), T("The first time each day it walks into a room, 4% chance per point that it picks something up there.", "每天第一次走进一个房间时，每点有 4% 机会在那里捡到东西。"), "DAY_FIND", 4],
  [323, T("Strider", "大步走"), T("A walk finds something 20 steps sooner per point.", "每点让散步早 20 步找到东西。"), "WALK_STEPS", 20],
  [331, T("Explorer's Map", "探险地图"), T("Can look around a room again 20 minutes sooner.", "同一个房间能早 20 分钟再找。"), "FORAGE_WAIT", 20],
  [332, T("Second Wind", "第二口气"), T("One more walk a day brings finds.", "每天多一次散步能找到东西。"), "WALK_FINDS", 1],
  [333, T("Collector", "收藏家"), T("20% more chance of a second find.", "多 20% 机会找到第二样。"), "FIND_EXTRA", 20],
  [341, T("Trail Mix", "路上零食"), T("Walking to the next room costs 1 less energy per point.", "每点让走到下个房间再少花 1 精神。"), "MOVE_ENERGY", 1],
  [342, T("Keen Eyes", "锐眼"), T("Rare things turn up 8% more often per point, looking around and on walks.", "每点让四处找找和散步时稀有东西再多出现 8%。"), "FIND_RARE", 8],
  [343, T("Pathfinder", "开路人"), T("10% chance per point of one more find on a trip.", "每点让远行多 10% 机会多找到一样。"), "TRIP_EXTRA", 10],
  [351, T("Long Legs", "长腿"), T("Looking around costs 1 less energy per point.", "每点让四处找找再少花 1 精神。"), "FORAGE_ENERGY", 1],
  [352, T("Lucky Star", "幸运星"), T("5% more chance per point of a second find.", "每点再多 5% 机会找到第二样。"), "FIND_EXTRA", 5],
  [353, T("Rich Finds", "满载而归"), T("4% more chance per point of picking something up the first time each day it walks into a room.", "每天第一次走进一个房间时，每点再多 4% 机会捡到东西。"), "DAY_FIND", 4],
  [361, T("Born Explorer", "天生探险家"), T("Can look around a room again 30 minutes sooner.", "同一个房间能早 30 分钟再找。"), "FORAGE_WAIT", 30],
  [362, T("Dowser", "探宝人"), T("Rare things turn up 40% more often, looking around and on walks.", "四处找找和散步时稀有东西多出现 40%。"), "FIND_RARE", 40],
  [363, T("Trailblazer", "开拓者"), T("Two more walks a day bring finds.", "每天多两次散步能找到东西。"), "WALK_FINDS", 2],
  // ── Spar ──
  [411, T("Strong Paws", "有力的爪"), T("Every five points: one more damage every five pounces in spars.", "每 5 点：切磋里每扑 5 次多 1 点伤害。"), "SPAR_POWER", 2],
  [412, T("Thick Fur", "厚毛"), T("Each point adds 0.2 health in spars, counted in whole points with the other health skills.", "每点在切磋里加 0.2 点体力，和其他体力技能合起来按整数算。"), "SPAR_HP", 4],
  [413, T("Second Breath", "缓口气"), T("Each point adds a quarter of a stamina in spars, counted in whole points with Endurance.", "每点在切磋里加四分之一点耐力，和「持久」合起来按整数算。"), "SPAR_STAMINA", 5],
  [421, T("Steady Guard", "稳守"), T("Guarding stops 1% more of what gets through per point.", "每点让防守多挡下 1% 漏过来的伤害。"), "SPAR_GUARD", 4],
  [422, T("Quick Feet", "快脚"), T("Dodges succeed 0.5% more often per point.", "每点让闪避多成功 0.5%。"), "SPAR_DODGE", 2],
  [423, T("Snack Pack", "零食包"), T("Every five points: a snack mid-spar heals 1 more, counted in whole points with Bigger Snacks.", "每 5 点：切磋中吃零食多回 1 点，和「大零食」合起来按整数算。"), "SPAR_HEAL", 1],
  [431, T("Champion's Heart", "冠军之心"), T("One more damage every five pounces in spars.", "切磋里每扑 5 次多 1 点伤害。"), "SPAR_POWER", 10],
  [432, T("Iron Will", "钢铁意志"), T("1 more health in spars.", "切磋里多 1 点体力。"), "SPAR_HP", 20],
  [433, T("Good Sport", "好风度"), T("10 coins even when one of the day's paid spars is lost.", "当天的有奖切磋输了也得 10 金币。"), "SPAR_LOSS_COINS", 10],
  [441, T("Power Up", "力量提升"), T("Every five points: one more damage every five pounces again.", "每 5 点：切磋里每扑 5 次再多 1 点伤害。"), "SPAR_POWER", 2],
  [442, T("Endurance", "持久"), T("Each point adds a quarter of a stamina more in spars, counted in whole points with Second Breath.", "每点在切磋里再加四分之一点耐力，和「缓口气」合起来按整数算。"), "SPAR_STAMINA", 5],
  [443, T("Guard Up", "加强防守"), T("Guarding stops another 1% of what gets through per point.", "每点让防守再多挡下 1% 漏过来的伤害。"), "SPAR_GUARD", 4],
  [451, T("Agile", "灵巧"), T("Dodges succeed another 0.5% more often per point.", "每点让闪避再多成功 0.5%。"), "SPAR_DODGE", 2],
  [452, T("Bigger Snacks", "大零食"), T("Every five points: a snack mid-spar heals 1 more again, counted in whole points with Snack Pack.", "每 5 点：切磋中吃零食再多回 1 点，和「零食包」合起来按整数算。"), "SPAR_HEAL", 1],
  [453, T("Prize Hunter", "猎奖者"), T("1 more coin per point for each of the day's paid spars won.", "每点让当天每场有奖切磋赢了多得 1 金币。"), "SPAR_WIN_COINS", 1],
  [461, T("Legend", "传奇"), T("Two more damage every five pounces in spars.", "切磋里每扑 5 次多 2 点伤害。"), "SPAR_POWER", 20],
  [462, T("Unbreakable", "坚不可摧"), T("2 more health in spars.", "切磋里多 2 点体力。"), "SPAR_HP", 40],
  [463, T("Generous Victor", "大方的赢家"), T("8 more coins for each of the day's paid spars won.", "当天每场有奖切磋赢了多得 8 金币。"), "SPAR_WIN_COINS", 8],
];

const capstoneTier = (tier: number) => tier === 3 || tier === 6;

/** Every skill, with the exclusions written for every pair of capstones in a tier (both directions). */
export const SKILLS: readonly SkillDef[] = ROWS.map(([id, name, desc, effect, value, rule]) => {
  const tree = TREE_OF[String(id)[0]!]!;
  const tier = Number(String(id)[1]);
  const peers = capstoneTier(tier) ? ROWS.map((r) => r[0]).filter((o) => o !== id && Math.floor(o / 10) === Math.floor(id / 10)) : [];
  return { id, tree, tier, max: capstoneTier(tier) ? 1 : 5, name, desc, effect, value, ...(rule ? { rule } : {}), excludes: peers };
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

export function levelUp(g: Growth, xp: number): { ok: true; growth: Growth; xp: number } | { ok: false; reason: "xp" | "max" } {
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

export const treePoints = (g: Growth, tree: Tree): number => SKILLS.filter((s) => s.tree === tree).reduce((n, s) => n + (g.skills[s.id] ?? 0), 0);
export const tierOpen = (g: Growth, tree: Tree, tier: number): boolean => tierOpenFor(treePoints(g, tree), tier);

export type UpgradeRefusal = "noSkill" | "maxed" | "tier" | "excluded" | "points";

/** Why an upgrade would be refused (the source gave one message for all five), or null when it can be taken. */
export function upgradeRefusal(g: Growth, id: number): { reason: UpgradeRefusal; need?: number; have?: number; by?: number } | null {
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
  if (!Number.isInteger(g.level) || g.level < 1 || g.level > MAX_LEVEL || !Number.isInteger(g.points) || g.points < 0) return false;
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
      const here = SKILLS.filter((s) => s.tree === tree && s.tier === tier).reduce((n, s) => n + (g.skills[s.id] ?? 0), 0);
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
export const ruleSkillIds = (g: Growth | undefined): number[] => (g ? SKILLS.filter((s) => s.rule && (g.skills[s.id] ?? 0) > 0).map((s) => s.id) : []);
/** The rule skills a log segment recorded, as a growth that composes the same brain (only its rules matter). */
export const ruleGrowth = (ids: readonly number[] = []): Growth => ({ level: 1, points: 0, skills: Object.fromEntries(ids.filter((id) => SKILL_BY_ID[id]?.rule).map((id) => [id, 1])) });

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
export const TAUGHT_BUDGET: Readonly<Record<"baby" | "child" | "teen" | "adult" | "elder", number>> = { baby: 28, child: 30, teen: 32, adult: 48, elder: 60 };
/**
 * D3: a gate skill widens the lesson budget by a third of what it adds to the whole brain (Wide Mind's 10 gates a point
 * are 3 for lessons), so each point is a number a player sees without one point ending the choice, and an elder with
 * the slot skills and the gate skills on their path still has room to fill its slots with lessons that share logic.
 */
export const TAUGHT_SHARE = 3;
export const taughtBudget = (stage: keyof typeof TAUGHT_BUDGET, g: Growth | undefined): number => TAUGHT_BUDGET[stage] + Math.floor(effectOf(g, "GATES") / TAUGHT_SHARE);
export const extraLessons = (g: Growth | undefined): number => effectOf(g, "LESSONS") + Math.floor(effectOf(g, "LESSON_TENTHS") / 10);
/** The most gates any pet can hold with every gate skill taken: the relayer accepts no more than this. */
export const MAX_GATES_SKILLED =
  BASE_GATES +
  SKILLS.filter((s) => s.effect === "GATES" && s.max > 1).reduce((n, s) => n + s.value * s.max, 0) +
  // one capstone per tier at most: the largest gate capstone of each
  [3, 6].reduce((n, tier) => n + Math.max(0, ...SKILLS.filter((s) => s.effect === "GATES" && s.tier === tier).map((s) => s.value)), 0);

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
