/** Praline as a friend (plan 4.3; P7: out of friends/residents.ts): what they love, like and turn down, what they
 * say to a gift, and the seven steps of the friendship. */
import type { FriendSheet } from "../../friendship";
import { T, friend, say, topic } from "../helpers";
import { SHOP, LEARN } from "./shared";

const M = { flat: "praline_default_1.png", laugh: "praline_laugh_1.png", pity: "praline_pity_1.png" };

export const PRALINE: FriendSheet = friend({
  id: "praline",
  kind: "resident",
  likes: { love: [11313, 11311], like: [11130, 11140, 11120, 1201], dislike: [1001] },
  reactions: {
    love: say(
      M.laugh,
      "A Golden Apple. You do know the way to a shopkeeper's heart. It's through the stock room.",
      "金苹果。你果然懂店主的心——要从库房进去。",
    ),
    like: say(
      M.flat,
      "Decent. I'll price it fairly and pretend I bought it.",
      "还不错。我会公道标价，就当是我进的货。",
    ),
    neutral: say(M.flat, "Thank you. It will go on a shelf. Most things do.", "谢谢。它会上架的。大部分东西都会。"),
    dislike: say(
      M.pity,
      "A stick. I have a forest outside for those. Keep it.",
      "一根树枝。外面整片树林都是这个。你留着吧。",
    ),
  },
  steps: {
    s1: {
      title: T("About Byakuya", "关于白夜"),
      lines: [
        say(
          M.flat,
          "You keep looking at the snake. Fine. I'll tell you about him, and then you'll stop.",
          "你一直在看那条蛇。好吧，我讲给你听，然后你就别看了。",
        ),
      ],
      unlock: topic(T("About Byakuya", "关于白夜"), [
        {
          face: M.flat,
          en: "Byakuya guards the till. He has never once been wrong about a customer.",
          zh: "白夜看着收银台。它看客人，从来没看走眼过。",
        },
        {
          face: M.laugh,
          en: "He likes you, which is suspicious. Don't pet him.",
          zh: "它喜欢你，这就很可疑了。别摸它。",
        },
      ]),
    },
    s2: {
      title: T("End-of-day mochi", "打烊剩下的麻薯"),
      lines: [
        say(
          M.pity,
          "These won't sell tomorrow. Take them before I feel generous about it.",
          "这些明天就卖不掉了。趁我还没心软，拿走吧。",
        ),
      ],
      unlock: { kind: "gift", rewards: [{ kind: "item", item: 11130, n: 2 }] },
    },
    s3a: {
      choice: SHOP,
      title: T("Taro Mochi under the counter", "柜台下的芋泥麻薯"),
      lines: [
        say(
          M.laugh,
          "Then you're a regular. Regulars get the Taro Mochi I keep under the counter.",
          "那你就是熟客了。熟客能买到我藏在柜台下的芋泥麻薯。",
        ),
      ],
      unlock: { kind: "shelf", item: 11110, price: 25 },
    },
    s3b: {
      choice: LEARN,
      title: T("Praline's mochi secret", "糖霜的麻薯秘诀"),
      lines: [
        say(
          M.flat,
          "Rice and syrup, pounded patiently. I'm teaching you because you'll never pound as well as me.",
          "米和糖浆，耐心地捣。我教你，是因为你永远捣不过我。",
        ),
      ],
      unlock: { kind: "recipe", index: 20005 },
    },
    s4: {
      title: T("Praline's investors", "糖霜的投资人"),
      lines: [
        say(
          M.flat,
          "You want to know who backs the shop. Everyone does. I'll tell you a little.",
          "你想知道是谁在给这家店撑腰。人人都想知道。我透露一点。",
        ),
      ],
      unlock: topic(T("Who backs the shop", "谁在撑这家店"), [
        {
          face: M.flat,
          en: "Old friends who believed a little shop could outlast a big market. So far, it has.",
          zh: "几位老朋友，他们相信小店能比大市场撑得久。到现在为止，确实如此。",
        },
        {
          face: M.laugh,
          en: "They're paid in mochi. It's the only currency that never falls.",
          zh: "我用麻薯给他们分红。这是唯一不会跌的货币。",
        },
      ]),
    },
    s5: {
      title: T("A house call", "上门拜访"),
      lines: [
        say(
          M.flat,
          "I'll close early one day and see your home. Inventory, you understand.",
          "哪天我早点关门，去你家看看。算是盘点，你懂的。",
        ),
      ],
      unlock: {
        kind: "visit",
        rewards: [{ kind: "decor", id: "rug" }],
        lines: [
          say(
            M.laugh,
            "Your floor was cold. I brought a rug. Not a gift; an improvement.",
            "你家地板太凉了。我带了块地毯。不是礼物，是改进。",
          ),
        ],
      },
    },
    s6: {
      title: T("Partner's bow", "合伙人的蝴蝶结"),
      lines: [
        say(
          M.laugh,
          "You've been more help than my investors. Wear this. It means you're in the business now.",
          "你帮的忙比我的投资人还多。戴上这个，意思是你入伙了。",
        ),
        say(M.laugh, "Byakuya chose you weeks ago. I'm only catching up.", "白夜几周前就选中你了。我只是现在才跟上。"),
        say(
          M.laugh,
          "Wear the bow when you come in. I'll pretend not to notice and give you the good price.",
          "来店里时戴着这个蝴蝶结。我会假装没看见，然后给你好价钱。",
        ),
      ],
      unlock: { kind: "gift", rewards: [{ kind: "piece", id: "bow" }] },
    },
  },
});
