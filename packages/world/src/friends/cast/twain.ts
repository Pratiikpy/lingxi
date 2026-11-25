/** Twain as a friend (plan 4.3; P7: out of friends/residents.ts): what they love, like and turn down, what they
 * say to a gift, and the seven steps of the friendship. */
import type { FriendSheet } from "../../friendship";
import { T, friend, say, topic } from "../helpers";
import { SHOP, LEARN } from "./shared";

const D = { frown: "twain_frown.png", laugh: "twain_laugh.png" };

export const TWAIN: FriendSheet = friend({
  id: "twain",
  kind: "resident",
  likes: { love: [6006, 11202], like: [11201, 1107, 1007], dislike: [11302] },
  reactions: {
    love: say(
      D.laugh,
      "A Spark of Thought! Both of us want it. We will share. Probably. Heh.",
      "思之树！我们俩都想要。我们会分享的。大概吧。嘿。",
    ),
    like: say(D.laugh, "One head says thank you. The other says it's about time.", "一个头说谢谢。另一个说早该送了。"),
    neutral: say(
      D.frown,
      "We'll study it. Then we'll argue about what we learned.",
      "我们会研究它。然后为学到了什么吵一架。",
    ),
    dislike: say(
      D.frown,
      "A burger. Neither of us has the stomach. We have two heads and no stomach.",
      "汉堡。我们俩都没胃口。我们有两个头，可没有胃。",
    ),
  },
  steps: {
    s1: {
      title: T("Two heads, one name", "两个头，一个名字"),
      lines: [
        say(
          D.laugh,
          "You ask the right questions. We'll answer one about ourselves. Only one.",
          "你问的问题都问在点上。我们回答一个关于自己的。只回答一个。",
        ),
      ],
      unlock: topic(T("Two heads, one name", "两个头，一个名字"), [
        {
          face: D.frown,
          en: "We were two keepers once. The Wheel needed one. We disagreed about who.",
          zh: "我们以前是两个守护者。轮之殿只需要一个。我们对是谁意见不一。",
        },
        {
          face: D.laugh,
          en: "So we became one, and we still disagree. It keeps the Wheel honest.",
          zh: "于是我们合成了一个，至今还在争。这让轮子保持公正。",
        },
      ]),
    },
    s2: {
      title: T("Candy for the curious", "给好奇者的糖"),
      lines: [
        say(
          D.laugh,
          "Wisdom Candy. One for each of your heads. You have only one? Then eat both.",
          "智慧糖。一个头一颗。你只有一个头？那就两颗都吃。",
        ),
      ],
      unlock: { kind: "gift", rewards: [{ kind: "item", item: 11201, n: 2 }] },
    },
    s3a: {
      choice: SHOP,
      title: T("Better candy, for a price", "更好的糖，要付钱"),
      lines: [
        say(
          D.frown,
          "We'll sell you the stronger candy. One head wanted to give it away. The other won.",
          "我们卖你更浓的糖。一个头想白送，另一个赢了。",
        ),
      ],
      unlock: { kind: "shelf", item: 11202, price: 45 },
    },
    s3b: {
      choice: LEARN,
      title: T("Doubling the candy", "糖加倍"),
      lines: [
        say(
          D.laugh,
          "Two Wisdom Candies and a pinch of sparkle make one stronger one. Like us, in reverse.",
          "两颗智慧糖加一撮闪粉，做成一颗更浓的。跟我们正好反过来。",
        ),
      ],
      unlock: { kind: "recipe", index: 20007 },
    },
    s4: {
      title: T("Who wrote the contract", "合约是谁写的"),
      lines: [
        say(
          D.frown,
          "You've asked us who wrote the Wheel's contract. Fine. A hint, and only a hint.",
          "你问过我们轮之殿的合约是谁写的。好吧，给个提示，只给提示。",
        ),
      ],
      unlock: topic(T("Who wrote the contract", "合约是谁写的"), [
        {
          face: D.frown,
          en: "Whoever wrote it wrote it so that nobody, not even them, could change it afterwards.",
          zh: "不管是谁写的，都写得让任何人，包括他们自己，事后都改不了。",
        },
        {
          face: D.laugh,
          en: "Which is the only kind of author worth trusting. Read it yourself; it's all there.",
          zh: "这才是唯一值得信任的作者。你自己去读，全都写在那儿。",
        },
      ]),
    },
    s5: {
      title: T("Two guests at once", "一次来两位客人"),
      lines: [
        say(
          D.laugh,
          "We will visit your home. Both of us. Make room for two opinions.",
          "我们去你家做客。我们俩都去。给两种意见留点地方。",
        ),
      ],
      unlock: {
        kind: "visit",
        rewards: [{ kind: "decor", id: "books" }],
        lines: [
          say(
            D.laugh,
            "We brought books. One of us chose them; the other says read them backwards.",
            "我们带了书。一个挑的书，另一个说要倒着读。",
          ),
        ],
      },
    },
    s6: {
      title: T("Glasses for seeing twice", "看两遍的眼镜"),
      lines: [
        say(
          D.laugh,
          "Wear these and look at everything twice, as we do. You'll miss half as much.",
          "戴上它，什么都看两遍，像我们一样。你会少错过一半。",
        ),
        say(
          D.laugh,
          "One lens to read the book, the other to read the reader. I learned that late.",
          "一片镜片读书，另一片读读书的人。这个我学得晚了。",
        ),
        say(
          D.laugh,
          "Look at your pet through them. You'll see it is learning you back.",
          "透过它看你的宠物。你会发现它也在学你。",
        ),
      ],
      unlock: { kind: "gift", rewards: [{ kind: "piece", id: "glasses" }] },
    },
  },
});
