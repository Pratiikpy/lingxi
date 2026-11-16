/**
 * The nine residents as friends (plan 4.3): what each loves, likes and turns down, what they say to a gift, and
 * the seven steps of each friendship. At level 3 each offers a choice: buy their special thing from their shelf
 * from then on, or learn to make it yourself. Either road leads on.
 */

import type { FriendSheet } from "../friendship";
import { T, friend, say, topic } from "./helpers";

const A = { calm: "wick.png", happy: "wick_happy.png", thinking: "wick_lost_in_thought.png", hands: "wick_clasping_hands.png" };
const M = { flat: "praline_default_1.png", laugh: "praline_laugh_1.png", pity: "praline_pity_1.png" };
const Z = { day: "yonder_day.png", pose: "yonder_pose_2.png", night: "yonder_night.png" };
const D = { frown: "twain_frown.png", laugh: "twain_laugh.png" };
const R = { one: "bolt_clear1.png", two: "bolt_clear2.png", three: "bolt_clear3.png" };
const I = { only: "flit.png" };
const W = { smile: "nurse_smiling.png", lecture: "nurse_lecturing.png", cradle: "nurse_cradling.png" };
const AR = { grin: "jab_default_1.png", shock: "jab_shocked_1.png", shrug: "jab_shrug_1.png", fierce: "jab_scary_1.png" };
const L = { dream: "nimbus_daydreaming.png", smile: "nimbus_smiling.png" };

const SHOP = T("Buy it from me", "以后从我这儿买");
const LEARN = T("Teach me to make it", "教我自己做");

