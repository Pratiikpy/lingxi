/** Nimbus as a friend (plan 4.3; P7: out of friends/residents.ts): what they love, like and turn down, what they
 * say to a gift, and the seven steps of the friendship. */
import type { FriendSheet } from "../../friendship";
import { T, friend, say, topic } from "../helpers";
import { SHOP, LEARN } from "./shared";

const L = { dream: "nimbus_daydreaming.png", smile: "nimbus_smiling.png" };

export const NIMBUS: FriendSheet = friend({
  id: "nimbus",
  kind: "resident",
  likes: { love: [21205, 11409], like: [1103, 11408, 21203], dislike: [1301] },
  reactions: {
    love: say(
      L.smile,
      "Rock candyfloss! It's a cloud you can eat. I'll dream about this tonight.",
      "棉花岩糖！是能吃的云。今晚我会梦到它的。",
    ),
    like: say(
      L.smile,
      "Oh, pretty. It'll look different in a dream, but I'll know it.",
      "哦，真漂亮。在梦里它会变个样子，但我认得出。",
    ),
    neutral: say(
      L.dream,
      "For me? I'll keep it under my pillow and see what happens.",
      "给我的？我把它放在枕头下，看看会发生什么。",
    ),
    dislike: say(
      L.dream,
      "A stone block. Too heavy to dream about. Keep it, please.",
      "一块石块。太重了，梦不动。你留着吧。",
    ),
  },
  steps: {
    s1: {
      title: T("What I dreamt", "我梦见了什么"),
      lines: [
        say(
          L.dream,
          "I dreamt about you last night. Do you want to hear? It was nice, mostly.",
          "我昨晚梦见你了。想听吗？大部分是好梦。",
        ),
      ],
      unlock: topic(T("Last night's dream", "昨晚的梦"), [
        {
          face: L.dream,
          en: "Your pet was tall as a lantern and spoke in colours. You understood every one.",
          zh: "你的宠物有灯笼那么高，用颜色说话。每一种你都听懂了。",
        },
        {
          face: L.smile,
          en: "When I woke up I thought: they will, one day. You'll see.",
          zh: "醒来时我想：总有一天会的。你等着瞧。",
        },
      ]),
    },
    s2: {
      title: T("Bottled sparkle", "瓶装的闪亮"),
      lines: [
        say(
          L.smile,
          "Sparkle Soda. It fizzes like a dream starting. For you.",
          "气泡汽水。冒泡的样子就像一个梦刚开始。给你。",
        ),
      ],
      unlock: { kind: "gift", rewards: [{ kind: "item", item: 11409, n: 1 }] },
    },
    s3a: {
      choice: SHOP,
      title: T("Rock candyfloss from the clouds", "云上的棉花岩糖"),
      lines: [
        say(
          L.smile,
          "Then I'll spin rock candyfloss for you whenever you like. It's how I spend my afternoons.",
          "那你想要的时候我就给你转棉花岩糖。我下午就是这么过的。",
        ),
      ],
      unlock: { kind: "shelf", item: 21205, price: 30 },
    },
    s3b: {
      choice: LEARN,
      title: T("Spinning clouds", "纺云"),
      lines: [
        say(
          L.dream,
          "Sweet syrup and a little sparkle dust, spun until it forgets it was ever heavy.",
          "甜糖浆加一点闪粉，转到它忘了自己曾经很重。",
        ),
      ],
      unlock: { kind: "recipe", index: 20012 },
    },
    s4: {
      title: T("The recurring dream", "反复出现的梦"),
      lines: [
        say(
          L.dream,
          "There's one dream I keep having. You're the first I've told.",
          "有一个梦我总是做。你是我第一个告诉的人。",
        ),
      ],
      unlock: topic(T("The dream that comes back", "反复出现的梦"), [
        {
          face: L.dream,
          en: "A door at the end of the lane, and behind it every pet that ever lived, waving.",
          zh: "小路尽头有一扇门，门后是每一只活过的宠物，都在挥手。",
        },
        {
          face: L.smile,
          en: "I think the chain is that door. Nothing kept there is ever really gone.",
          zh: "我觉得链就是那扇门。存在那儿的，永远不会真的消失。",
        },
      ]),
    },
    s5: {
      title: T("A dreamer comes to call", "做梦的人来访"),
      lines: [
        say(
          L.smile,
          "I'll visit your home. I want to know what your pet dreams of.",
          "我去你家坐坐。我想知道你的宠物梦见什么。",
        ),
      ],
      unlock: {
        kind: "visit",
        rewards: [{ kind: "decor", id: "star" }],
        lines: [
          say(
            L.dream,
            "It dreams of you, of course. I brought a star, for the ceiling above its bed.",
            "它当然梦见你。我带了颗星星，挂在它床的上方。",
          ),
        ],
      },
    },
    s6: {
      title: T("A crown for dreamers", "做梦者的王冠"),
      lines: [
        say(
          L.smile,
          "Every dream I've had of you, you were wearing this. Now you can, awake.",
          "我梦里的你，每次都戴着它。现在醒着也能戴了。",
        ),
        say(
          L.smile,
          "Every cloud I've named, I named for someone who stopped to look up with me.",
          "我给每朵云起的名字，都是给那些停下来陪我抬头看的人。",
        ),
        say(
          L.smile,
          "There's one up there now with your pet's name. It's the round one. Obviously.",
          "现在天上有一朵叫你宠物的名字。圆的那朵。当然了。",
        ),
      ],
      unlock: { kind: "gift", rewards: [{ kind: "piece", id: "crown" }] },
    },
  },
});
