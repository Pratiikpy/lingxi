/**
 * Arcs 2 to 5 (36-QUEST-LINE.md §3): Wick the lantern keeper, Praline at the Corner Shop, Yonder the wayfinder and
 * Bolt the tinker. Each resident's arc opens the first time you walk into their room. Changes from the outline,
 * because the mechanic belongs to a later package, are noted beside the quest.
 */

import type { QuestDef } from "../story";
import { T, anyOf, coins, decor, done, ever, flag, from, item, obj, piece, recipe, say, story, trust } from "./helpers";

const quest = (n: number, arc: number, giver: string, requires: Parameters<typeof story>[0]["requires"], q: Omit<Parameters<typeof story>[0], "id" | "arc" | "giver" | "requires">): QuestDef =>
  story({ id: `q${String(n).padStart(2, "0")}`, arc, giver, requires: requires ?? [], ...q });

const A = { calm: "wick.png", happy: "wick_happy.png", thinking: "wick_lost_in_thought.png", hands: "wick_clasping_hands.png" };
const M = { flat: "praline_default_1.png", laugh: "praline_laugh_1.png", pity: "praline_pity_1.png" };
const Z = { day: "yonder_day.png", pose: "yonder_pose_2.png", night: "yonder_night.png" };
const R = { one: "bolt_clear1.png", two: "bolt_clear2.png", three: "bolt_clear3.png" };

