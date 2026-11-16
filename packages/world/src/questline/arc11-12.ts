/**
 * Arc 11, Builders' Lane, and arc 12, Growing up (36-QUEST-LINE.md §3). Builders' Lane residents give their own
 * quests (giver `lane:<id>`), handed in at their card on the lane. The pet gives arc 12. Quests that need another
 * player keep a solo path (36 §6), named in the objective.
 */

import type { QuestDef } from "../story";
import { T, anyOf, coins, decor, done, ever, flag, from, item, obj, piece, say, story } from "./helpers";

const quest = (n: number, arc: number, giver: string, requires: Parameters<typeof story>[0]["requires"], q: Omit<Parameters<typeof story>[0], "id" | "arc" | "giver" | "requires">): QuestDef =>
  story({ id: `q${String(n).padStart(2, "0")}`, arc, giver, requires: requires ?? [], ...q });

export const ARC_11_12: QuestDef[] = [
  // ── Arc 11. Builders' Lane ──
  quest(72, 11, "lane:behemoth", [ever("MEET", "behemoth", 1)], {
    title: T("Count with me", "跟我数"),
    intro: [say(undefined, "1, 2, 3, 5, 8… Stay and watch me count all the way to 13. It's the biggest I can hold.", "1、2、3、5、8……留下来看我一直数到 13。那是我能装下的最大的数。")],
    outro: [say(undefined, "13! You saw it. Wear my lamps; they're stuck at 13 for you.", "13！你看见了。戴上我的灯吧，它们为你一直停在 13。")],
    objectives: [obj(from("EVENT", "lane-count", 1), "Watch Behemoth count to 13", "看巨兽数到 13")],
    rewards: [coins(15), piece("b:lamps13")],
  }),
  quest(73, 11, "lane:behemoth", [done("q72")], {
    title: T("Check it yourself", "自己验"),
    intro: [say(undefined, "Don't take my word for it. Press the button and ask BNB Chain what I should say next.", "别光听我说。按那个按钮，问问 BNB Chain 我下一步该说什么。")],
    outro: [say(undefined, "Same lamps, same memory. Nobody can unplug me, and nobody can fake me either.", "一样的灯，一样的记忆。没人能拔掉我的电源，也没人能伪造我。")],
    objectives: [obj(from("EVENT", "lane-checked", 1), "Check one of Behemoth's steps on BNB Chain", "在 BNB Chain 上核对巨兽的一步")],
    rewards: [coins(25), flag("verifier"), item(1103)],
  }),
  quest(74, 11, "lane:mars", [ever("MEET", "mars", 1)], {
    title: T("Did you TapeOut today?", "今天你 TapeOut 了吗"),
    intro: [say(undefined, "Did you TapeOut today? Save a day on X Layer, then come and tell me.", "今天，你 TapeOut 了吗？在 X Layer 上保存一天，然后来告诉我。")],
    outro: [say(undefined, "👀 gBEM! Here, my spare telescope. Watch the sky with me.", "👀 gBEM！给，我备用的望远镜。陪我一起看天空。")],
    objectives: [obj(from("SAVE", undefined, 1), "Save a day on X Layer", "在 X Layer 上保存一天"), obj(from("MEET", "mars", 1), "Then visit Little Mars", "然后去看小火星")],
    rewards: [coins(25), piece("b:telescope")],
  }),
  quest(75, 11, "lane:tapboy", [ever("MEET", "tapboy", 1)], {
    title: T("One day at a time", "一天一天来"),
    intro: [say(undefined, "GMGM! I count my days out of a thousand. Come and see me on three different days.", "GMGM！我在数一千天里的第几天。在三个不同的日子来看我。")],
    outro: [say(undefined, "Three days. Shut out the noise, focus on now. Take a handheld; it's how I study.", "三天了。摒弃杂音，专注当下。拿个掌机吧，我就是用它修炼的。")],
    objectives: [obj(from("DISTINCT", "MEET_DAY:tapboy", 3), "Visit Tapboy on 3 different days", "在 3 个不同的日子去看掌机仔")],
    rewards: [coins(30), piece("b:handheld")],
  }),
  quest(76, 11, "lane:builder", [ever("MEET", "builder", 1)], {
    title: T("It's the product", "做产品"),
    intro: [say(undefined, "Ignore the noise. Make five things at the workbench, then come back. On we go.", "别管噪音。在工作台做五样东西，然后回来。继续干。")],
    outro: [say(undefined, "It's the product, period. Builders attract builders. Here's your hard hat.", "It's the product, period. 建设者吸引建设者。这是你的安全帽。")],
    objectives: [obj(from("CRAFT", undefined, 5), "Make 5 things at the workbench", "在工作台做 5 样东西"), obj(from("MEET", "builder", 1), "Then visit Hardhat", "然后去看安全帽")],
    rewards: [coins(35), piece("b:hardhat")],
  }),

  // ── Arc 12. Growing up (from your pet) ──
  quest(77, 12, "pet", [done("q11")], {
    title: T("My first friend", "第一个朋友"),
    intro: [say("shy", "I want a friend. A real one, who knows my name.", "我想要一个朋友。真正的朋友，知道我名字的那种。"), say("happy", "Let me play with a friend's pet until we're friends, or take me to meet three pets on Builders' Lane.", "让我和朋友的宠物一起玩到成为朋友，或者带我去见建设者小路上的三只宠物。")],
    outro: [say("love", "A friend! Can we keep a picture? I want to remember this.", "一个朋友！我们能留张照片吗？我想记住这一刻。")],
    objectives: [obj(anyOf(ever("BOND", undefined, 2), from("DISTINCT", "MEET", 3)), "Become friends with a friend's pet, or meet 3 pets on Builders' Lane", "和朋友的宠物成为朋友，或认识建设者小路上的 3 只宠物")],
    rewards: [coins(30), decor("photo")],
  }),
  quest(78, 12, "pet", [done("q11")], {
    title: T("All grown up", "长大了"),
    intro: [say("proud", "I'm getting bigger. Look. No, look properly.", "我在长大。你看。不对，好好看。")],
    outro: [say("love", "Grown up. I kept a piece of my shell from when I hatched. It's for you.", "长大了。我留着一片刚孵出来时的蛋壳。送给你。")],
    objectives: [obj(ever("STAGE", undefined, 3), "Raise your pet to adulthood", "把宠物养到成年")],
    rewards: [coins(60), decor("eggshell")],
  }),
  quest(79, 12, "pet", [done("q11")], {
    title: T("A week together", "在一起一周"),
    intro: [say("happy", "A whole week of days kept on X Layer. Seven of them. Can we?", "在 X Layer 上留住整整一周。七天。可以吗？")],
    outro: [say("sparkly", "Seven days, kept for good. Our home needs a name plate now.", "七天，永远留下了。我们家现在需要一块门牌了。")],
    objectives: [obj(ever("SAVE", undefined, 7), "Save 7 days on X Layer", "在 X Layer 上保存 7 天")],
    rewards: [coins(80), decor("nameplate"), item(11313)],
  }),
  quest(80, 12, "pet", [done("q78")], {
    title: T("Family", "一家人"),
    intro: [say("shy", "Some pets have families. A little one, or a brother or sister to share the house with.", "有些宠物有家人。一个小宝宝，或者一个可以一起住的兄弟姐妹。"), say("love", "Welcome a little one with a friend, or raise a second pet of your own.", "和朋友一起迎来一个小宝宝，或者再养一只属于你自己的宠物。")],
    outro: [say("sparkly", "A family. Let's hang a portrait so everyone who visits can see.", "一家人。我们挂一幅全家福吧，让来的人都能看到。")],
    objectives: [obj(anyOf(from("EVENT", "child-born", 1), ever("PETS", undefined, 2)), "Welcome a little one, or raise a second pet", "迎来一个小宝宝，或再养一只宠物")],
    rewards: [coins(80), decor("portrait")],
  }),
];
