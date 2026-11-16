/**
 * The daily pool (36-QUEST-LINE.md §4): three a day, one care, one social, one explore. Each is a small gesture,
 * not a chore; each pays a little; any seven days with a daily done earn the weekly gift. Missing a day costs
 * nothing. Dailies count from the moment the day begins (story.ts rollDailies).
 */

import type { QuestDef, Reward } from "../story";
import { T, anyOf, coins, daily, from, item, obj, say } from "./helpers";

const d = (id: string, group: "care" | "social" | "explore", q: Omit<Parameters<typeof daily>[0], "id" | "group" | "giver">): QuestDef => daily({ id: `d-${id}`, group, giver: "pet", ...q });

export const DAILIES: QuestDef[] = [
  // ── care ──
  d("breakfast", "care", {
    title: T("Warm breakfast", "热乎乎的早饭"),
    intro: [say("munch", "Breakfast before noon? Something warm.", "中午前吃早饭好吗？要热乎乎的。")],
    outro: [say("happy", "A good start. Same time tomorrow?", "一个好的开始。明天同一时间？")],
    objectives: [obj(from("CARE", "feed-morning", 1), "Feed your pet in the morning", "上午喂一次宠物")],
    rewards: [coins(10)],
  }),
  d("bath", "care", {
    title: T("Bath day", "洗澡日"),
    intro: [say("shy", "It's bath day. I checked the calendar. I don't have a calendar.", "今天是洗澡日。我看过日历了。其实我没有日历。")],
    outro: [say("sparkly", "Fresh! Tomorrow I'll find something new to roll in.", "清爽！明天我再找点新东西打滚。")],
    objectives: [obj(from("CARE", "clean", 1), "Give your pet a bath", "给宠物洗个澡")],
    rewards: [coins(10)],
  }),
  d("pats", "care", {
    title: T("Three pats", "摸三下"),
    intro: [say("love", "Three pats today. I'll count.", "今天摸三下。我来数。")],
    outro: [say("love", "Three. Exactly the right number.", "三下。刚刚好。")],
    objectives: [obj(from("CARE", "pet", 3), "Pat your pet 3 times", "摸摸宠物 3 次")],
    rewards: [coins(10)],
  }),
  d("nap", "care", {
    title: T("Nap time", "午睡时间"),
    intro: [say("yawn", "A little nap today? Just a short one.", "今天睡个小午觉好吗？就一小会儿。")],
    outro: [say("happy", "Much better. Everything looks brighter after a nap.", "好多了。睡一觉起来，什么都亮堂了。")],
    objectives: [obj(from("CARE", "sleep", 1), "Let your pet nap", "让宠物睡一觉")],
    rewards: [coins(10)],
  }),
  d("game", "care", {
    title: T("A game a day", "每天一个游戏"),
    intro: [say("sparkly", "Play a game with me today. Any one!", "今天陪我玩个游戏吧。哪个都行！")],
    outro: [say("happy", "I won. Or you did. Either way, fun.", "我赢了。或者你赢了。反正很好玩。")],
    objectives: [obj(from("CARE", "play", 1), "Play with your pet", "陪宠物玩一次")],
    rewards: [coins(10)],
  }),
  // ── social ──
  d("hello", "social", {
    title: T("Say hello", "打个招呼"),
    intro: [say("happy", "Let's say hello to someone today. Anyone who lives around here.", "今天去跟人打个招呼吧。住在附近的谁都行。")],
    outro: [say("sparkly", "They said hello back!", "他们也跟我们打招呼了！")],
    objectives: [obj(from("TALK", undefined, 1), "Talk to any resident", "和任意一位居民说话")],
    rewards: [coins(12)],
  }),
  d("gift", "social", {
    title: T("A small gift", "小小礼物"),
    intro: [say("shy", "Can we give someone a little something today? From the bag.", "今天能送谁一点小东西吗？从背包里拿。")],
    outro: [say("love", "Their face! Giving is nice.", "看他们的表情！送东西真好。")],
    objectives: [obj(from("GIVE", undefined, 1), "Give a resident something from your bag", "从背包里送居民一样东西")],
    rewards: [coins(12)],
  }),
  d("friend", "social", {
    title: T("Visit a friend", "看望朋友"),
    intro: [say("happy", "I miss my friends. Can a friend's pet visit, or can we go and see the pets on Builders' Lane?", "我想朋友了。能让朋友的宠物来玩吗？或者我们去建设者小路看看那里的宠物？")],
    outro: [say("love", "That was the best part of today.", "这是今天最开心的事。")],
    objectives: [obj(anyOf(from("EVENT", "visited-by-friend", 1), from("MEET", undefined, 1)), "A friend's pet visits, or you visit Builders' Lane", "朋友的宠物来玩，或者你去建设者小路")],
    rewards: [coins(12)],
  }),
  d("behemoth", "social", {
    title: T("Check on Behemoth", "去看看巨兽"),
    intro: [say("neutral", "I wonder what number Behemoth is on right now.", "不知道巨兽现在数到几了。")],
    outro: [say("happy", "Still counting. It never gets tired.", "还在数。它从来不会累。")],
    objectives: [obj(from("MEET", "behemoth", 1), "Visit Behemoth on Builders' Lane", "去建设者小路看巨兽")],
    rewards: [coins(12)],
  }),
  d("diver", "social", {
    title: T("Tell Diver about today", "跟潜水员说说今天"),
    intro: [say("happy", "Let's tell Diver what we did today. Diver likes stories.", "我们去跟潜水员说说今天做了什么吧。潜水员喜欢听故事。")],
    outro: [say("sparkly", "Diver listened to every word.", "潜水员每个字都听了。")],
    objectives: [obj(from("MEET", "diver", 1), "Visit Diver on Builders' Lane", "去建设者小路看潜水员")],
    rewards: [coins(12)],
  }),
  // ── explore ──
  d("look", "explore", {
    title: T("Look around twice", "找两次"),
    intro: [say("neutral", "Two places, two looks. Something is hiding today.", "两个地方，找两次。今天有东西藏着。")],
    outro: [say("proud", "Found! Treasure, or close enough.", "找到了！是宝贝，或者差不多算是。")],
    objectives: [obj(from("FORAGE", undefined, 2), "Look around twice", "四处找找 2 次")],
    rewards: [coins(10)],
  }),
  d("walk", "explore", {
    title: T("A short walk", "散散步"),
    intro: [say("happy", "A short walk? My legs want to go.", "散一小会儿步好吗？我的腿想出门。")],
    outro: [say("happy", "Good walk. I counted the trees. I lost count.", "走得真好。我数了树。数着数着就忘了。")],
    objectives: [obj(from("WALK", undefined, 1), "Take a walk", "散一次步")],
    rewards: [coins(12)],
  }),
  d("rooms", "explore", {
    title: T("Somewhere new, somewhere old", "新地方，老地方"),
    intro: [say("neutral", "Three rooms today. Somewhere new, or somewhere we love.", "今天走三个房间。新的地方，或者我们喜欢的老地方。")],
    outro: [say("happy", "Three! My paws are happy.", "三个！我的爪子很开心。")],
    objectives: [obj(from("MOVE", undefined, 3), "Walk through 3 rooms", "走过 3 个房间")],
    rewards: [coins(10)],
  }),
  d("evening", "explore", {
    title: T("Evening air", "傍晚的风"),
    intro: [say("neutral", "The air smells different in the evening. Can we be outside for a bit?", "傍晚的空气闻起来不一样。我们能在外面待一会儿吗？")],
    outro: [say("love", "Orange sky. Thank you for staying.", "橘色的天空。谢谢你陪着我。")],
    objectives: [obj(from("TOGETHER_WHEN", "evening-outside", 5), "Spend 5 evening minutes together outdoors", "傍晚在户外一起待 5 分钟")],
    rewards: [coins(12)],
  }),
  d("bring", "explore", {
    title: T("Bring something back", "带点东西回来"),
    intro: [say("sparkly", "Let's bring three things home today. From anywhere.", "今天带三样东西回家吧。从哪儿都行。")],
    outro: [say("proud", "Three things! The bag is getting heavy. Good.", "三样！背包越来越重了。很好。")],
    objectives: [obj(from("FIND", undefined, 3), "Find 3 things", "找到 3 样东西")],
    rewards: [coins(10)],
  }),
];

/** The weekly gift: one for every seven days with a daily done, any seven. */
// the Golden Box (plan 4.5) "for those who keep showing up": five Booster Packs and something rarer
export const WEEKLY_GIFT: readonly Reward[] = [coins(60), item(21007), item(11313), item(21008)];