export const RESIDENT_FRIENDS: readonly FriendSheet[] = [
  friend({
    id: "wick",
    kind: "resident",
    likes: { love: [1121, 11004], like: [1021, 11314, 1010], dislike: [1005] },
    reactions: {
      love: say(A.hands, "Glow! You noticed what keeps the lanterns going. Thank you, truly.", "是光！你发现了让灯一直亮着的东西。真的谢谢你。"),
      like: say(A.happy, "Oh, that's lovely. It'll sit by the window where the light lands.", "哦，真好看。我把它放在光照得到的窗边。"),
      neutral: say(A.calm, "For me? That's kind. Every gift here was given by someone for someone.", "给我的？你真好。这里每一件礼物，都是有人为别人准备的。"),
      dislike: say(A.thinking, "Scrap near the lanterns is how fires start. Keep it, dear, and keep it far from me.", "铁片放在灯旁边可是会着火的。你留着吧，离我远点就好。"),
    },
    steps: {
      s1: {
        title: T("Who lit the first lantern", "第一盏灯是谁点的"),
        lines: [say(A.thinking, "You keep coming back. Most only pass through. Sit, and I'll tell you about the first lantern.", "你总是回来。大多数人只是路过。坐吧，我给你讲讲第一盏灯。")],
        unlock: topic(T("The first lantern", "第一盏灯"), [
          { face: A.thinking, en: "Nobody remembers who lit it. Only that it was lit for someone still out walking.", zh: "没人记得是谁点的。只记得那是为一个还在外面走路的人点的。" },
          { face: A.happy, en: "So now I light one for every pet still on its way home.", zh: "所以现在，每只还在回家路上的宠物，我都为它点一盏。" },
        ]),
      },
      s2: {
        title: T("A wick to spare", "多出来的灯芯"),
        lines: [say(A.happy, "Here, I made too much glow paste again. Paint a stone with it and see.", "给，我又做多了荧光膏。涂在石头上看看。")],
        unlock: { kind: "gift", rewards: [{ kind: "item", item: 1121, n: 2 }] },
      },
      s3a: {
        choice: SHOP,
        title: T("Moon Tonic, any night", "随时都有月光补剂"),
        lines: [say(A.hands, "Then I'll keep a Moon Tonic aside for you. Ask whenever the night feels long.", "那我给你留一瓶月光补剂。夜晚太长的时候就来找我。")],
        unlock: { kind: "shelf", item: 11004, price: 60 },
      },
      s3b: {
        choice: LEARN,
        title: T("How the tonic is made", "补剂是怎么做的"),
        lines: [say(A.thinking, "Glow paste and mint, stirred under the moon. The moon part is optional. Don't tell anyone.", "荧光膏加薄荷，在月光下搅匀。月光那步可有可无，别告诉别人。")],
        unlock: { kind: "recipe", index: 20004 },
      },
      s4: {
        title: T("The lantern that went out", "熄灭的那盏灯"),
        lines: [say(A.thinking, "One lantern did go out, once. I'll tell you about it, if you'll listen.", "确实有一盏灯熄过一次。如果你愿意听，我讲给你。")],
        unlock: topic(T("The lantern that went out", "熄灭的那盏灯"), [
          { face: A.thinking, en: "Its pet stopped coming home. I kept it lit for a whole winter anyway.", zh: "它的宠物不再回家了。我还是让它亮了整整一个冬天。" },
          { face: A.hands, en: "In spring the pet came back, thinner and very proud. That's why I never give up on one.", zh: "春天那只宠物回来了，瘦了，却很骄傲。所以我从不放弃任何一盏。" },
        ]),
      },
      s5: {
        title: T("A visit to your home", "去你家坐坐"),
        lines: [say(A.happy, "I'd like to see where your lantern hangs. I'll come by your home.", "我想看看你家的灯挂在哪儿。我去你家坐坐。")],
        unlock: {
          kind: "visit",
          rewards: [{ kind: "decor", id: "fern" }],
          lines: [say(A.happy, "So this is home. Warm. I brought a fern; it likes a lantern's light.", "原来这就是你的家。很暖。我带了一盆蕨，它喜欢灯光。")],
        },
      },
      s6: {
        title: T("A lantern of your own", "属于你的灯"),
        lines: [say(A.hands, "You've lit as many evenings as I have. Carry this one; it's yours to keep lit.", "你点亮的夜晚和我一样多了。拿着这盏灯，由你来让它亮着。")],
        unlock: { kind: "gift", rewards: [{ kind: "piece", id: "lantern" }] },
      },
    },
  }),
  friend({
    id: "praline",
    kind: "resident",
    likes: { love: [11313, 11311], like: [11130, 11140, 11120, 1201], dislike: [1001] },
    reactions: {
      love: say(M.laugh, "A Golden Apple. You do know the way to a shopkeeper's heart. It's through the stock room.", "金苹果。你果然懂店主的心——要从库房进去。"),
      like: say(M.flat, "Decent. I'll price it fairly and pretend I bought it.", "还不错。我会公道标价，就当是我进的货。"),
      neutral: say(M.flat, "Thank you. It will go on a shelf. Most things do.", "谢谢。它会上架的。大部分东西都会。"),
      dislike: say(M.pity, "A stick. I have a forest outside for those. Keep it.", "一根树枝。外面整片树林都是这个。你留着吧。"),
    },
    steps: {
      s1: {
        title: T("About Byakuya", "关于白夜"),
        lines: [say(M.flat, "You keep looking at the snake. Fine. I'll tell you about him, and then you'll stop.", "你一直在看那条蛇。好吧，我讲给你听，然后你就别看了。")],
        unlock: topic(T("About Byakuya", "关于白夜"), [
          { face: M.flat, en: "Byakuya guards the till. He has never once been wrong about a customer.", zh: "白夜看着收银台。它看客人，从来没看走眼过。" },
          { face: M.laugh, en: "He likes you, which is suspicious. Don't pet him.", zh: "它喜欢你，这就很可疑了。别摸它。" },
        ]),
      },
      s2: {
        title: T("End-of-day mochi", "打烊剩下的麻薯"),
        lines: [say(M.pity, "These won't sell tomorrow. Take them before I feel generous about it.", "这些明天就卖不掉了。趁我还没心软，拿走吧。")],
        unlock: { kind: "gift", rewards: [{ kind: "item", item: 11130, n: 2 }] },
      },
      s3a: {
        choice: SHOP,
        title: T("Taro Mochi under the counter", "柜台下的芋泥麻薯"),
        lines: [say(M.laugh, "Then you're a regular. Regulars get the Taro Mochi I keep under the counter.", "那你就是熟客了。熟客能买到我藏在柜台下的芋泥麻薯。")],
        unlock: { kind: "shelf", item: 11110, price: 25 },
      },
      s3b: {
        choice: LEARN,
        title: T("Praline's mochi secret", "糖霜的麻薯秘诀"),
        lines: [say(M.flat, "Rice and syrup, pounded patiently. I'm teaching you because you'll never pound as well as me.", "米和糖浆，耐心地捣。我教你，是因为你永远捣不过我。")],
        unlock: { kind: "recipe", index: 20005 },
      },
      s4: {
        title: T("Praline's investors", "糖霜的投资人"),
        lines: [say(M.flat, "You want to know who backs the shop. Everyone does. I'll tell you a little.", "你想知道是谁在给这家店撑腰。人人都想知道。我透露一点。")],
        unlock: topic(T("Who backs the shop", "谁在撑这家店"), [
          { face: M.flat, en: "Old friends who believed a little shop could outlast a big market. So far, it has.", zh: "几位老朋友，他们相信小店能比大市场撑得久。到现在为止，确实如此。" },
          { face: M.laugh, en: "They're paid in mochi. It's the only currency that never falls.", zh: "我用麻薯给他们分红。这是唯一不会跌的货币。" },
        ]),
      },
      s5: {
        title: T("A house call", "上门拜访"),
        lines: [say(M.flat, "I'll close early one day and see your home. Inventory, you understand.", "哪天我早点关门，去你家看看。算是盘点，你懂的。")],
        unlock: {
          kind: "visit",
          rewards: [{ kind: "decor", id: "rug" }],
          lines: [say(M.laugh, "Your floor was cold. I brought a rug. Not a gift; an improvement.", "你家地板太凉了。我带了块地毯。不是礼物，是改进。")],
        },
      },
      s6: {
        title: T("Partner's bow", "合伙人的蝴蝶结"),
        lines: [say(M.laugh, "You've been more help than my investors. Wear this. It means you're in the business now.", "你帮的忙比我的投资人还多。戴上这个，意思是你入伙了。")],
        unlock: { kind: "gift", rewards: [{ kind: "piece", id: "bow" }] },
      },
    },
  }),
  friend({
    id: "yonder",
    kind: "resident",
    likes: { love: [1019, 11405], like: [1004, 1104, 1015], dislike: [11303] },
    reactions: {
      love: say(Z.pose, "A coin from far away. You've been further than you let on.", "远方的硬币。你走得比你说的还远。"),
      like: say(Z.day, "Good find. The trail rewards people who look down.", "找得好。路只奖励低头看的人。"),
      neutral: say(Z.day, "For the road. Thanks.", "路上用得着。谢了。"),
      dislike: say(Z.night, "Candy rots the teeth of people who walk for a living. Keep it.", "糖会坏了靠走路吃饭的人的牙。你留着吧。"),
    },
    steps: {
      s1: {
        title: T("Why the gate", "为什么守着鸟居"),
        lines: [say(Z.pose, "You keep finding me at the gate. You may as well know why I stand here.", "你总在鸟居找到我。不如告诉你我为什么站在这儿。")],
        unlock: topic(T("Why the gate", "为什么守着鸟居"), [
          { face: Z.day, en: "Every road in this world passes this gate at least once. So everyone comes to me, sooner or later.", zh: "这个世界的每条路都至少经过这道门一次。所以人人迟早都会来找我。" },
          { face: Z.night, en: "And when they don't come back, I go looking.", zh: "要是他们没回来，我就去找。" },
        ]),
      },
      s2: {
        title: T("A spare coin", "一枚备用的硬币"),
        lines: [say(Z.day, "Wayfinders trade in old coins. Here's one to start your own collection.", "引路人拿古钱币做交易。给你一枚，开始你自己的收藏。")],
        unlock: { kind: "gift", rewards: [{ kind: "item", item: 1015, n: 1 }, { kind: "item", item: 1104, n: 200 }] },
      },
      s3a: {
        choice: SHOP,
        title: T("A Lucky Tea for the road", "路上的好运茶"),
        lines: [say(Z.pose, "Then come to me before a long walk. I always carry one Lucky Tea more than I need.", "那每次远行前来找我。我总比需要的多带一壶好运茶。")],
        unlock: { kind: "shelf", item: 11405, price: 40 },
      },
      s3b: {
        choice: LEARN,
        title: T("Brewing luck", "冲泡好运"),
        lines: [say(Z.day, "Daffodil drops and pine pollen, steeped while you watch the road. Luck likes attention.", "水仙露加松花粉，一边看路一边泡。好运喜欢被留意。")],
        unlock: { kind: "recipe", index: 20006 },
      },
      s4: {
        title: T("The one I couldn't find", "我没找到的那个"),
        lines: [say(Z.night, "You've earned the hard story. There was one I never found.", "你值得听那个难讲的故事。有一个，我始终没找到。")],
        unlock: topic(T("The one I couldn't find", "我没找到的那个"), [
          { face: Z.night, en: "A small pet who followed the river past the last map. I walked for a month.", zh: "一只小宠物沿着河走出了地图的尽头。我走了一个月。" },
          { face: Z.day, en: "I like to think it found a better gate. That's why I teach every pet the way home.", zh: "我宁愿相信它找到了一道更好的门。所以我教每只宠物认回家的路。" },
        ]),
      },
      s5: {
        title: T("A wayfinder at your door", "引路人来敲门"),
        lines: [say(Z.pose, "I'll walk to your home sometime. I like to know where everyone's door is.", "哪天我走到你家去。我喜欢知道每个人的门在哪儿。")],
        unlock: {
          kind: "visit",
          rewards: [{ kind: "decor", id: "mushroom" }],
          lines: [say(Z.day, "Found it on the first try. A mushroom lamp, so I can find it at night too.", "一次就找到了。送你一盏蘑菇灯，这样晚上我也找得到。")],
        },
      },
      s6: {
        title: T("A wayfinder's flag", "引路人的旗"),
        lines: [say(Z.pose, "Plant this wherever you've been. Others will know the way is walkable.", "走到哪儿就把它插在哪儿。别人就知道那条路走得通。")],
        unlock: { kind: "gift", rewards: [{ kind: "piece", id: "flag" }] },
      },
    },
  }),
  friend({
    id: "twain",
    kind: "resident",
    likes: { love: [6006, 11202], like: [11201, 1107, 1007], dislike: [11302] },
    reactions: {
      love: say(D.laugh, "A Spark of Thought! Both of us want it. We will share. Probably. Heh.", "思之树！我们俩都想要。我们会分享的。大概吧。嘿。"),
      like: say(D.laugh, "One head says thank you. The other says it's about time.", "一个头说谢谢。另一个说早该送了。"),
      neutral: say(D.frown, "We'll study it. Then we'll argue about what we learned.", "我们会研究它。然后为学到了什么吵一架。"),
      dislike: say(D.frown, "A burger. Neither of us has the stomach. We have two heads and no stomach.", "汉堡。我们俩都没胃口。我们有两个头，可没有胃。"),
    },
    steps: {
      s1: {
        title: T("Two heads, one name", "两个头，一个名字"),
        lines: [say(D.laugh, "You ask the right questions. We'll answer one about ourselves. Only one.", "你问的问题都问在点上。我们回答一个关于自己的。只回答一个。")],
        unlock: topic(T("Two heads, one name", "两个头，一个名字"), [
          { face: D.frown, en: "We were two keepers once. The Wheel needed one. We disagreed about who.", zh: "我们以前是两个守护者。轮之殿只需要一个。我们对是谁意见不一。" },
          { face: D.laugh, en: "So we became one, and we still disagree. It keeps the Wheel honest.", zh: "于是我们合成了一个，至今还在争。这让轮子保持公正。" },
        ]),
      },
      s2: {
        title: T("Candy for the curious", "给好奇者的糖"),
        lines: [say(D.laugh, "Wisdom Candy. One for each of your heads. You have only one? Then eat both.", "智慧糖。一个头一颗。你只有一个头？那就两颗都吃。")],
        unlock: { kind: "gift", rewards: [{ kind: "item", item: 11201, n: 2 }] },
      },
      s3a: {
        choice: SHOP,
        title: T("Better candy, for a price", "更好的糖，要付钱"),
        lines: [say(D.frown, "We'll sell you the stronger candy. One head wanted to give it away. The other won.", "我们卖你更浓的糖。一个头想白送，另一个赢了。")],
        unlock: { kind: "shelf", item: 11202, price: 45 },
      },
      s3b: {
        choice: LEARN,
        title: T("Doubling the candy", "糖加倍"),
        lines: [say(D.laugh, "Two Wisdom Candies and a pinch of sparkle make one stronger one. Like us, in reverse.", "两颗智慧糖加一撮闪粉，做成一颗更浓的。跟我们正好反过来。")],
        unlock: { kind: "recipe", index: 20007 },
      },
      s4: {
        title: T("Who wrote the contract", "合约是谁写的"),
        lines: [say(D.frown, "You've asked us who wrote the Wheel's contract. Fine. A hint, and only a hint.", "你问过我们轮之殿的合约是谁写的。好吧，给个提示，只给提示。")],
        unlock: topic(T("Who wrote the contract", "合约是谁写的"), [
          { face: D.frown, en: "Whoever wrote it wrote it so that nobody, not even them, could change it afterwards.", zh: "不管是谁写的，都写得让任何人，包括他们自己，事后都改不了。" },
          { face: D.laugh, en: "Which is the only kind of author worth trusting. Read it yourself; it's all there.", zh: "这才是唯一值得信任的作者。你自己去读，全都写在那儿。" },
        ]),
      },
      s5: {
        title: T("Two guests at once", "一次来两位客人"),
        lines: [say(D.laugh, "We will visit your home. Both of us. Make room for two opinions.", "我们去你家做客。我们俩都去。给两种意见留点地方。")],
        unlock: {
          kind: "visit",
          rewards: [{ kind: "decor", id: "books" }],
          lines: [say(D.laugh, "We brought books. One of us chose them; the other says read them backwards.", "我们带了书。一个挑的书，另一个说要倒着读。")],
        },
      },
      s6: {
        title: T("Glasses for seeing twice", "看两遍的眼镜"),
        lines: [say(D.laugh, "Wear these and look at everything twice, as we do. You'll miss half as much.", "戴上它，什么都看两遍，像我们一样。你会少错过一半。")],
        unlock: { kind: "gift", rewards: [{ kind: "piece", id: "glasses" }] },
      },
    },
  }),
  friend({
    id: "bolt",
    kind: "resident",
    likes: { love: [1303, 1017], like: [1005, 1302, 1301], dislike: [21201] },
    reactions: {
      love: say(R.two, "A metal bar! Beep. Sorry. Happy beep. I can make three things with this.", "金属条！哔。抱歉。是开心的哔。我能用它做三样东西。"),
      like: say(R.one, "Useful. Everything's useful, but this is useful now.", "有用。什么都有用，但这个现在就有用。"),
      neutral: say(R.one, "Thank you. I'll find what it fixes.", "谢谢。我会找到它能修什么。"),
      dislike: say(R.three, "Ice cream in the gears. I have seen it happen. Please, no.", "冰淇淋掉进齿轮里。我亲眼见过。拜托，不要。"),
    },
    steps: {
      s1: {
        title: T("Why the trees", "为什么在树下"),
        lines: [say(R.one, "You keep sitting with me under the trees. I'll tell you why I work out here.", "你总跟我坐在树下。我告诉你我为什么在这儿干活。")],
        unlock: topic(T("Why the trees", "为什么在树下"), [
          { face: R.two, en: "Indoors, everything I fix stays fixed. Out here, the weather tests it. Better test.", zh: "在屋里，修好的东西就一直好着。在外面，风雨会考验它。这才是好测试。" },
          { face: R.one, en: "Also the birds bring me screws. I don't ask where from.", zh: "而且鸟会给我叼螺丝来。我从不问是从哪儿来的。" },
        ]),
      },
      s2: {
        title: T("Spare planks", "多余的木板"),
        lines: [say(R.one, "I over-ordered planks. Boop. Take two; build something crooked and be proud of it.", "木板订多了。噗。拿两块去，做点歪的东西，然后为它骄傲。")],
        unlock: { kind: "gift", rewards: [{ kind: "item", item: 1302, n: 2 }] },
      },
      s3a: {
        choice: SHOP,
        title: T("Bars on order", "金属条随时有"),
        lines: [say(R.two, "Then I'll keep metal bars for you. Fair price. I melt them myself, very carefully.", "那我给你备着金属条。价格公道。我亲手熔的，非常小心。")],
        unlock: { kind: "shelf", item: 1303, price: 30 },
      },
      s3b: {
        choice: LEARN,
        title: T("Melting scrap", "熔铁片"),
        lines: [say(R.three, "Scrap and an old coin for the alloy. Heat, patience, and don't stand downwind.", "铁片加一枚古钱币做合金。加热，耐心，别站在下风口。")],
        unlock: { kind: "recipe", index: 20008 },
      },
      s4: {
        title: T("Am I a robot", "我是不是机器人"),
        lines: [say(R.three, "You've asked if I'm a robot. You're a friend now, so I'll answer properly.", "你问过我是不是机器人。你现在是朋友了，我好好回答。")],
        unlock: topic(T("The proper answer", "正经的回答"), [
          { face: R.one, en: "I don't know. I was built, or I grew. Either way I fix things, so either way is fine.", zh: "我不知道。我是被造出来的，或者是长出来的。反正我都在修东西，所以哪种都行。" },
          { face: R.two, en: "Your pet's mind is gates, too. We have more in common than you'd think. Beep.", zh: "你宠物的心也是一个个门。我们的共同点比你想的多。哔。" },
        ]),
      },
      s5: {
        title: T("A repair visit", "上门修理"),
        lines: [say(R.one, "I'll come check your home for squeaks. Every home squeaks somewhere.", "我去你家听听哪里吱吱响。每个家都有地方吱吱响。")],
        unlock: {
          kind: "visit",
          rewards: [{ kind: "decor", id: "globe" }],
          lines: [say(R.two, "Fixed the squeak. Also built you a globe from the leftover parts. It spins. Mostly.", "吱吱声修好了。还用剩下的零件给你做了个地球仪。它会转，基本上。")],
        },
      },
      s6: {
        title: T("Tinker's shades", "修补匠的墨镜"),
        lines: [say(R.two, "Welding shades. Now we're both very well organised and very cool.", "焊接墨镜。现在我们俩都非常有条理，也非常酷。")],
        unlock: { kind: "gift", rewards: [{ kind: "piece", id: "shades" }] },
      },
    },
  }),
  friend({
    id: "flit",
    kind: "resident",
    likes: { love: [11314, 11312], like: [1011, 1012, 1013], dislike: [1006] },
    reactions: {
      love: say(I.only, "A blue pansy… the butterflies will come right to it. Thank you, quietly.", "一朵蓝色三色堇……蝴蝶会直接飞过来的。悄悄地谢谢你。"),
      like: say(I.only, "Mm. Something for the garden. They'll like that.", "嗯。给花园的。它们会喜欢的。"),
      neutral: say(I.only, "…for me? Oh. Thank you. Shh, though.", "……给我的？哦。谢谢。不过，嘘。"),
      dislike: say(I.only, "A jar. That's how they get caught. I'd rather not, please.", "罐子。它们就是这样被抓走的。我还是不要了，谢谢。"),
    },
    steps: {
      s1: {
        title: T("Where the butterflies go", "蝴蝶去了哪儿"),
        lines: [say(I.only, "You stay still well. Better than most. I'll tell you where they sleep.", "你很会保持安静。比大多数人都好。我告诉你它们在哪儿睡觉。")],
        unlock: topic(T("Where the butterflies sleep", "蝴蝶在哪儿睡"), [
          { face: I.only, en: "Under the big leaves, wings shut, all facing the same way. Nobody told them to.", zh: "在大叶子底下，翅膀合着，全都朝着同一个方向。没人教过它们。" },
          { face: I.only, en: "Your pet would understand. It knows how to wait.", zh: "你的宠物会懂的。它懂得等待。" },
        ]),
      },
      s2: {
        title: T("Honeydrops", "蜜露"),
        lines: [say(I.only, "These fell from the hives. The bees said you could have them. I asked.", "这些是从蜂巢掉下来的。蜜蜂说可以给你。我问过了。")],
        unlock: { kind: "gift", rewards: [{ kind: "item", item: 11312, n: 2 }] },
      },
      s3a: {
        choice: SHOP,
        title: T("A jar of honeydrops", "一罐蜜露"),
        lines: [say(I.only, "I'll save honeydrops for you. The bees agree, as long as you're gentle.", "我给你留着蜜露。蜜蜂也同意，只要你轻一点。")],
        unlock: { kind: "shelf", item: 11312, price: 20 },
      },
      s3b: {
        choice: LEARN,
        title: T("Making honeydrops", "做蜜露"),
        lines: [say(I.only, "Tree honey and a daffodil, warmed in your hands. Slowly. Everything here is slowly.", "树蜜和一朵水仙，在手心里捂暖。慢慢来。这里的一切都要慢慢来。")],
        unlock: { kind: "recipe", index: 20009 },
      },
      s4: {
        title: T("Why I whisper", "我为什么小声说话"),
        lines: [say(I.only, "You've wondered why I whisper. I'll tell you. Quietly.", "你一直好奇我为什么小声说话。我告诉你。小声地。")],
        unlock: topic(T("Why I whisper", "我为什么小声说话"), [
          { face: I.only, en: "I was loud once. Everything flew away. Now I'm quiet, and the forest tells me things.", zh: "我以前很大声。所有东西都飞走了。现在我安静了，森林开始告诉我事情。" },
          { face: I.only, en: "…please don't eat me on the way out. That's a joke. I've been practising.", zh: "……出去的路上请别吃我。这是个笑话。我练习过的。" },
        ]),
      },
      s5: {
        title: T("A quiet visit", "安静的拜访"),
        lines: [say(I.only, "I'd like to see your home. I'll be very quiet. You won't hear me come in.", "我想去你家看看。我会很安静，你都听不见我进门。")],
        unlock: {
          kind: "visit",
          rewards: [{ kind: "decor", id: "flowers" }],
          lines: [say(I.only, "I brought flowers. A butterfly followed me. It can stay, if you're still.", "我带了花。有只蝴蝶跟着我来了。你安静的话，它可以留下。")],
        },
      },
      s6: {
        title: T("A sunflower to hold", "捧着的向日葵"),
        lines: [say(I.only, "Hold this out and stand still. They'll land on you. They trust you now. So do I.", "举着它，别动。它们会落在你身上。它们现在信任你了。我也是。")],
        unlock: { kind: "gift", rewards: [{ kind: "piece", id: "sunflower" }] },
      },
    },
  }),
  friend({
    id: "why",
    kind: "resident",
    likes: { love: [11404, 11221], like: [1112, 11004, 11411], dislike: [11303] },
    reactions: {
      love: say(W.cradle, "Calm Tea! You've been listening. Mm-hm. That's the whole of medicine, really.", "安神茶！你一直在听。嗯嗯。说到底，医术就是这个。"),
      like: say(W.smile, "How thoughtful. I'll put it in the cabinet for a pet who needs it.", "真贴心。我把它放进柜子里，留给需要的宠物。"),
      neutral: say(W.smile, "Thank you, dear. Everything finds a use in a clinic.", "谢谢你，亲爱的。诊所里什么都用得上。"),
      dislike: say(W.lecture, "Pom-pom candy. Do you know how many teeth I've seen ruined? Keep it, and brush.", "绒球果糖。你知道我见过多少颗被它毁掉的牙吗？你留着吧，记得刷牙。"),
    },
    steps: {
      s1: {
        title: T("Why a nurse", "为什么当护士"),
        lines: [say(W.smile, "You bring your pet in even when it's well. I like that. Let me tell you how I started.", "你的宠物没病也带来看。我喜欢这样。我讲讲我是怎么开始的。")],
        unlock: topic(T("How I started", "我是怎么开始的"), [
          { face: W.cradle, en: "My first patient was a pet nobody else would sit up with. I sat up. It got better.", zh: "我第一个病人，是一只没人愿意守夜的宠物。我守了。它好起来了。" },
          { face: W.smile, en: "Most of nursing is staying. The rest is tea.", zh: "护理的大半就是陪着。剩下的是茶。" },
        ]),
      },
      s2: {
        title: T("A spare dose", "多余的一剂"),
        lines: [say(W.smile, "Calm Tea, from my own pot. For nights when your pet won't settle.", "我自己那壶泡的安神茶。宠物睡不安稳的夜里用。")],
        unlock: { kind: "gift", rewards: [{ kind: "item", item: 11404, n: 1 }] },
      },
      s3a: {
        choice: SHOP,
        title: T("The clinic's tea", "诊所的茶"),
        lines: [say(W.smile, "Then the clinic will sell you Calm Tea at cost. Nurse's orders.", "那诊所就按成本卖你安神茶。护士的嘱咐。")],
        unlock: { kind: "shelf", item: 11404, price: 35 },
      },
      s3b: {
        choice: LEARN,
        title: T("Brewing calm", "泡出安宁"),
        lines: [say(W.lecture, "Daffodil drops and a little poppy ink. A little. I'm watching you measure.", "水仙露加一点罂粟墨。一点点。我看着你称。")],
        unlock: { kind: "recipe", index: 20010 },
      },
      s4: {
        title: T("The hard night", "难熬的那一夜"),
        lines: [say(W.cradle, "You've seen me tired. You may as well know about the hardest night.", "你见过我累的样子。不如告诉你最难熬的那一夜。")],
        unlock: topic(T("The hardest night", "最难熬的一夜"), [
          { face: W.cradle, en: "Three pets at once, and one bed. I held one, sang to one, and the third sang back.", zh: "同时来了三只宠物，只有一张床。我抱着一只，给一只唱歌，第三只跟着唱了起来。" },
          { face: W.smile, en: "By morning all three were asleep on me. I didn't move until noon.", zh: "到早上三只都在我身上睡着了。我一直没动，直到中午。" },
        ]),
      },
      s5: {
        title: T("A home check-up", "上门检查"),
        lines: [say(W.lecture, "I make house calls for friends. I'll come and see how your pet lives.", "朋友我会上门看诊。我去看看你的宠物住得怎么样。")],
        unlock: {
          kind: "visit",
          rewards: [{ kind: "decor", id: "heart" }],
          lines: [say(W.smile, "Clean, warm, loved. A perfect check-up. Here, a heart for the wall.", "干净，温暖，被爱着。检查满分。给，一颗贴在墙上的心。")],
        },
      },
      s6: {
        title: T("Hearts for the eyes", "眼里的心"),
        lines: [say(W.cradle, "Wear these. Then everyone can see what I see when I look at the two of you.", "戴上这个。这样大家都能看到我看你们俩时看到的。")],
        unlock: { kind: "gift", rewards: [{ kind: "piece", id: "hearts" }] },
      },
    },
  }),
  friend({
    id: "jab",
    kind: "resident",
    likes: { love: [11302, 21202], like: [11304, 7202, 11233], dislike: [11404] },
    reactions: {
      love: say(AR.grin, "A burger! Fuel for champions! You're my favourite challenger, and I've said that to no one. Today.", "汉堡！冠军的燃料！你是我最喜欢的挑战者，今天我还没对别人这么说过。"),
      like: say(AR.grin, "Ha! Good snack. Training snack. I approve.", "哈！好零食。训练零食。我批准了。"),
      neutral: say(AR.shrug, "Huh. Thanks! I'll put it by the trophies.", "嗯。谢啦！我把它放在奖杯旁边。"),
      dislike: say(AR.shock, "Calm Tea? Calm? Before a spar? Never! Take it back!", "安神茶？安神？切磋前喝？绝不！拿回去！"),
    },
    steps: {
      s1: {
        title: T("The first trophy", "第一座奖杯"),
        lines: [say(AR.grin, "You keep coming to spars. Good. Let me show you the first trophy in this room.", "你一直来切磋。很好。给你看看这屋里的第一座奖杯。")],
        unlock: topic(T("The first trophy", "第一座奖杯"), [
          { face: AR.shrug, en: "It's a bent spoon. A pet won it by doing nothing for sixteen rounds. The other one gave up.", zh: "是一把弯勺子。一只宠物十六回合什么都没做就赢了。另一只放弃了。" },
          { face: AR.grin, en: "Patience is a move. Teach it.", zh: "耐心也是一招。教给它。" },
        ]),
      },
      s2: {
        title: T("Training lunch", "训练午餐"),
        lines: [say(AR.grin, "Here. A burger. A trained pet is a fed pet.", "给。一个汉堡。练过的宠物，得是吃饱的宠物。")],
        unlock: { kind: "gift", rewards: [{ kind: "item", item: 11302, n: 1 }] },
      },
      s3a: {
        choice: SHOP,
        title: T("Burgers at the arena", "竞技场汉堡"),
        lines: [say(AR.grin, "Then you can buy burgers here before a spar. Champion's price!", "那切磋前你可以在这儿买汉堡。冠军价！")],
        unlock: { kind: "shelf", item: 11302, price: 25 },
      },
      s3b: {
        choice: LEARN,
        title: T("Grill like a coach", "像教练一样烤"),
        lines: [say(AR.fierce, "Pepper and rice, grilled hot and fast. Like a good opening move.", "辣椒加米，大火快烤。就像一个好的开局。")],
        unlock: { kind: "recipe", index: 20011 },
      },
      s4: {
        title: T("The spar I lost", "我输掉的那场"),
        lines: [say(AR.shrug, "Everyone asks about wins. You've earned the loss I'm proudest of.", "大家都问赢的。你值得听我最骄傲的那场输。")],
        unlock: topic(T("The spar I lost", "我输掉的那场"), [
          { face: AR.shock, en: "My pet was faster, stronger, better taught. It lost to a pet that only knew how to be kind.", zh: "我的宠物更快、更强、教得更好。却输给了一只只会温柔的宠物。" },
          { face: AR.grin, en: "Kindness confused every move I'd taught. I've coached differently since.", zh: "温柔打乱了我教的每一招。从那以后我换了教法。" },
        ]),
      },
      s5: {
        title: T("A coach at your door", "教练上门"),
        lines: [say(AR.grin, "I'll come and see your pet train at home. No pressure! Some pressure.", "我去你家看看宠物怎么在家练习。没压力！有一点点压力。")],
        unlock: {
          kind: "visit",
          rewards: [{ kind: "decor", id: "ball" }],
          lines: [say(AR.grin, "Good home! Needs a ball. Every champion's home has a ball. Here!", "家不错！就差个球。每个冠军家里都有个球。给！")],
        },
      },
      s6: {
        title: T("A champion's laurel", "冠军的桂冠"),
        lines: [say(AR.fierce, "You didn't win it in a spar. You won it by showing up. Wear it!", "这不是你切磋赢来的。是你一次次来赢来的。戴上！")],
        unlock: { kind: "gift", rewards: [{ kind: "piece", id: "laurel" }] },
      },
    },
  }),
  friend({
    id: "nimbus",
    kind: "resident",
    likes: { love: [21205, 11409], like: [1103, 11408, 21203], dislike: [1301] },
    reactions: {
      love: say(L.smile, "Rock candyfloss! It's a cloud you can eat. I'll dream about this tonight.", "棉花岩糖！是能吃的云。今晚我会梦到它的。"),
      like: say(L.smile, "Oh, pretty. It'll look different in a dream, but I'll know it.", "哦，真漂亮。在梦里它会变个样子，但我认得出。"),
      neutral: say(L.dream, "For me? I'll keep it under my pillow and see what happens.", "给我的？我把它放在枕头下，看看会发生什么。"),
      dislike: say(L.dream, "A stone block. Too heavy to dream about. Keep it, please.", "一块石块。太重了，梦不动。你留着吧。"),
    },
    steps: {
      s1: {
        title: T("What I dreamt", "我梦见了什么"),
        lines: [say(L.dream, "I dreamt about you last night. Do you want to hear? It was nice, mostly.", "我昨晚梦见你了。想听吗？大部分是好梦。")],
        unlock: topic(T("Last night's dream", "昨晚的梦"), [
          { face: L.dream, en: "Your pet was tall as a lantern and spoke in colours. You understood every one.", zh: "你的宠物有灯笼那么高，用颜色说话。每一种你都听懂了。" },
          { face: L.smile, en: "When I woke up I thought: they will, one day. You'll see.", zh: "醒来时我想：总有一天会的。你等着瞧。" },
        ]),
      },
      s2: {
        title: T("Bottled sparkle", "瓶装的闪亮"),
        lines: [say(L.smile, "Sparkle Soda. It fizzes like a dream starting. For you.", "气泡汽水。冒泡的样子就像一个梦刚开始。给你。")],
        unlock: { kind: "gift", rewards: [{ kind: "item", item: 11409, n: 1 }] },
      },
      s3a: {
        choice: SHOP,
        title: T("Rock candyfloss from the clouds", "云上的棉花岩糖"),
        lines: [say(L.smile, "Then I'll spin rock candyfloss for you whenever you like. It's how I spend my afternoons.", "那你想要的时候我就给你转棉花岩糖。我下午就是这么过的。")],
        unlock: { kind: "shelf", item: 21205, price: 30 },
      },
      s3b: {
        choice: LEARN,
        title: T("Spinning clouds", "纺云"),
        lines: [say(L.dream, "Sweet syrup and a little sparkle dust, spun until it forgets it was ever heavy.", "甜糖浆加一点闪粉，转到它忘了自己曾经很重。")],
        unlock: { kind: "recipe", index: 20012 },
      },
      s4: {
        title: T("The recurring dream", "反复出现的梦"),
        lines: [say(L.dream, "There's one dream I keep having. You're the first I've told.", "有一个梦我总是做。你是我第一个告诉的人。")],
        unlock: topic(T("The dream that comes back", "反复出现的梦"), [
          { face: L.dream, en: "A door at the end of the lane, and behind it every pet that ever lived, waving.", zh: "小路尽头有一扇门，门后是每一只活过的宠物，都在挥手。" },
          { face: L.smile, en: "I think the chain is that door. Nothing kept there is ever really gone.", zh: "我觉得链就是那扇门。存在那儿的，永远不会真的消失。" },
        ]),
      },
      s5: {
        title: T("A dreamer comes to call", "做梦的人来访"),
        lines: [say(L.smile, "I'll visit your home. I want to know what your pet dreams of.", "我去你家坐坐。我想知道你的宠物梦见什么。")],
        unlock: {
          kind: "visit",
          rewards: [{ kind: "decor", id: "star" }],
          lines: [say(L.dream, "It dreams of you, of course. I brought a star, for the ceiling above its bed.", "它当然梦见你。我带了颗星星，挂在它床的上方。")],
        },
      },
      s6: {
        title: T("A crown for dreamers", "做梦者的王冠"),
        lines: [say(L.smile, "Every dream I've had of you, you were wearing this. Now you can, awake.", "我梦里的你，每次都戴着它。现在醒着也能戴了。")],
        unlock: { kind: "gift", rewards: [{ kind: "piece", id: "crown" }] },
      },
    },
  }),
];
