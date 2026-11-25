/** Yonder as a friend (plan 4.3; P7: out of friends/residents.ts): what they love, like and turn down, what they
 * say to a gift, and the seven steps of the friendship. */
import type { FriendSheet } from "../../friendship";
import { T, friend, say, topic } from "../helpers";
import { SHOP, LEARN } from "./shared";

const Z = { day: "yonder_day.png", pose: "yonder_pose_2.png", night: "yonder_night.png" };

export const YONDER: FriendSheet = friend({
  id: "yonder",
  kind: "resident",
  likes: { love: [1019, 11405], like: [1004, 1104, 1015], dislike: [11303] },
  reactions: {
    love: say(Z.pose, "A coin from far away. You've been further than you let on.", "远方的硬币。你走得比你说的还远。"),
    like: say(Z.day, "Good find. The trail rewards people who look down.", "找得好。路只奖励低头看的人。"),
    neutral: say(Z.day, "For the road. Thanks.", "路上用得着。谢了。"),
    dislike: say(
      Z.night,
      "Candy rots the teeth of people who walk for a living. Keep it.",
      "糖会坏了靠走路吃饭的人的牙。你留着吧。",
    ),
  },
  steps: {
    s1: {
      title: T("Why the gate", "为什么守着鸟居"),
      lines: [
        say(
          Z.pose,
          "You keep finding me at the gate. You may as well know why I stand here.",
          "你总在鸟居找到我。不如告诉你我为什么站在这儿。",
        ),
      ],
      unlock: topic(T("Why the gate", "为什么守着鸟居"), [
        {
          face: Z.day,
          en: "Every road in this world passes this gate at least once. So everyone comes to me, sooner or later.",
          zh: "这个世界的每条路都至少经过这道门一次。所以人人迟早都会来找我。",
        },
        { face: Z.night, en: "And when they don't come back, I go looking.", zh: "要是他们没回来，我就去找。" },
      ]),
    },
    s2: {
      title: T("A spare coin", "一枚备用的硬币"),
      lines: [
        say(
          Z.day,
          "Wayfinders trade in old coins. Here's one to start your own collection.",
          "引路人拿古钱币做交易。给你一枚，开始你自己的收藏。",
        ),
      ],
      unlock: {
        kind: "gift",
        rewards: [
          { kind: "item", item: 1015, n: 1 },
          { kind: "item", item: 1104, n: 200 },
        ],
      },
    },
    s3a: {
      choice: SHOP,
      title: T("A Lucky Tea for the road", "路上的好运茶"),
      lines: [
        say(
          Z.pose,
          "Then come to me before a long walk. I always carry one Lucky Tea more than I need.",
          "那每次远行前来找我。我总比需要的多带一壶好运茶。",
        ),
      ],
      unlock: { kind: "shelf", item: 11405, price: 40 },
    },
    s3b: {
      choice: LEARN,
      title: T("Brewing luck", "冲泡好运"),
      lines: [
        say(
          Z.day,
          "Daffodil drops and pine pollen, steeped while you watch the road. Luck likes attention.",
          "水仙露加松花粉，一边看路一边泡。好运喜欢被留意。",
        ),
      ],
      unlock: { kind: "recipe", index: 20006 },
    },
    s4: {
      title: T("The one I couldn't find", "我没找到的那个"),
      lines: [
        say(
          Z.night,
          "You've earned the hard story. There was one I never found.",
          "你值得听那个难讲的故事。有一个，我始终没找到。",
        ),
      ],
      unlock: topic(T("The one I couldn't find", "我没找到的那个"), [
        {
          face: Z.night,
          en: "A small pet who followed the river past the last map. I walked for a month.",
          zh: "一只小宠物沿着河走出了地图的尽头。我走了一个月。",
        },
        {
          face: Z.day,
          en: "I like to think it found a better gate. That's why I teach every pet the way home.",
          zh: "我宁愿相信它找到了一道更好的门。所以我教每只宠物认回家的路。",
        },
      ]),
    },
    s5: {
      title: T("A wayfinder at your door", "引路人来敲门"),
      lines: [
        say(
          Z.pose,
          "I'll walk to your home sometime. I like to know where everyone's door is.",
          "哪天我走到你家去。我喜欢知道每个人的门在哪儿。",
        ),
      ],
      unlock: {
        kind: "visit",
        rewards: [{ kind: "decor", id: "mushroom" }],
        lines: [
          say(
            Z.day,
            "Found it on the first try. A mushroom lamp, so I can find it at night too.",
            "一次就找到了。送你一盏蘑菇灯，这样晚上我也找得到。",
          ),
        ],
      },
    },
    s6: {
      title: T("A wayfinder's flag", "引路人的旗"),
      lines: [
        say(
          Z.pose,
          "Plant this wherever you've been. Others will know the way is walkable.",
          "走到哪儿就把它插在哪儿。别人就知道那条路走得通。",
        ),
        say(
          Z.pose,
          "Every road I mapped, I mapped so someone could come back along it.",
          "我画的每一条路，都是为了让人能沿着它回来。",
        ),
        say(
          Z.pose,
          "Plant this where the lane forks. Then I'll always know which way you went.",
          "把它插在小巷分岔的地方。这样我总能知道你往哪边走了。",
        ),
      ],
      unlock: { kind: "gift", rewards: [{ kind: "piece", id: "flag" }] },
    },
  },
});
