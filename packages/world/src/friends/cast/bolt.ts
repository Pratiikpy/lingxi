/** Bolt as a friend (plan 4.3; P7: out of friends/residents.ts): what they love, like and turn down, what they
 * say to a gift, and the seven steps of the friendship. */
import type { FriendSheet } from "../../friendship";
import { T, friend, say, topic } from "../helpers";
import { SHOP, LEARN } from "./shared";

const R = { one: "bolt_clear1.png", two: "bolt_clear2.png", three: "bolt_clear3.png" };

export const BOLT: FriendSheet = friend({
  id: "bolt",
  kind: "resident",
  likes: { love: [1303, 1017], like: [1005, 1302, 1301, 100009], dislike: [21201] },
  reactions: {
    love: say(
      R.two,
      "A metal bar! Beep. Sorry. Happy beep. I can make three things with this.",
      "金属条！哔。抱歉。是开心的哔。我能用它做三样东西。",
    ),
    like: say(R.one, "Useful. Everything's useful, but this is useful now.", "有用。什么都有用，但这个现在就有用。"),
    neutral: say(R.one, "Thank you. I'll find what it fixes.", "谢谢。我会找到它能修什么。"),
    dislike: say(
      R.three,
      "Ice cream in the gears. I have seen it happen. Please, no.",
      "冰淇淋掉进齿轮里。我亲眼见过。拜托，不要。",
    ),
  },
  steps: {
    s1: {
      title: T("Why the trees", "为什么在树下"),
      lines: [
        say(
          R.one,
          "You keep sitting with me under the trees. I'll tell you why I work out here.",
          "你总跟我坐在树下。我告诉你我为什么在这儿干活。",
        ),
      ],
      unlock: topic(T("Why the trees", "为什么在树下"), [
        {
          face: R.two,
          en: "Indoors, everything I fix stays fixed. Out here, the weather tests it. Better test.",
          zh: "在屋里，修好的东西就一直好着。在外面，风雨会考验它。这才是好测试。",
        },
        {
          face: R.one,
          en: "Also the birds bring me screws. I don't ask where from.",
          zh: "而且鸟会给我叼螺丝来。我从不问是从哪儿来的。",
        },
      ]),
    },
    s2: {
      title: T("Spare planks", "多余的木板"),
      lines: [
        say(
          R.one,
          "I over-ordered planks. Boop. Take two; build something crooked and be proud of it.",
          "木板订多了。噗。拿两块去，做点歪的东西，然后为它骄傲。",
        ),
      ],
      unlock: { kind: "gift", rewards: [{ kind: "item", item: 1302, n: 2 }] },
    },
    s3a: {
      choice: SHOP,
      title: T("Bars on order", "金属条随时有"),
      lines: [
        say(
          R.two,
          "Then I'll keep metal bars for you. Fair price. I melt them myself, very carefully.",
          "那我给你备着金属条。价格公道。我亲手熔的，非常小心。",
        ),
      ],
      unlock: { kind: "shelf", item: 1303, price: 30 },
    },
    s3b: {
      choice: LEARN,
      title: T("Melting scrap", "熔铁片"),
      lines: [
        say(
          R.three,
          "Twelve scrap, a low heat, and five bars. No burner needed. Don't stand downwind.",
          "十二片铁片，小火慢熔，出五根金属条。不用炉子。别站在下风口。",
        ),
      ],
      unlock: { kind: "recipe", index: 20008 },
    },
    s4: {
      title: T("Am I a robot", "我是不是机器人"),
      lines: [
        say(
          R.three,
          "You've asked if I'm a robot. You're a friend now, so I'll answer properly.",
          "你问过我是不是机器人。你现在是朋友了，我好好回答。",
        ),
      ],
      unlock: topic(T("The proper answer", "正经的回答"), [
        {
          face: R.one,
          en: "I don't know. I was built, or I grew. Either way I fix things, so either way is fine.",
          zh: "我不知道。我是被造出来的，或者是长出来的。反正我都在修东西，所以哪种都行。",
        },
        {
          face: R.two,
          en: "Your pet's mind is gates, too. We have more in common than you'd think. Beep.",
          zh: "你宠物的心也是一个个门。我们的共同点比你想的多。哔。",
        },
      ]),
    },
    s5: {
      title: T("A repair visit", "上门修理"),
      lines: [
        say(
          R.one,
          "I'll come check your home for squeaks. Every home squeaks somewhere.",
          "我去你家听听哪里吱吱响。每个家都有地方吱吱响。",
        ),
      ],
      unlock: {
        kind: "visit",
        rewards: [{ kind: "decor", id: "globe" }],
        lines: [
          say(
            R.two,
            "Fixed the squeak. Also built you a globe from the leftover parts. It spins. Mostly.",
            "吱吱声修好了。还用剩下的零件给你做了个地球仪。它会转，基本上。",
          ),
        ],
      },
    },
    s6: {
      title: T("Tinker's shades", "修补匠的墨镜"),
      lines: [
        say(
          R.two,
          "Welding shades. Now we're both very well organised and very cool.",
          "焊接墨镜。现在我们俩都非常有条理，也非常酷。",
        ),
        say(
          R.two,
          "These are the shades I wear when a thing finally works. I've worn them four times.",
          "这是东西终于修好时我戴的墨镜。我一共戴过四次。",
        ),
        say(
          R.two,
          "Now you can wear them when your pet does something clever. It will happen more than four times.",
          "现在你的宠物做了聪明事，你就可以戴上。肯定不止四次。",
        ),
      ],
      unlock: { kind: "gift", rewards: [{ kind: "piece", id: "shades" }] },
    },
  },
});
