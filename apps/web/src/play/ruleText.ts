/**
 * Turns brain rules into short chips a player can read, in both languages.
 * The words come from the pins' own value names, so what the screen says is
 * exactly what the circuit tests.
 */

import { INPUT_FIELDS, type Out, type Program, type Rule } from "@lingxi/brain";
import type { Lang } from "../i18n";

type Names = { en: readonly string[]; zh: readonly string[] };

export const VALUE_NAMES: Record<string, Names> = {
  hunger: { en: ["full", "peckish", "hungry", "starving"], zh: ["饱饱的", "有点饿", "饿了", "饿坏了"] },
  joy: { en: ["sad", "low", "happy", "joyful"], zh: ["难过", "闷闷的", "开心", "超开心"] },
  energy: { en: ["exhausted", "tired", "fine", "rested"], zh: ["累瘫了", "有点累", "还好", "精神足"] },
  clean: { en: ["filthy", "dusty", "tidy", "spotless"], zh: ["脏兮兮", "灰扑扑", "干净", "闪闪亮"] },
  time: { en: ["night", "morning", "day", "evening"], zh: ["夜里", "早上", "白天", "傍晚"] },
  action: {
    en: ["nothing", "fed", "played with", "bathed", "lights off", "petted", "medicine", "talked to"],
    zh: ["没动静", "被喂", "被陪玩", "洗澡", "关灯", "被摸摸", "吃药", "被说话"],
  },
  event: { en: ["all quiet", "friend near", "toy near", "something scary"], zh: ["安安静静", "朋友在旁边", "玩具在旁边", "有可怕的东西"] },
  owner: { en: ["you're away", "you're here"], zh: ["你不在", "你在身边"] },
};

/** The same pins as they read during a spar (see @lingxi/game spar.ts). */
export const FIGHT_VALUE_NAMES: Record<string, Names> = {
  hunger: { en: ["full health", "hurt", "badly hurt", "nearly out"], zh: ["体力满满", "受了伤", "伤得不轻", "快撑不住"] },
  joy: { en: ["losing ground", "even", "ahead", "on a roll"], zh: ["处于下风", "势均力敌", "占了上风", "势如破竹"] },
  energy: { en: ["no stamina", "low stamina", "some stamina", "fresh"], zh: ["没力气了", "力气不多", "还有力气", "精力充沛"] },
  clean: { en: ["foe nearly out", "foe hurt", "foe steady", "foe healthy"], zh: ["对手快不行了", "对手受了伤", "对手还稳", "对手很健康"] },
  time: { en: ["night", "opening", "middle", "late"], zh: ["夜里", "开局", "中盘", "尾声"] },
  // the other pet's last move, as the fight sends it from LX-SPAR/2 on (spar2.ts moveAsAction): a care rule that reads
  // "lights off" reads "foe rested" in a spar (B2)
  action: {
    en: ["foe tapped", "foe snacked", "foe pounced", "foe guarded", "foe rested", "foe charmed", "foe dodged", "foe gave a gift"],
    zh: ["对手轻拍", "对手吃零食", "对手扑击", "对手防守", "对手休息", "对手卖萌", "对手闪避", "对手送礼"],
  },
  event: { en: ["nothing new", "foe was friendly", "foe left an opening", "just hit hard"], zh: ["没什么变化", "对手很友好", "对手露出破绽", "刚被重击"] },
  owner: { en: ["no cheering", "you're cheering"], zh: ["没人加油", "你在加油"] },
};

export const MOVE_NAMES: Names = {
  en: ["tap", "snack", "pounce", "rest", "dodge", "guard", "charm", "gift"],
  zh: ["轻拍", "吃零食", "扑击", "休息", "闪避", "防守", "卖萌", "送礼"],
};

const MEMORY_NAMES: Record<string, { en: string; zh: string }> = {
  trust: { en: "trust", zh: "信任" },
  likesToys: { en: "likes toys", zh: "喜欢玩具" },
  scared: { en: "still shaken", zh: "还在害怕" },
  awake: { en: "awake long", zh: "醒了很久" },
};

export const WANT_NAMES: Names = {
  en: ["rest", "eat", "play", "sleep", "explore", "sulk", "cuddle", "share"],
  zh: ["发呆", "吃东西", "玩", "睡觉", "到处看看", "闹别扭", "撒娇", "分享"],
};
export const MOOD_NAMES: Names = { en: ["grumpy", "calm", "happy", "excited"], zh: ["不高兴", "平静", "开心", "兴奋"] };

export interface RuleChips {
  when: string[];
  then: string;
  /** the behaviour chosen, which picks its colour (see WANT_COLORS) */
  want: number;
}

/**
 * One colour per behaviour, used wherever a decision appears: the mind, the
 * thinking strip, teaching, the rewind. Soft enough to carry dark ink text.
 */
export const WANT_COLORS = ["#D9D1E6", "#FFB38A", "#FFD45E", "#A9BEF2", "#9BDDA6", "#C9A6DD", "#FFB3C7", "#8ED8D2"] as const;

function memoryChip(p: Program, name: string, values: number[], lang: Lang): string {
  const m = p.memory.find((x) => x.name === name);
  const label = MEMORY_NAMES[name]?.[lang] ?? m?.label ?? name;
  if (!m) return label;
  if (m.kind === "flag") return values.includes(1) ? label : lang === "zh" ? `不${label}` : `not ${label}`;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo === hi ? `${label} ${lo}` : `${label} ${lo}–${hi}`;
}

export function chipsFor(p: Program, r: Rule | { when: Record<string, number[]>; then: Out }, lang: Lang, fight = false): RuleChips {
  const when = Object.entries(r.when).map(([k, values]) => {
    const names = (fight ? FIGHT_VALUE_NAMES : VALUE_NAMES)[k];
    if (names) {
      const all = names[lang];
      if (values.length === all.length - 1 && all.length > 2) {
        const missing = all.findIndex((_, i) => !values.includes(i));
        return lang === "zh" ? `不${all[missing]}` : `not ${all[missing]}`;
      }
      return values.map((v) => all[v] ?? String(v)).join(lang === "zh" ? "/" : " or ");
    }
    return memoryChip(p, k, values, lang);
  });
  return { when, then: (fight ? MOVE_NAMES : WANT_NAMES)[lang][r.then.want] ?? "", want: r.then.want };
}

/** The rule that decided the last beat, or the program's default. */
export function decidingChips(p: Program, ruleIndex: number, lang: Lang, fight = false): RuleChips {
  const r = ruleIndex >= 0 ? p.rules[ruleIndex] : undefined;
  if (r) return chipsFor(p, r, lang, fight);
  return { when: [lang === "zh" ? "没有特别的事" : "nothing special"], then: (fight ? MOVE_NAMES : WANT_NAMES)[lang][p.otherwise.want] ?? "", want: p.otherwise.want };
}

export const FIELD_COUNT = INPUT_FIELDS.length;
