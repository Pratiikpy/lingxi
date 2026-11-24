/**
 * Arc 1, First days (36-QUEST-LINE.md §3): the pet itself asks, one action per quest, each line names the button,
 * and each reward is the thing the next lesson uses (after the source's first main quests, note A §7). These
 * eleven are the onboarding: each carries a hint that points at the control.
 */

import type { QuestDef } from "../story";
import { T, coins, decor, done, flag, from, item, obj, recipe, say, story } from "./helpers";

const pet = (
  n: number,
  prev: string | null,
  q: Omit<Parameters<typeof story>[0], "id" | "arc" | "giver" | "requires">,
): QuestDef =>
  story({ id: `q${String(n).padStart(2, "0")}`, arc: 1, giver: "pet", requires: prev ? [done(prev)] : [], ...q });

export const ARC_1: QuestDef[] = [
  pet(1, null, {
    title: T("Hello, little one", "你好呀"),
    intro: [
      say("shy", "Hi… is that you? Your hand is warm.", "嗨……是你吗？你的手好暖。"),
      say("happy", "Would you pat me? Just tap me, right here.", "能摸摸我吗？就在这儿，点我一下。"),
    ],
    outro: [
      say(
        "love",
        "Three pats! I'll remember those. I'm writing them down somewhere inside.",
        "摸了三下！我会记住的。我把它们记在心里的某个地方了。",
      ),
    ],
    objectives: [obj(from("CARE", "pet", 3), "Pat your pet 3 times", "摸摸宠物 3 次")],
    rewards: [coins(10), item(11312), flag("diary")],
    hint: "pet",
  }),
  pet(2, "q01", {
    title: T("First meal", "第一顿饭"),
    intro: [
      say("munch", "My tummy is making a noise. Do you hear it?", "我的肚子在叫。你听见了吗？"),
      say("happy", "Press Feed and pick something from the bag. Anything!", "点“喂食”，从背包里挑一样。什么都行！"),
    ],
    outro: [
      say("munch", "Yum. Now I know what that tastes like.", "好吃。现在我知道它是什么味道了。"),
      say(
        "happy",
        "Here, for next time. Different foods grow me in different ways.",
        "给你，下次用。吃不同的东西，我会长成不同的样子。",
      ),
    ],
    objectives: [obj(from("CARE", "feed", 1), "Feed your pet", "喂宠物吃一次")],
    rewards: [coins(10), item(11110)],
    hint: "feed",
  }),
  pet(3, "q02", {
    title: T("Squeaky clean", "香喷喷"),
    intro: [
      say(
        "sad",
        "I rolled in something. I think it was mud. I hope it was mud.",
        "我在什么东西上打了个滚。应该是泥巴吧。希望是泥巴。",
      ),
      say("shy", "Bath time? The Clean button.", "洗个澡？点“清洁”。"),
    ],
    outro: [say("sparkly", "Squeaky! Smell me. No, really, smell me.", "香喷喷！闻闻我。真的，闻闻嘛。")],
    objectives: [obj(from("CARE", "clean", 1), "Give your pet a bath", "给宠物洗个澡")],
    rewards: [coins(10), item(1112)],
    hint: "clean",
  }),
  pet(4, "q03", {
    title: T("Playtime", "一起玩"),
    intro: [
      say("happy", "I have so much bounce in me. Let's play!", "我浑身都是劲。我们来玩吧！"),
      say("sparkly", "Press Play and pick a game.", "点“玩耍”，挑一个游戏。"),
    ],
    outro: [say("love", "Again! Again tomorrow. Here, a ball for the house.", "再来！明天再来。给，家里放个球。")],
    objectives: [obj(from("CARE", "play", 1), "Play with your pet once", "陪宠物玩一次")],
    rewards: [coins(10), decor("ball")],
    hint: "play",
  }),
  pet(5, "q04", {
    title: T("Lights out", "晚安"),
    intro: [
      say("yawn", "My eyes keep closing on their own…", "我的眼睛自己就闭上了……"),
      say(
        "sleepy",
        "Turn the lights off with Sleep, and wake me when you're back.",
        "点“睡觉”关灯，等你回来再叫醒我。",
      ),
    ],
    outro: [
      say(
        "happy",
        "I dreamt about you. You were very big. Here's a little lamp for the dark.",
        "我梦见你了。你好大好大。给你一盏小灯，夜里用。",
      ),
    ],
    objectives: [
      obj(from("CARE", "sleep", 1), "Put your pet to sleep", "让宠物睡觉"),
      obj(from("CARE", "wake", 1), "Wake it up again", "再把它叫醒"),
    ],
    rewards: [coins(15), decor("mushroom")],
    hint: "sleep",
  }),
  pet(6, "q05", {
    title: T("Next door", "隔壁"),
    intro: [
      say("startled", "There's a light outside the door. Someone lives there!", "门外有光。那里住着人！"),
      say("happy", "Open the map and walk to the Lantern Room?", "打开地图，走去灯笼屋好吗？"),
    ],
    outro: [
      say("sparkly", "A lantern keeper! She said I can come back any time.", "一位守灯人！她说我随时都可以回来。"),
    ],
    objectives: [obj(from("VISIT", 64, 1), "Visit the Lantern Room next door", "去隔壁的灯笼屋")],
    rewards: [coins(5)],
    hint: "map",
  }),
  pet(7, "q06", {
    title: T("Look closely", "仔细找找"),
    intro: [
      say(
        "neutral",
        "Every place hides little things. Pebbles, sticks, sometimes treasure.",
        "每个地方都藏着小东西。小石子、小树枝，有时候还有宝贝。",
      ),
      say("happy", "Press Look around wherever we stop.", "不管在哪儿停下，点“四处找找”。"),
    ],
    outro: [
      say(
        "proud",
        "We found it! Two smooth pebbles, a box from the river, and an old screwdriver someone left.",
        "我们找到了！两颗光滑的小石子、一个河里漂来的盒子，还有一把别人落下的旧螺丝刀。",
      ),
    ],
    objectives: [obj(from("FORAGE", undefined, 1), "Look around once", "四处找找一次")],
    // the pebbles and the screwdriver make sure the next quest can be done at once: a pebble and the screwdriver make a stone cup
    rewards: [coins(10), item(1002, 2), item(21007), item(23102)],
    hint: "look",
  }),
  pet(8, "q07", {
    title: T("Handmade", "亲手做的"),
    intro: [
      say("neutral", "What if we made something? The workbench is in the bag.", "要不我们做点东西？工作台在背包里。"),
      say(
        "happy",
        "A pebble and the screwdriver make a stone cup. Anything counts!",
        "一颗小石子加螺丝刀就能做一个石杯。做什么都算！",
      ),
    ],
    outro: [
      say(
        "sparkly",
        "We made a thing that wasn't there before! Here's a recipe I heard about on the wind.",
        "我们做出了一样原来没有的东西！这是我在风里听到的一个配方。",
      ),
    ],
    objectives: [obj(from("CRAFT", undefined, 1), "Make one thing at the workbench", "在工作台做一样东西")],
    rewards: [coins(15), recipe(20003)],
    hint: "bag",
  }),
  pet(9, "q08", {
    title: T("Sweet shop", "糖果店"),
    intro: [
      say(
        "munch",
        "I can smell sugar from here. It's coming from the Corner Shop.",
        "我在这儿都闻到糖味了。是从街角小店飘过来的。",
      ),
      say("happy", "Can we buy one thing? Just one.", "我们能买一样东西吗？就一样。"),
    ],
    outro: [
      say(
        "love",
        "Praline wrapped it in paper with a little bow. Here, this one is yours.",
        "糖霜用纸包好，还系了个小蝴蝶结。给，这个给你。",
      ),
    ],
    objectives: [obj(from("BUY", undefined, 1), "Buy one thing in a shop", "在商店买一样东西")],
    rewards: [coins(10), item(11303)],
    hint: "map",
  }),
  pet(10, "q09", {
    title: T("First lesson", "第一课"),
    intro: [
      say("neutral", "I want to learn something. Something from you.", "我想学点东西。学你教的东西。"),
      say(
        "happy",
        "Open Teach and give me one rule: when this happens, do that.",
        "打开“教导”，教我一条规则：遇到这个，就做那个。",
      ),
    ],
    outro: [
      say(
        "proud",
        "It's in me now. A few new gates, all mine. Here, a candy for studying.",
        "它已经在我心里了。几个新的小门，全是我的。给，一颗学习糖。",
      ),
    ],
    objectives: [obj(from("LESSON", undefined, 1), "Teach your pet one lesson", "教宠物一课")],
    rewards: [coins(20), item(11201)],
    hint: "teach",
  }),
  pet(11, "q10", {
    title: T("Kept forever", "永远留住"),
    intro: [
      say("shy", "Will you remember today? I want today to last.", "你会记得今天吗？我想让今天一直留着。"),
      say(
        "happy",
        "Save one day on X Layer and it's kept for good, where anyone can check it.",
        "在 X Layer 上保存一天，它就会永远留下，谁都能核对。",
      ),
    ],
    outro: [
      say(
        "sparkly",
        "Kept. Forever and ever. There's a page with my saved day on it now.",
        "留住了。永永远远。现在有一个页面，上面是我保存下来的这一天。",
      ),
    ],
    objectives: [obj(from("SAVE", undefined, 1), "Save one day on X Layer", "在 X Layer 上保存一天")],
    rewards: [coins(30), flag("first-day")],
    hint: "keep",
  }),
];

/** The first eleven teach a new player; arc 1 starts at home. */
export const ONBOARDING = ARC_1.map((q) => q.id);
