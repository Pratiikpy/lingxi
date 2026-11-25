/** Wick as a friend (plan 4.3; P7: out of friends/residents.ts): what they love, like and turn down, what they
 * say to a gift, and the seven steps of the friendship. */
import type { FriendSheet } from "../../friendship";
import { T, friend, say, topic } from "../helpers";
import { SHOP, LEARN } from "./shared";

const A = {
  calm: "wick.png",
  happy: "wick_happy.png",
  thinking: "wick_lost_in_thought.png",
  hands: "wick_clasping_hands.png",
};

export const WICK: FriendSheet = friend({
  id: "wick",
  kind: "resident",
  likes: { love: [1121, 11004], like: [1021, 11314, 1010], dislike: [1005] },
  reactions: {
    love: say(
      A.hands,
      "Glow! You noticed what keeps the lanterns going. Thank you, truly.",
      "是光！你发现了让灯一直亮着的东西。真的谢谢你。",
    ),
    like: say(
      A.happy,
      "Oh, that's lovely. It'll sit by the window where the light lands.",
      "哦，真好看。我把它放在光照得到的窗边。",
    ),
    neutral: say(
      A.calm,
      "For me? That's kind. Every gift here was given by someone for someone.",
      "给我的？你真好。这里每一件礼物，都是有人为别人准备的。",
    ),
    dislike: say(
      A.thinking,
      "Scrap near the lanterns is how fires start. Keep it, dear, and keep it far from me.",
      "铁片放在灯旁边可是会着火的。你留着吧，离我远点就好。",
    ),
  },
  steps: {
    s1: {
      title: T("Who lit the first lantern", "第一盏灯是谁点的"),
      lines: [
        say(
          A.thinking,
          "You keep coming back. Most only pass through. Sit, and I'll tell you about the first lantern.",
          "你总是回来。大多数人只是路过。坐吧，我给你讲讲第一盏灯。",
        ),
      ],
      unlock: topic(T("The first lantern", "第一盏灯"), [
        {
          face: A.thinking,
          en: "Nobody remembers who lit it. Only that it was lit for someone still out walking.",
          zh: "没人记得是谁点的。只记得那是为一个还在外面走路的人点的。",
        },
        {
          face: A.happy,
          en: "So now I light one for every pet still on its way home.",
          zh: "所以现在，每只还在回家路上的宠物，我都为它点一盏。",
        },
      ]),
    },
    s2: {
      title: T("A wick to spare", "多出来的灯芯"),
      lines: [
        say(
          A.happy,
          "Here, I made too much glow paste again. Paint a stone with it and see.",
          "给，我又做多了荧光膏。涂在石头上看看。",
        ),
      ],
      unlock: { kind: "gift", rewards: [{ kind: "item", item: 1121, n: 2 }] },
    },
    s3a: {
      choice: SHOP,
      title: T("Moon Tonic, any night", "随时都有月光补剂"),
      lines: [
        say(
          A.hands,
          "Then I'll keep a Moon Tonic aside for you. Ask whenever the night feels long.",
          "那我给你留一瓶月光补剂。夜晚太长的时候就来找我。",
        ),
      ],
      unlock: { kind: "shelf", item: 11004, price: 60 },
    },
    s3b: {
      choice: LEARN,
      title: T("How the tonic is made", "补剂是怎么做的"),
      lines: [
        say(
          A.thinking,
          "Glow paste and mint, stirred under the moon. Here, two of my glow roots to start you off.",
          "荧光膏加薄荷，在月光下搅匀。先拿我两根荧光根去试试。",
        ),
      ],
      unlock: { kind: "recipe", index: 20004, rewards: [{ kind: "item", item: 1021, n: 2 }] },
    },
    s4: {
      title: T("The lantern that went out", "熄灭的那盏灯"),
      lines: [
        say(
          A.thinking,
          "One lantern did go out, once. I'll tell you about it, if you'll listen.",
          "确实有一盏灯熄过一次。如果你愿意听，我讲给你。",
        ),
      ],
      unlock: topic(T("The lantern that went out", "熄灭的那盏灯"), [
        {
          face: A.thinking,
          en: "Its pet stopped coming home. I kept it lit for a whole winter anyway.",
          zh: "它的宠物不再回家了。我还是让它亮了整整一个冬天。",
        },
        {
          face: A.hands,
          en: "In spring the pet came back, thinner and very proud. That's why I never give up on one.",
          zh: "春天那只宠物回来了，瘦了，却很骄傲。所以我从不放弃任何一盏。",
        },
      ]),
    },
    s5: {
      title: T("A visit to your home", "去你家坐坐"),
      lines: [
        say(
          A.happy,
          "I'd like to see where your lantern hangs. I'll come by your home.",
          "我想看看你家的灯挂在哪儿。我去你家坐坐。",
        ),
      ],
      unlock: {
        kind: "visit",
        rewards: [{ kind: "decor", id: "fern" }],
        lines: [
          say(
            A.happy,
            "So this is home. Warm. I brought a fern; it likes a lantern's light.",
            "原来这就是你的家。很暖。我带了一盆蕨，它喜欢灯光。",
          ),
        ],
      },
    },
    s6: {
      title: T("A lantern of your own", "属于你的灯"),
      lines: [
        say(
          A.hands,
          "You've lit as many evenings as I have. Carry this one; it's yours to keep lit.",
          "你点亮的夜晚和我一样多了。拿着这盏灯，由你来让它亮着。",
        ),
        say(
          A.hands,
          "You'll forget to light it some nights. That's allowed. A lantern waits.",
          "有些晚上你会忘了点它。没关系。灯会等你。",
        ),
        say(
          A.hands,
          "And when your pet is old and slow, it will still find its way home by this one.",
          "等你的宠物老了、走慢了，它还是能跟着这盏灯找到家。",
        ),
      ],
      unlock: { kind: "gift", rewards: [{ kind: "piece", id: "lantern" }] },
    },
  },
});
