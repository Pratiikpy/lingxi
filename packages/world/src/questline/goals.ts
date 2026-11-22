/**
 * The community goals (plan 4.10): four at once, one for each thing the chain can count, over the same two weeks.
 * Targets are set for the players Lingxi has, so each goal can be finished by a small town working together; the
 * tiers pay along the way, so a goal that falls short still pays for what was done.
 */

import type { GoalDef } from "../goals";
import { T, coins, decor, item, say } from "./helpers";

const START = Date.UTC(2026, 10, 17) / 1000; // 17 November 2026, 00:00 UTC
const END = Date.UTC(2026, 11, 1) / 1000; // 1 December 2026, 00:00 UTC

/** The first round: the four goals, their stories and keepsakes as first told. */
const ROUND_ONE: readonly GoalDef[] = [
  {
    id: "g1",
    title: T("A lantern for every night", "每个夜晚一盏灯"),
    giver: "wick",
    story: [
      say("wick_lost_in_thought.png", "Every day a pet keeps on X Layer is a lantern that never goes out. I'd like the whole lane lit.", "宠物在 X Layer 上留住的每一天，都是一盏不会熄灭的灯。我想把整条路都点亮。"),
      say("wick_clasping_hands.png", "One hundred and fifty days kept, by all of us together, before the first of December.", "十二月一日之前，大家一起留住一百五十天。"),
    ],
    metric: "saves",
    target: 150,
    unit: T("days saved", "天已保存"),
    start: START,
    end: END,
    tiers: {
      25: [coins(30), item(1121, 2)],
      50: [coins(40), item(11405)],
      75: [coins(60), decor("lantern")],
      100: [coins(80), decor("star")],
    },
    everyone: { text: T("Every lantern on the lane stays lit, and everyone gets a Moon Tonic.", "整条路的灯都亮着，每个人都能得到一瓶月光补剂。"), rewards: [item(11004)] },
  },
  {
    id: "g2",
    title: T("Room for little ones", "给小家伙们留个位置"),
    giver: "why",
    story: [
      say("nurse_smiling.png", "New eggs keep me busy, and I love it. Let's welcome forty new pets to X Layer.", "新蛋让我忙个不停，我很喜欢。让我们在 X Layer 上迎来四十只新宠物。"),
      say("nurse_lecturing.png", "A new pet counts once it has been saved on three different days, for whoever it was hatched for. Bring a friend, and help them keep theirs.", "新宠物保存满三个不同的日子，才算在它的主人名下。带个朋友来，帮他们把自己的那只养下去。"),
    ],
    metric: "hatched",
    target: 40,
    unit: T("new pets", "只新宠物"),
    start: START,
    end: END,
    tiers: {
      25: [coins(30), item(11312, 2)],
      50: [coins(40), item(11404)],
      75: [coins(60), decor("pillow")],
      100: [coins(80), decor("heart")],
    },
    everyone: { text: T("The clinic stocks up: everyone gets a Heart Crystal.", "诊所补满了货：每个人都能得到一颗心之水晶。"), rewards: [item(11221)] },
  },
  {
    id: "g3",
    title: T("Families on the lane", "小路上的一家家"),
    giver: "nimbus",
    story: [
      say("nimbus_daydreaming.png", "I dreamt the lane was full of little ones, each with two pets who chose each other.", "我梦见小路上满是小家伙，每一个都有两只彼此选择的宠物。"),
      say("nimbus_smiling.png", "Ten children born on X Layer before December. Let's make the dream true.", "十二月前在 X Layer 上出生十个孩子。让这个梦成真吧。"),
    ],
    metric: "children",
    target: 10,
    unit: T("children born", "个孩子出生"),
    start: START,
    end: END,
    tiers: {
      25: [coins(30), item(11130, 2)],
      50: [coins(40), item(11408)],
      75: [coins(60), decor("bunting")],
      100: [coins(80), decor("flowers")],
    },
    everyone: { text: T("A lane full of families: everyone gets a Cherry Sundae to share.", "满是家庭的小路：每个人都能得到一份樱桃圣代来分享。"), rewards: [item(21203)] },
  },
  {
    id: "g4",
    title: T("Feed the forge", "给熔炉添火"),
    giver: "bolt",
    story: [
      say("bolt_clear2.png", "Every BEM spent on a new outfit or a child is burned for good. Beep. I keep count.", "买新衣服或生孩子花的每一个 BEM 都会被永久烧掉。哔。我在记数。"),
      say("bolt_clear1.png", "Two BEM burned by all of us, before December. Nothing is wasted; it just warms the forge.", "十二月前大家一起烧掉两个 BEM。没有浪费，它只是让熔炉更暖。"),
    ],
    metric: "burned",
    target: 200_000_000, // 2 BEM, 8 decimals
    unit: T("BEM burned", "BEM 已烧掉"),
    start: START,
    end: END,
    tiers: {
      25: [coins(30), item(1303, 2)],
      50: [coins(40), item(1103, 3)],
      75: [coins(60), decor("crystal")],
      100: [coins(80), decor("globe")],
    },
    everyone: { text: T("The forge glows: everyone gets a bag of Sparkle Dust.", "熔炉亮起来了：每个人都能得到一袋闪粉。"), rewards: [item(1103, 5)] },
  },
];

