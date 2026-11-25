/** Why as a friend (plan 4.3; P7: out of friends/residents.ts): what they love, like and turn down, what they
 * say to a gift, and the seven steps of the friendship. */
import type { FriendSheet } from "../../friendship";
import { T, friend, say, topic } from "../helpers";
import { SHOP, LEARN } from "./shared";

const W = { smile: "nurse_smiling.png", lecture: "nurse_lecturing.png", cradle: "nurse_cradling.png" };

export const WHY: FriendSheet = friend({
  id: "why",
  kind: "resident",
  likes: { love: [11404, 11221], like: [1112, 11004, 11411], dislike: [11303] },
  reactions: {
    love: say(
      W.cradle,
      "Calm Tea! You've been listening. Mm-hm. That's the whole of medicine, really.",
      "安神茶！你一直在听。嗯嗯。说到底，医术就是这个。",
    ),
    like: say(
      W.smile,
      "How thoughtful. I'll put it in the cabinet for a pet who needs it.",
      "真贴心。我把它放进柜子里，留给需要的宠物。",
    ),
    neutral: say(
      W.smile,
      "Thank you, dear. Everything finds a use in a clinic.",
      "谢谢你，亲爱的。诊所里什么都用得上。",
    ),
    dislike: say(
      W.lecture,
      "Pom-pom candy. Do you know how many teeth I've seen ruined? Keep it, and brush.",
      "绒球果糖。你知道我见过多少颗被它毁掉的牙吗？你留着吧，记得刷牙。",
    ),
  },
  steps: {
    s1: {
      title: T("Why a nurse", "为什么当护士"),
      lines: [
        say(
          W.smile,
          "You bring your pet in even when it's well. I like that. Let me tell you how I started.",
          "你的宠物没病也带来看。我喜欢这样。我讲讲我是怎么开始的。",
        ),
      ],
      unlock: topic(T("How I started", "我是怎么开始的"), [
        {
          face: W.cradle,
          en: "My first patient was a pet nobody else would sit up with. I sat up. It got better.",
          zh: "我第一个病人，是一只没人愿意守夜的宠物。我守了。它好起来了。",
        },
        { face: W.smile, en: "Most of nursing is staying. The rest is tea.", zh: "护理的大半就是陪着。剩下的是茶。" },
      ]),
    },
    s2: {
      title: T("A spare dose", "多余的一剂"),
      lines: [
        say(
          W.smile,
          "Calm Tea, from my own pot. For nights when your pet won't settle.",
          "我自己那壶泡的安神茶。宠物睡不安稳的夜里用。",
        ),
      ],
      unlock: { kind: "gift", rewards: [{ kind: "item", item: 11404, n: 1 }] },
    },
    s3a: {
      choice: SHOP,
      title: T("The clinic's tea", "诊所的茶"),
      lines: [
        say(
          W.smile,
          "Then the clinic will sell you Calm Tea at cost. Nurse's orders.",
          "那诊所就按成本卖你安神茶。护士的嘱咐。",
        ),
      ],
      unlock: { kind: "shelf", item: 11404, price: 35 },
    },
    s3b: {
      choice: LEARN,
      title: T("Brewing calm", "泡出安宁"),
      lines: [
        say(
          W.lecture,
          "Daffodil drops and a little poppy ink. A little. I'm watching you measure.",
          "水仙露加一点罂粟墨。一点点。我看着你称。",
        ),
      ],
      unlock: { kind: "recipe", index: 20010 },
    },
    s4: {
      title: T("The hard night", "难熬的那一夜"),
      lines: [
        say(
          W.cradle,
          "You've seen me tired. You may as well know about the hardest night.",
          "你见过我累的样子。不如告诉你最难熬的那一夜。",
        ),
      ],
      unlock: topic(T("The hardest night", "最难熬的一夜"), [
        {
          face: W.cradle,
          en: "Three pets at once, and one bed. I held one, sang to one, and the third sang back.",
          zh: "同时来了三只宠物，只有一张床。我抱着一只，给一只唱歌，第三只跟着唱了起来。",
        },
        {
          face: W.smile,
          en: "By morning all three were asleep on me. I didn't move until noon.",
          zh: "到早上三只都在我身上睡着了。我一直没动，直到中午。",
        },
      ]),
    },
    s5: {
      title: T("A home check-up", "上门检查"),
      lines: [
        say(
          W.lecture,
          "I make house calls for friends. I'll come and see how your pet lives.",
          "朋友我会上门看诊。我去看看你的宠物住得怎么样。",
        ),
      ],
      unlock: {
        kind: "visit",
        rewards: [{ kind: "decor", id: "heart" }],
        lines: [
          say(
            W.smile,
            "Clean, warm, loved. A perfect check-up. Here, a heart for the wall.",
            "干净，温暖，被爱着。检查满分。给，一颗贴在墙上的心。",
          ),
        ],
      },
    },
    s6: {
      title: T("Hearts for the eyes", "眼里的心"),
      lines: [
        say(
          W.cradle,
          "Wear these. Then everyone can see what I see when I look at the two of you.",
          "戴上这个。这样大家都能看到我看你们俩时看到的。",
        ),
        say(
          W.cradle,
          "I've checked on your pet a hundred times. I never once had to worry. That's you.",
          "我给你的宠物检查过一百次，一次都没担心过。这是你的功劳。",
        ),
        say(
          W.cradle,
          "Wear these on a gloomy day. Doctor's orders: look at it all with a little love.",
          "阴沉的日子戴上它。医嘱：用一点点爱去看一切。",
        ),
      ],
      unlock: { kind: "gift", rewards: [{ kind: "piece", id: "hearts" }] },
    },
  },
});
