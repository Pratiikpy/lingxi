/** Flit as a friend (plan 4.3; P7: out of friends/residents.ts): what they love, like and turn down, what they
 * say to a gift, and the seven steps of the friendship. */
import type { FriendSheet } from "../../friendship";
import { T, friend, say, topic } from "../helpers";
import { SHOP, LEARN } from "./shared";

const I = { only: "flit.png" };

export const FLIT: FriendSheet = friend({
  id: "flit",
  kind: "resident",
  likes: { love: [11314, 11312], like: [1011, 1012, 1013], dislike: [1006] },
  reactions: {
    love: say(
      I.only,
      "A blue pansy… the butterflies will come right to it. Thank you, quietly.",
      "一朵蓝色三色堇……蝴蝶会直接飞过来的。悄悄地谢谢你。",
    ),
    like: say(I.only, "Mm. Something for the garden. They'll like that.", "嗯。给花园的。它们会喜欢的。"),
    neutral: say(I.only, "…for me? Oh. Thank you. Shh, though.", "……给我的？哦。谢谢。不过，嘘。"),
    dislike: say(
      I.only,
      "A jar. That's how they get caught. I'd rather not, please.",
      "罐子。它们就是这样被抓走的。我还是不要了，谢谢。",
    ),
  },
  steps: {
    s1: {
      title: T("Where the butterflies go", "蝴蝶去了哪儿"),
      lines: [
        say(
          I.only,
          "You stay still well. Better than most. I'll tell you where they sleep.",
          "你很会保持安静。比大多数人都好。我告诉你它们在哪儿睡觉。",
        ),
      ],
      unlock: topic(T("Where the butterflies sleep", "蝴蝶在哪儿睡"), [
        {
          face: I.only,
          en: "Under the big leaves, wings shut, all facing the same way. Nobody told them to.",
          zh: "在大叶子底下，翅膀合着，全都朝着同一个方向。没人教过它们。",
        },
        { face: I.only, en: "Your pet would understand. It knows how to wait.", zh: "你的宠物会懂的。它懂得等待。" },
      ]),
    },
    s2: {
      title: T("Honeydrops", "蜜露"),
      lines: [
        say(
          I.only,
          "These fell from the hives. The bees said you could have them. I asked.",
          "这些是从蜂巢掉下来的。蜜蜂说可以给你。我问过了。",
        ),
      ],
      unlock: { kind: "gift", rewards: [{ kind: "item", item: 11312, n: 2 }] },
    },
    s3a: {
      choice: SHOP,
      title: T("A jar of honeydrops", "一罐蜜露"),
      lines: [
        say(
          I.only,
          "I'll save honeydrops for you. The bees agree, as long as you're gentle.",
          "我给你留着蜜露。蜜蜂也同意，只要你轻一点。",
        ),
      ],
      unlock: { kind: "shelf", item: 11312, price: 20 },
    },
    s3b: {
      choice: LEARN,
      title: T("Making honeydrops", "做蜜露"),
      lines: [
        say(
          I.only,
          "Tree honey and a daffodil, warmed in your hands. Slowly. Everything here is slowly.",
          "树蜜和一朵水仙，在手心里捂暖。慢慢来。这里的一切都要慢慢来。",
        ),
      ],
      unlock: { kind: "recipe", index: 20009 },
    },
    s4: {
      title: T("Why I whisper", "我为什么小声说话"),
      lines: [
        say(
          I.only,
          "You've wondered why I whisper. I'll tell you. Quietly.",
          "你一直好奇我为什么小声说话。我告诉你。小声地。",
        ),
      ],
      unlock: topic(T("Why I whisper", "我为什么小声说话"), [
        {
          face: I.only,
          en: "I was loud once. Everything flew away. Now I'm quiet, and the forest tells me things.",
          zh: "我以前很大声。所有东西都飞走了。现在我安静了，森林开始告诉我事情。",
        },
        {
          face: I.only,
          en: "…please don't eat me on the way out. That's a joke. I've been practising.",
          zh: "……出去的路上请别吃我。这是个笑话。我练习过的。",
        },
      ]),
    },
    s5: {
      title: T("A quiet visit", "安静的拜访"),
      lines: [
        say(
          I.only,
          "I'd like to see your home. I'll be very quiet. You won't hear me come in.",
          "我想去你家看看。我会很安静，你都听不见我进门。",
        ),
      ],
      unlock: {
        kind: "visit",
        rewards: [{ kind: "decor", id: "flowers" }],
        lines: [
          say(
            I.only,
            "I brought flowers. A butterfly followed me. It can stay, if you're still.",
            "我带了花。有只蝴蝶跟着我来了。你安静的话，它可以留下。",
          ),
        ],
      },
    },
    s6: {
      title: T("A sunflower to hold", "捧着的向日葵"),
      lines: [
        say(
          I.only,
          "Hold this out and stand still. They'll land on you. They trust you now. So do I.",
          "举着它，别动。它们会落在你身上。它们现在信任你了。我也是。",
        ),
        say(
          I.only,
          "Sunflowers turn to follow the light. Butterflies follow the sunflowers.",
          "向日葵跟着光转，蝴蝶跟着向日葵飞。",
        ),
        say(
          I.only,
          "Hold it up on a grey day and see who comes. Someone always does.",
          "阴天的时候举起来，看看谁会来。总会有谁来的。",
        ),
      ],
      unlock: { kind: "gift", rewards: [{ kind: "piece", id: "sunflower" }] },
    },
  },
});