/**
 * G4: the goals keep a monthly rhythm. After the first round, the same four goals start again on the first of each
 * month for a year, each round its own goal (its own id, window and claims), told by the same giver. Their rewards are
 * coins and things for the bag; the home pieces and the on-chain keepsakes belong to the first round.
 */
export const LATER_ROUNDS = 12;
const ROUND_LINES: Readonly<Record<string, { face: string; en: string; zh: string }>> = {
  g1: { face: "wick_clasping_hands.png", en: "A new month, and the lantern count starts again. Shall we light the lane once more?", zh: "新的一个月，灯又从头数起。我们再把整条路点亮一次好吗？" },
  g2: { face: "nurse_smiling.png", en: "A new month of new eggs. Let's welcome another crowd of pets together.", zh: "又一个月的新蛋。我们一起再迎来一群新宠物吧。" },
  g3: { face: "nimbus_smiling.png", en: "A new month, and the sky has room for more little families. Let's fill the lane again.", zh: "新的一个月，天上还容得下更多小家庭。我们再把小巷填满吧。" },
  g4: { face: "bolt_clear2.png", en: "The forge cooled overnight. A new month: let's warm it up again. Beep.", zh: "熔炉一夜就凉了。新的一个月：我们再把它烧暖。哔。" },
};
const ROUND_TIERS = (g: GoalDef): GoalDef["tiers"] => ({ 25: [coins(30)], 50: [coins(40), item(11405)], 75: [coins(60)], 100: [coins(80), ...g.everyone.rewards] });
const monthStart = (k: number): number => Date.UTC(2026, 11 + k, 1) / 1000;

function laterRound(g: GoalDef, k: number): GoalDef {
  const line = ROUND_LINES[g.id]!;
  return {
    ...g,
    id: `${g.id}-${k + 2}`,
    story: [say(line.face, line.en, line.zh)],
    start: monthStart(k),
    end: monthStart(k + 1),
    tiers: ROUND_TIERS(g),
  };
}

export const GOALS: readonly GoalDef[] = [...ROUND_ONE, ...Array.from({ length: LATER_ROUNDS }, (_, k) => ROUND_ONE.map((g) => laterRound(g, k))).flat()];

/** The round running at a moment (seconds), or the last one to end when none is; and when the next round begins. */
export function goalRoundAt(nowSec: number): { goals: GoalDef[]; next: number | null } {
  const running = GOALS.filter((g) => g.start <= nowSec && nowSec < g.end);
  const ended = GOALS.filter((g) => g.end <= nowSec);
  const lastEnd = Math.max(0, ...ended.map((g) => g.end));
  const goals = running.length ? running : ended.filter((g) => g.end === lastEnd);
  const upcoming = GOALS.filter((g) => g.start > nowSec).map((g) => g.start);
  return { goals: goals.length ? goals : GOALS.filter((g) => g.start === Math.min(...GOALS.map((x) => x.start))), next: upcoming.length ? Math.min(...upcoming) : null };
}

export const GOAL_BY_ID: Readonly<Record<string, GoalDef>> = Object.fromEntries(GOALS.map((g) => [g.id, g]));
