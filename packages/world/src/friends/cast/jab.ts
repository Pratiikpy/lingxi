/** Jab as a friend (plan 4.3; P7: out of friends/residents.ts): what they love, like and turn down, what they
 * say to a gift, and the seven steps of the friendship. */
import type { FriendSheet } from "../../friendship";
import { T, friend, say, topic } from "../helpers";
import { SHOP, LEARN } from "./shared";

const AR = {
  grin: "jab_default_1.png",
  shock: "jab_shocked_1.png",
  shrug: "jab_shrug_1.png",
  fierce: "jab_scary_1.png",
};

export const JAB: FriendSheet = friend({
  id: "jab",
  kind: "resident",
  likes: { love: [11302, 21202], like: [11304, 7202, 11233], dislike: [11404] },
  reactions: {
    love: say(
      AR.grin,
      "A burger! Fuel for champions! You're my favourite challenger, and I've said that to no one. Today.",
      "汉堡！冠军的燃料！你是我最喜欢的挑战者，今天我还没对别人这么说过。",
    ),
    like: say(AR.grin, "Ha! Good snack. Training snack. I approve.", "哈！好零食。训练零食。我批准了。"),
    neutral: say(AR.shrug, "Huh. Thanks! I'll put it by the trophies.", "嗯。谢啦！我把它放在奖杯旁边。"),
    dislike: say(
      AR.shock,
      "Calm Tea? Calm? Before a spar? Never! Take it back!",
      "安神茶？安神？切磋前喝？绝不！拿回去！",
    ),
  },
  steps: {
    s1: {
      title: T("The first trophy", "第一座奖杯"),
      lines: [
        say(
          AR.grin,
          "You keep coming to spars. Good. Let me show you the first trophy in this room.",
          "你一直来切磋。很好。给你看看这屋里的第一座奖杯。",
        ),
      ],
      unlock: topic(T("The first trophy", "第一座奖杯"), [
        {
          face: AR.shrug,
          en: "It's a bent spoon. A pet won it by doing nothing for sixteen rounds. The other one gave up.",
          zh: "是一把弯勺子。一只宠物十六回合什么都没做就赢了。另一只放弃了。",
        },
        { face: AR.grin, en: "Patience is a move. Teach it.", zh: "耐心也是一招。教给它。" },
      ]),
    },
    s2: {
      title: T("Training lunch", "训练午餐"),
      lines: [
        say(AR.grin, "Here. A burger. A trained pet is a fed pet.", "给。一个汉堡。练过的宠物，得是吃饱的宠物。"),
      ],
      unlock: { kind: "gift", rewards: [{ kind: "item", item: 11302, n: 1 }] },
    },
    s3a: {
      choice: SHOP,
      title: T("Burgers at the arena", "竞技场汉堡"),
      lines: [
        say(
          AR.grin,
          "Then you can buy burgers here before a spar. Champion's price!",
          "那切磋前你可以在这儿买汉堡。冠军价！",
        ),
      ],
      unlock: { kind: "shelf", item: 11302, price: 25 },
    },
    s3b: {
      choice: LEARN,
      title: T("Grill like a coach", "像教练一样烤"),
      lines: [
        say(
          AR.fierce,
          "Pepper and rice, grilled hot and fast. Like a good opening move.",
          "辣椒加米，大火快烤。就像一个好的开局。",
        ),
      ],
      unlock: { kind: "recipe", index: 20011 },
    },
    s4: {
      title: T("The spar I lost", "我输掉的那场"),
      lines: [
        say(
          AR.shrug,
          "Everyone asks about wins. You've earned the loss I'm proudest of.",
          "大家都问赢的。你值得听我最骄傲的那场输。",
        ),
      ],
      unlock: topic(T("The spar I lost", "我输掉的那场"), [
        {
          face: AR.shock,
          en: "My pet was faster, stronger, better taught. It lost to a pet that only knew how to be kind.",
          zh: "我的宠物更快、更强、教得更好。却输给了一只只会温柔的宠物。",
        },
        {
          face: AR.grin,
          en: "Kindness confused every move I'd taught. I've coached differently since.",
          zh: "温柔打乱了我教的每一招。从那以后我换了教法。",
        },
      ]),
    },
    s5: {
      title: T("A coach at your door", "教练上门"),
      lines: [
        say(
          AR.grin,
          "I'll come and see your pet train at home. No pressure! Some pressure.",
          "我去你家看看宠物怎么在家练习。没压力！有一点点压力。",
        ),
      ],
      unlock: {
        kind: "visit",
        rewards: [{ kind: "decor", id: "ball" }],
        lines: [
          say(
            AR.grin,
            "Good home! Needs a ball. Every champion's home has a ball. Here!",
            "家不错！就差个球。每个冠军家里都有个球。给！",
          ),
        ],
      },
    },
    s6: {
      title: T("A champion's laurel", "冠军的桂冠"),
      lines: [
        say(
          AR.fierce,
          "You didn't win it in a spar. You won it by showing up. Wear it!",
          "这不是你切磋赢来的。是你一次次来赢来的。戴上！",
        ),
        say(
          AR.fierce,
          "I've coached a lot of pets. Yours listens. That's rarer than winning.",
          "我教过很多宠物。你的会听。这比赢还难得。",
        ),
        say(
          AR.fierce,
          "The laurel isn't for winning, it's for coming back after losing. You always did.",
          "桂冠不是给赢的，是给输了还回来的。你每次都回来了。",
        ),
      ],
      unlock: { kind: "gift", rewards: [{ kind: "piece", id: "laurel" }] },
    },
  },
});