export const ARC_2_TO_5: QuestDef[] = [
  // ── Arc 2. Wick, lantern keeper ──
  quest(12, 2, "wick", [done("q06")], {
    title: T("A light for the window", "窗边的灯"),
    intro: [say(A.hands, "Every window on this lane has a light in it, except yours.", "这条街每扇窗户都亮着灯，除了你家的。"), say(A.happy, "Bring me a daffodil and I'll fold you a paper lantern for it.", "给我带一朵水仙，我给你折一盏纸灯笼。")],
    outro: [say(A.happy, "There. Hang it where your pet can see it from bed.", "好了。挂在你的宠物躺在床上也能看到的地方。")],
    objectives: [obj(from("GIVE_TO", "wick:1011", 1), "Give Wick a daffodil", "送灯芯一朵水仙")],
    rewards: [coins(10), decor("lantern"), trust("wick", 4)],
  }),
  quest(13, 2, "wick", [done("q12")], {
    title: T("Glass and string", "玻璃与线"),
    intro: [say(A.calm, "A real lantern needs an old bottle to hold the light and a good stick to hang it from.", "真正的灯笼要一个旧瓶子装光，还要一根结实的小棍挂起来。"), say(A.thinking, "Both turn up if you look around in the right places.", "在对的地方四处找找，两样都能找到。")],
    outro: [say(A.happy, "Lovely. And here, a pine cone and a ruby mushroom: the rest of what a lantern needs.", "真好。再给你一颗松果和一朵红宝石蘑菇：灯笼剩下要用的都在这儿了。")],
    // the outline asked for a glass jar; since finds follow rarity tiers (plan 4.5) a jar takes most of a day to turn up, so it is an old bottle
    objectives: [obj(from("FIND", 1003, 1), "Find an old bottle", "找到一个旧瓶子"), obj(from("FIND", 1001, 1), "Find a stick", "找到一根小棍")],
    rewards: [coins(15), item(1004), item(1013), trust("wick", 4)],
  }),
  quest(14, 2, "wick", [done("q13")], {
    title: T("My first lantern", "第一盏灯"),
    intro: [say(A.hands, "Now make one at the workbench. Your own hands, your own light.", "现在去工作台做一盏吧。你自己的手，你自己的光。")],
    outro: [say(A.happy, "It's crooked. They all are, the first time. It will still find you in the dark.", "歪歪的。第一盏都是这样。它在黑暗里照样能找到你。")],
    objectives: [obj(from("MAKE", "lantern", 1), "Make a lantern", "做一盏灯笼")],
    rewards: [coins(20), trust("wick", 5)],
  }),
  quest(15, 2, "wick", [done("q14")], {
    title: T("Evening together", "傍晚"),
    intro: [say(A.thinking, "The lanterns look best just as the sky turns orange.", "天空刚变成橘色的时候，灯笼最好看。"), say(A.calm, "Sit with me here one evening, the two of you. Ten minutes is plenty.", "找个傍晚，你们俩来这儿陪我坐坐。十分钟就够了。")],
    outro: [say(A.happy, "Thank you for the company. Take this crystal; it glows the same colour.", "谢谢你们陪我。拿着这块水晶吧，它发出的光是一样的颜色。")],
    objectives: [obj(from("TOGETHER_WHEN", "evening-64", 10), "Spend 10 evening minutes together in the Lantern Room", "傍晚在灯笼屋一起待 10 分钟")],
    rewards: [coins(20), decor("crystal"), trust("wick", 5)],
  }),
  quest(16, 2, "wick", [done("q15")], {
    title: T("Three lights", "三盏灯"),
    intro: [say(A.hands, "A lantern is for carrying. Let your pet hold one and walk somewhere new.", "灯笼是用来提着走的。让你的宠物提一盏，去别的地方走走。")],
    outro: [say(A.thinking, "Three rooms a little brighter. Come and ask me about the old lane; I'll tell you now.", "三个房间亮了一点。来问问我这条老街的事吧，现在可以告诉你了。")],
    objectives: [obj(from("MOVE_WEARING", "lantern", 3), "Walk to 3 rooms carrying a lantern", "提着灯笼走过 3 个房间")],
    rewards: [coins(25), flag("wick-lane"), trust("wick", 5)],
  }),
  quest(17, 2, "wick", [done("q16")], {
    title: T("Someone to share it", "分享"),
    intro: [say(A.calm, "A light is better when someone else is near it.", "灯光有人一起看，才更好。"), say(A.happy, "Have a friend's pet come to your home, or go and see the pets on Builders' Lane.", "请朋友的宠物来你家，或者去建设者小路看看那里的宠物。")],
    outro: [say(A.happy, "There it is: a warm room. These charms are a pair, like you two.", "这样就对了：一间暖暖的屋子。这对发饰是一对的，就像你们俩。")],
    objectives: [obj(anyOf(from("EVENT", "visited-by-friend", 1), from("MEET", undefined, 1)), "A friend's pet visits your home, or you visit Builders' Lane", "朋友的宠物来你家，或者你去建设者小路")],
    rewards: [coins(25), piece("charm"), trust("wick", 5)],
  }),
  quest(18, 2, "wick", [done("q17")], {
    title: T("The long night", "长夜"),
    intro: [say(A.thinking, "I keep these lit because things that are kept don't get lost.", "我让这些灯一直亮着，因为被留住的东西就不会丢。"), say(A.hands, "Keep three days on X Layer. Then I'd like to come and see your home.", "在 X Layer 上留住三天。然后我想去你家看看。")],
    outro: [say(A.happy, "Three days, kept for good. I'll call on you some evening. Leave the light on.", "三天，永远留下了。哪天傍晚我会去拜访。记得留一盏灯。")],
    objectives: [obj(from("SAVE", undefined, 3), "Save 3 days on X Layer", "在 X Layer 上保存 3 天")],
    rewards: [coins(40), flag("wick-visits"), trust("wick", 6)],
  }),

  // ── Arc 3. Praline, sweets seller ──
  quest(19, 3, "praline", [done("q09")], {
    title: T("Grand opening", "新店开张"),
    intro: [say(M.flat, "A customer who came back. Rare. Have a look around the shop properly this time.", "回头客。少见。这次好好逛逛店里吧。")],
    outro: [say(M.laugh, "A free sample, as is tradition. It is not a tradition. I just made it one.", "按惯例，送你一份试吃。其实没这惯例，我刚定的。")],
    objectives: [obj(from("VISIT", 13, 1), "Come back to the Corner Shop", "再来一次街角小店")],
    rewards: [item(11304), trust("praline", 4)],
  }),
  quest(20, 3, "praline", [done("q19")], {
    title: T("Regular customer", "老顾客"),
    intro: [say(M.flat, "Three purchases makes you a regular. Regulars get the good shelf.", "买三次就算老顾客。老顾客能看好的那一层货架。")],
    outro: [say(M.laugh, "Regular. I'll put something new on the top shelf for you.", "老顾客了。我会在最上层给你摆点新东西。")],
    objectives: [obj(from("BUY", undefined, 3), "Buy 3 things in shops", "在商店买 3 样东西")],
    rewards: [coins(10), flag("praline-shelf"), trust("praline", 5)],
  }),
  quest(21, 3, "praline", [done("q20")], {
    title: T("Taste test", "试吃"),
    intro: [say(M.pity, "Every pet has a favourite food. Most owners never find out which.", "每只宠物都有最爱吃的东西。大部分主人从来都不知道是哪样。"), say(M.flat, "Feed it three different foods and watch its face.", "喂它三种不同的食物，看它的表情。")],
    outro: [say(M.flat, "Noted. I write these things down. It's for business.", "记下了。这些我都会记。为了生意。")],
    objectives: [obj(from("DISTINCT", "FED", 3), "Feed your pet 3 foods it has never eaten", "喂宠物 3 种它没吃过的食物")],
    rewards: [coins(15), item(11140), flag("favourite-noted"), trust("praline", 5)],
  }),
  quest(22, 3, "praline", [done("q21")], {
    title: T("Apprentice", "小学徒"),
    intro: [say(M.flat, "You have patient hands. Bring me a pine cone, a daffodil and a ruby mushroom.", "你的手很有耐心。给我带一颗松果、一朵水仙和一朵红宝石蘑菇。")],
    outro: [say(M.laugh, "Good. Here: my old burner, and sacred dust. Nobody knows where the dust comes from. Don't ask.", "很好。拿着：我的旧小炉子，还有圣尘。没人知道圣尘从哪儿来。别问。")],
    // the outline gave a mortar for the next quest's sweet; here the sweet is a syrup, brewed, so the tool is the burner
    objectives: [obj(from("FIND", 1004, 1), "Find a pine cone", "找到一颗松果"), obj(from("FIND", 1011, 1), "Find a daffodil", "找到一朵水仙"), obj(from("FIND", 1013, 1), "Find a ruby mushroom", "找到一朵红宝石蘑菇")],
    rewards: [coins(15), item(23101), item(11011, 2), trust("praline", 5)],
  }),
  quest(23, 3, "praline", [done("q22")], {
    title: T("Sugar work", "熬糖"),
    intro: [say(M.flat, "Warm the dust on the burner at the workbench and it turns into syrup. Sweet syrup. Make one.", "在工作台用小炉子把圣尘热一热，它就变成糖浆了。甜糖浆。做一份。")],
    outro: [say(M.laugh, "Not bad for a first batch. Take a candy; you've earned one.", "第一锅不算差。拿颗糖吧，这是你应得的。")],
    objectives: [obj(from("CRAFT", 1201, 1), "Make sweet syrup at the workbench", "在工作台做一份甜糖浆")],
    rewards: [coins(20), item(11303, 2), trust("praline", 5)],
  }),
  quest(24, 3, "praline", [done("q23")], {
    title: T("Something for a friend", "送给朋友"),
    intro: [say(M.pity, "Sweets are better given than eaten. I would know; I eat a lot of them.", "糖果送人比自己吃更好。我很清楚，我吃了很多。"), say(M.flat, "Send a friend a gift from your bag.", "从背包里给朋友送一份礼物。")],
    outro: [say(M.laugh, "Generous. Bad for business, good for you. Here, some bells for the next one.", "真大方。对生意不好，对你好。给，下次送礼用的铃铛。")],
    objectives: [obj(from("GIFT", undefined, 1), "Send a friend a gift", "给朋友送一份礼物")],
    rewards: [coins(20), item(11408), trust("praline", 6)],
  }),
  quest(25, 3, "praline", [done("q24")], {
    title: T("Praline's secret", "糖霜的秘密"),
    opensWhen: T("Praline trusts you a little more each time you help her.", "你每帮糖霜一次，她就更信任你一点。"),
    intro: [say(M.flat, "You keep coming back. Fine. When I trust you enough, I'll tell you a recipe I don't sell.", "你总是回来。好吧。等我足够信任你，我就告诉你一个我不卖的配方。")],
    outro: [say(M.pity, "Butterfly mochi. My grandmother's. Tell anyone and I'll raise your prices.", "蝴蝶麻薯。我外婆的。告诉别人的话，我就给你涨价。")],
    objectives: [obj(ever("TRUST_LEVEL", "praline", 3), "Reach trust level 3 with Praline", "和糖霜的信任达到 3 级")],
    rewards: [coins(30), recipe(20001)],
  }),
  quest(26, 3, "praline", [done("q25")], {
    title: T("Flowers for the forgotten", "献给被遗忘的"),
    intro: [say(M.pity, "There are old stones past the hill that nobody visits. I used to.", "山那边有几块没人去看的老石碑。我以前常去。"), say(M.flat, "Go and see them for me. Then bring me five daffodils and I'll take them myself.", "替我去看看。然后给我带五朵水仙，我自己送过去。")],
    outro: [say(M.pity, "…Thank you. Wear this. I'll tell you about them another day.", "……谢谢你。戴上这个。改天我再跟你说说他们的事。")],
    objectives: [obj(from("VISIT", 26, 1), "Visit the Old Stones", "去看看老石碑"), obj(from("GIVE_TO", "praline:1011", 5), "Give Praline 5 daffodils", "送糖霜 5 朵水仙")],
    rewards: [coins(40), piece("ribbon"), flag("praline-story"), trust("praline", 6)],
  }),

  // ── Arc 4. Yonder, wayfinder ──
  quest(27, 4, "yonder", [ever("VISIT", 3, 1)], {
    title: T("Not right now", "等一下"),
    intro: [say(Z.day, "Busy. Walk four rooms and come back, then we'll talk.", "我在忙。去走四个房间再回来，然后再说。")],
    outro: [say(Z.pose, "You came back. Most don't. Have a snack for the road.", "你回来了。大部分人不会。拿点路上吃的。")],
    objectives: [obj(from("MOVE", undefined, 4), "Walk through 4 rooms", "走过 4 个房间")],
    rewards: [coins(10), item(11301), trust("yonder", 4)],
  }),
  quest(28, 4, "yonder", [done("q27")], {
    title: T("Rookie walk", "新手散步"),
    intro: [say(Z.day, "Take your pet for a proper walk. Twenty minutes, on your own two legs if you can.", "带宠物好好散个步。二十分钟，能的话用你自己的腿走。")],
    outro: [say(Z.pose, "Good. From now on I'll keep a log of your walks.", "不错。从现在起，我帮你记着散步的次数。")],
    objectives: [obj(from("WALK", undefined, 1), "Take one walk", "散一次步")],
    rewards: [coins(15), flag("walk-log"), trust("yonder", 4)],
  }),
  quest(29, 4, "yonder", [done("q28")], {
    title: T("Ten places", "十个地方"),
    intro: [say(Z.day, "You don't know a place until you've stood in it. Ten of them.", "没站在一个地方，就不算认识它。去十个。")],
    outro: [say(Z.pose, "Ten. Here, a map to hang up. Mark the ones you liked.", "十个了。给，挂起来的地图。把喜欢的标上。")],
    objectives: [obj(ever("VISITED", undefined, 10), "Visit 10 places", "去过 10 个地方")],
    rewards: [coins(20), decor("mapframe"), trust("yonder", 5)],
  }),
  quest(30, 4, "yonder", [done("q29")], {
    title: T("A note on the path", "路上的字条"),
    intro: [say(Z.night, "Someone left a warning nailed up on the Shady Path. Go and read it.", "有人在树荫小路上钉了一张警告。去看看。")],
    outro: [say(Z.day, "\"Mind the roots after dark.\" Sensible. Take the sign; put it by your door.", "“天黑后小心树根。”有道理。把牌子拿着，放在你家门口。")],
    objectives: [obj(from("VISIT", 55, 1), "Walk the Shady Path", "走一趟树荫小路")],
    rewards: [coins(20), decor("sign"), trust("yonder", 5)],
  }),
  quest(31, 4, "yonder", [done("q30")], {
    title: T("The far side", "另一边"),
    intro: [say(Z.pose, "There's a crossing where the river runs shallow. Find it.", "河水变浅的地方有一排踏脚石，叫过河处。去找到它。")],
    outro: [say(Z.day, "Now you know the way to the sea. Your pet will want to go.", "现在你知道去海边的路了。你的宠物会想去的。")],
    // the outline opened the seaside trip here; trips are already open to everyone, so this is told, not locked
    objectives: [obj(from("VISIT", 57, 1), "Reach the River Crossing", "走到过河处")],
    rewards: [coins(25), flag("seaside"), trust("yonder", 5)],
  }),
  quest(32, 4, "yonder", [done("q31")], {
    title: T("Postcard", "明信片"),
    intro: [say(Z.day, "Send your pet on a trip. It'll come back with something, and a story.", "让宠物去旅行一次。它会带点东西回来，还有一个故事。")],
    outro: [say(Z.pose, "Back in one piece. This came with it; it's addressed to you.", "完完整整地回来了。这个是跟着它一起来的，写给你的。")],
    objectives: [obj(from("TRIP", undefined, 1), "Send your pet on one trip", "让宠物去旅行一次")],
    rewards: [coins(25), decor("postcard"), trust("yonder", 5)],
  }),
  quest(33, 4, "yonder", [done("q32")], {
    title: T("Thirty places", "三十个地方"),
    intro: [say(Z.night, "Thirty. Then you're a wayfinder, and I'll stop calling you a rookie.", "三十个。到那时你就是引路人了，我也不再叫你新手。")],
    outro: [say(Z.day, "Wayfinder. Wear the hat. Don't lose it in a river.", "引路人。戴上这顶帽子。别掉进河里。")],
    objectives: [obj(ever("VISITED", undefined, 30), "Visit 30 places", "去过 30 个地方")],
    rewards: [coins(50), piece("ranger"), trust("yonder", 6)],
  }),

  // ── Arc 5. Bolt, tinker ──
  quest(34, 5, "bolt", [ever("VISIT", 5, 1)], {
    title: T("The more the merrier", "人多热闹"),
    intro: [say(R.one, "Beep. Oh, company. Sit, sit. Nobody sits with Bolt.", "哔。哦，有客人。坐，坐。没人陪我坐。")],
    outro: [say(R.two, "Here, a stone. A good one. I've been saving it for whoever sat down.", "给你一块石头。好石头。我一直留着，给第一个坐下来的人。")],
    objectives: [],
    rewards: [coins(5), item(1002, 2), trust("bolt", 4)],
  }),
  quest(35, 5, "bolt", [done("q34")], {
    title: T("Bottle deposit", "瓶子换硬币"),
    intro: [say(R.one, "Old bottles. I collect them. Bring me three and I'll pay you for them.", "旧瓶子。我收的。给我带三个，我付钱。")],
    outro: [say(R.three, "Three bottles, very well organised. Coins, and an old one for luck.", "三个瓶子，非常有条理。给你钱，再加一枚老硬币讨个吉利。")],
    objectives: [obj(from("GIVE_TO", "bolt:1003", 3), "Give Bolt 3 old bottles", "送螺丝 3 个旧瓶子")],
    rewards: [coins(15), item(1015), trust("bolt", 4)],
  }),
  quest(36, 5, "bolt", [done("q35")], {
    title: T("A fair swap", "公平交换"),
    intro: [say(R.two, "Daffodils. For a thing I'm building. Don't ask what. Three, please.", "水仙。我在做个东西要用。别问是什么。三朵，谢谢。")],
    outro: [say(R.one, "Fair swap: berries for flowers. Five of them. Fair is fair.", "公平交换：浆果换花。五颗。公平就是公平。")],
    objectives: [obj(from("GIVE_TO", "bolt:1011", 3), "Give Bolt 3 daffodils", "送螺丝 3 朵水仙")],
    rewards: [item(1014, 5), trust("bolt", 5)],
  }),
  quest(37, 5, "bolt", [done("q36")], {
    title: T("Trading up", "越换越好"),
    intro: [say(R.two, "Three pebbles make a stone block at the workbench. Bring me one block.", "三颗小石子在工作台能做成一块石砖。给我带一块。")],
    outro: [say(R.three, "A proper block. Here: a metal bar. Better than a block. Trading up.", "像样的石砖。给你：一根金属条。比石砖好。越换越好。")],
    // the outline's reward was a screwdriver; it now comes with quest 7, the first time a tool is needed, so this gives the metal bar the finder needs
    objectives: [obj(from("GIVE_TO", "bolt:1301", 1), "Give Bolt a stone block (made from 3 pebbles)", "送螺丝一块石砖（用 3 颗小石子做）")],
    rewards: [coins(15), item(1303), trust("bolt", 5)],
  }),
  quest(38, 5, "bolt", [done("q37")], {
    title: T("Bits and pieces", "零零碎碎"),
    intro: [say(R.one, "I'm building a finder. It needs a green pipe, some scrap and a pine cone. Find them.", "我在做一个找东西的仪器。要一根绿管子、一些废铁和一颗松果。去找。")],
    outro: [say(R.two, "All three. And these: a glow root I dug up years ago, and a spark of sight. The finder needs both.", "三样都齐了。再给你这些：我好多年前挖到的发光根，还有视觉之火花。仪器两样都要。")],
    // a glow root drops in one room at 0.2% (rarity tiers, plan 4.5): Bolt gives it rather than sending you to dig for weeks
    objectives: [obj(from("FIND", 1017, 1), "Find a green pipe", "找到一根绿管子"), obj(from("FIND", 1005, 1), "Find some scrap", "找到一些废铁"), obj(from("FIND", 1004, 1), "Find a pine cone", "找到一颗松果")],
    rewards: [coins(20), item(1021), item(6003), trust("bolt", 5)],
  }),
  quest(39, 5, "bolt", [done("q38")], {
    title: T("The finder's rod", "寻物杖"),
    intro: [say(R.three, "Glow root, metal bar, spark of sight. Put them together at the workbench: a dowsing rod.", "发光根、金属条、视觉之火花。在工作台组合起来：一根探物杖。")],
    outro: [say(R.one, "Boop. It twitches. That means it works. Probably.", "噗。它在抖。说明能用。大概。")],
    objectives: [obj(from("CRAFT", 100010, 1), "Make the dowsing rod", "做一根探物杖")],
    rewards: [coins(25), flag("compass"), trust("bolt", 6)],
  }),
  quest(40, 5, "bolt", [done("q39")], {
    title: T("It points somewhere", "它指着某处"),
    intro: [say(R.two, "Every room hides something for those who keep looking. Take the rod and find what three rooms hide.", "每个房间都藏着点东西，留给常来找的人。拿着探物杖，找出三个房间藏着的东西。")],
    outro: [say(R.three, "Told you. Very well organised world, if you know where to look. Goggles: for looking.", "跟你说了吧。只要知道往哪儿看，这世界非常有条理。护目镜：用来看的。")],
    objectives: [obj(ever("ITEM", 100010, 1), "Keep the dowsing rod in your bag", "背包里带着探物杖"), obj(from("FAMILIAR", undefined, 3), "Find what 3 rooms hide (fill their bars)", "找出 3 个房间藏着的东西（把进度条填满）")],
    rewards: [coins(30), piece("goggles"), trust("bolt", 6)],
  }),
];
