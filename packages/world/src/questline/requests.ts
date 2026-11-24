/**
 * Residents' requests (G4): on about half the days the social daily is a small errand one of the nine residents asks for,
 * a few of something they like that a player can find, grow, buy or make at the bench. Each pays coins and trust, so
 * the residents keep going after their story arcs end, and the daily loop holds a real errand rather than a tap.
 */

import type { QuestDef } from "../story";
import { T, coins, daily, from, obj, say, trust } from "./helpers";

const A = { calm: "wick.png", happy: "wick_happy.png", thinking: "wick_lost_in_thought.png" };
const M = { flat: "praline_default_1.png", laugh: "praline_laugh_1.png" };
const Z = { day: "yonder_day.png", pose: "yonder_pose_2.png" };
const D = { frown: "twain_frown.png", laugh: "twain_laugh.png" };
const R = { one: "bolt_clear1.png", two: "bolt_clear2.png" };
const I = "flit.png";
const W = { smile: "nurse_smiling.png", lecture: "nurse_lecturing.png" };
const AR = { grin: "jab_default_1.png", shrug: "jab_shrug_1.png" };
const L = { dream: "nimbus_daydreaming.png", smile: "nimbus_smiling.png" };

interface Ask {
  n: number;
  item: number;
  what: { en: string; zh: string };
  title: { en: string; zh: string };
  intro: ReturnType<typeof say>;
  outro: ReturnType<typeof say>;
}

const request = (who: string, k: number, a: Ask): QuestDef =>
  daily({
    id: `r-${who}-${k}`,
    group: "request",
    giver: who,
    // D9: found, grown, bought or made, and handed to a resident in another room
    needs: ["map", "bag"],
    title: a.title,
    intro: [a.intro],
    outro: [a.outro],
    objectives: [obj(from("GIVE_TO", `${who}:${a.item}`, a.n), `Give ${a.what.en}`, `送${a.what.zh}`)],
    rewards: [coins(15), trust(who, 2)],
  });

const BY_RESIDENT: QuestDef[] = [
  // ── Wick, the lantern keeper ──
  request("wick", 1, {
    n: 2,
    item: 1010,
    what: T("Wick 2 night poppies", "灯芯 2 朵夜罂粟"),
    title: T("Ink for the lantern papers", "灯笼纸的墨"),
    intro: say(
      A.thinking,
      "The lantern papers want a little dark ink. Two night poppies would do it.",
      "灯笼纸要一点深色的墨。两朵夜罂粟就够了。",
    ),
    outro: say(
      A.happy,
      "Lovely. Tonight's lanterns will have their names on them.",
      "真好。今晚的灯笼都能写上名字了。",
    ),
  }),
  request("wick", 2, {
    n: 2,
    item: 11314,
    what: T("Wick 2 blue pansies", "灯芯 2 朵蓝色三色堇"),
    title: T("Blue for the long nights", "长夜的蓝"),
    intro: say(
      A.calm,
      "Blue pansies keep their colour in lamplight. Could you find me two?",
      "蓝色三色堇在灯下不褪色。能帮我找两朵吗？",
    ),
    outro: say(A.happy, "They look like little bits of evening. Thank you.", "像一小片一小片的傍晚。谢谢你。"),
  }),
  request("wick", 3, {
    n: 3,
    item: 1012,
    what: T("Wick 3 mint", "灯芯 3 株薄荷"),
    title: T("Mint for the wick oil", "灯芯油里的薄荷"),
    intro: say(
      A.thinking,
      "A sprig of mint in the oil and the whole lane smells fresh. Three, if you can.",
      "油里放一枝薄荷，整条巷子都是清香。可以的话，三株。",
    ),
    outro: say(A.happy, "Smell that? That's your doing.", "闻到了吗？这是你的功劳。"),
  }),
  // ── Praline, the Corner Shop ──
  request("praline", 1, {
    n: 1,
    item: 11313,
    what: T("Praline a golden apple", "糖霜一个金苹果"),
    title: T("One for the window display", "橱窗里的一个"),
    intro: say(
      M.flat,
      "The window display needs one golden apple. Not to sell. To look at.",
      "橱窗要放一个金苹果。不是卖的，是摆着看的。",
    ),
    outro: say(
      M.laugh,
      "Perfect. Customers will stare at it and buy something else.",
      "完美。客人会盯着它看，然后买别的东西。",
    ),
  }),
  request("praline", 2, {
    n: 2,
    item: 11311,
    what: T("Praline 2 tree honey", "糖霜 2 份树蜜"),
    title: T("Honey for the counter jar", "柜台上的蜜罐"),
    intro: say(
      M.flat,
      "My counter jar is empty and Byakuya keeps looking at it. Two tree honey, please.",
      "我柜台上的罐子空了，白夜一直盯着看。请给我两份树蜜。",
    ),
    outro: say(M.laugh, "Full again. He has stopped looking at me like that.", "又满了。它终于不那样看我了。"),
  }),
  request("praline", 3, {
    n: 3,
    item: 1011,
    what: T("Praline 3 daffodils", "糖霜 3 朵水仙"),
    title: T("Flowers on the shelf", "货架上的花"),
    intro: say(
      M.flat,
      "The shelves look tired. Three daffodils would cheer them up. I won't say that twice.",
      "货架看起来没精神。三朵水仙能让它们高兴点。这话我不说第二遍。",
    ),
    outro: say(M.laugh, "Better. Don't tell anyone I like flowers.", "好多了。别告诉别人我喜欢花。"),
  }),
  // ── Yonder, the wayfinder ──
  request("yonder", 1, {
    n: 3,
    item: 1004,
    what: T("Yonder 3 pine cones", "阿远 3 颗松果"),
    title: T("Markers for the trail", "小路的路标"),
    intro: say(
      Z.day,
      "I mark new trails with pine cones. I'm three short for the one up the hill.",
      "我用松果给新路做记号。上山那条还差三颗。",
    ),
    outro: say(Z.pose, "There. Nobody will get lost on that one now.", "好了。现在没人会在那条路上迷路了。"),
  }),
  request("yonder", 2, {
    n: 1,
    item: 1019,
    what: T("Yonder a faraway coin", "阿远一枚远方硬币"),
    title: T("A coin from somewhere else", "别处来的硬币"),
    intro: say(
      Z.day,
      "I collect coins from places I haven't been. Found a faraway one? I'd love to see it.",
      "我收集没去过的地方的硬币。找到远方硬币了吗？我好想看看。",
    ),
    outro: say(
      Z.pose,
      "Pointy ears on the face. I'll find that place one day.",
      "上面的头像有尖耳朵。总有一天我会找到那个地方。",
    ),
  }),
  request("yonder", 3, {
    n: 2,
    item: 1003,
    what: T("Yonder 2 old bottles", "阿远 2 个旧瓶子"),
    title: T("Bottles for trail notes", "装路条的瓶子"),
    intro: say(
      Z.day,
      "I leave notes in bottles at the crossroads. Two more and the north road is done.",
      "我在路口留装在瓶子里的纸条。再有两个，北边的路就齐了。",
    ),
    outro: say(Z.pose, "Whoever finds them will know which way is home.", "谁捡到了，都会知道回家的路。"),
  }),
  // ── Twain, the scholar ──
  request("twain", 1, {
    n: 2,
    item: 11201,
    what: T("Twain 2 wisdom candies", "老吐 2 颗智慧糖"),
    title: T("Fuel for the night's reading", "夜读的燃料"),
    intro: say(
      D.frown,
      "I read better with a wisdom candy. I read best with two. Do not ask why.",
      "吃一颗智慧糖读得好。吃两颗读得最好。别问为什么。",
    ),
    outro: say(D.laugh, "Ha! Three chapters tonight. Perhaps four.", "哈！今晚三章，也许四章。"),
  }),
  request("twain", 2, {
    n: 1,
    item: 1007,
    what: T("Twain an amber", "老吐一块琥珀"),
    title: T("A thing to look through", "一块可以看穿的东西"),
    intro: say(
      D.frown,
      "There is a bug in amber that I wish to study. Any bug. Any amber.",
      "我想研究琥珀里的小虫。什么虫都行，什么琥珀都行。",
    ),
    outro: say(D.laugh, "Look at its little legs. Science.", "看它的小腿。这就是科学。"),
  }),
  request("twain", 3, {
    n: 2,
    item: 1014,
    what: T("Twain 2 chalkberries", "老吐 2 颗粉笔莓"),
    title: T("Chalk for the board", "黑板用的粉笔"),
    intro: say(
      D.frown,
      "My chalk ran out mid-sentence. Chalkberries write almost as well. Two, please.",
      "粉笔写到一半没了。粉笔莓也差不多能写。请给我两颗。",
    ),
    outro: say(D.laugh, "The sentence is finished. It was a very good sentence.", "那句话写完了。是很好的一句话。"),
  }),
  // ── Bolt, the tinker ──
  request("bolt", 1, {
    n: 3,
    item: 1017,
    what: T("Bolt 3 green pipes", "阿栓 3 根铜绿管"),
    title: T("Pipes for the pump", "水泵用的管子"),
    intro: say(
      R.one,
      "The village pump leaks. Three green pipes and I can fix it. Probably.",
      "村里的水泵漏水。有三根铜绿管我就能修好。大概吧。",
    ),
    outro: say(
      R.two,
      "It works! It also whistles now. I'm calling that a feature.",
      "修好了！现在还会吹口哨。我就当它是新功能。",
    ),
  }),
  request("bolt", 2, {
    n: 5,
    item: 1005,
    what: T("Bolt 5 scrap", "阿栓 5 片铁片"),
    title: T("Scrap for a small idea", "给小点子的铁片"),
    intro: say(
      R.one,
      "I have a small idea and it needs five scrap. Big ideas need more. Let's start small.",
      "我有个小点子，要五片铁片。大点子要更多。先从小的来。",
    ),
    outro: say(R.two, "It's a tiny windmill. It doesn't do anything. I love it.", "是个小风车。没什么用。我好喜欢。"),
  }),
  request("bolt", 3, {
    n: 2,
    item: 1302,
    what: T("Bolt 2 planks", "阿栓 2 块木板"),
    title: T("Planks for a new shelf", "新架子的木板"),
    intro: say(
      R.one,
      "My tools are on the floor again. Two planks would make them a shelf.",
      "我的工具又掉了一地。两块木板就能给它们做个架子。",
    ),
    outro: say(
      R.two,
      "A shelf! They'll be on the floor again by Thursday, but still.",
      "架子！到周四它们又会掉下来，不过还是谢谢。",
    ),
  }),
  // ── Flit, the butterfly keeper ──
  request("flit", 1, {
    n: 2,
    item: 11314,
    what: T("Flit 2 blue pansies", "蝶叔 2 朵蓝色三色堇"),
    title: T("A blue path for the butterflies", "给蝴蝶的蓝色小路"),
    intro: say(
      I,
      "The butterflies follow blue flowers. Two pansies and they'll find the meadow.",
      "蝴蝶跟着蓝色的花飞。两朵三色堇，它们就能找到草地。",
    ),
    outro: say(I, "There they go. Did you see the little one? It waved.", "飞过去了。看到那只小的了吗？它挥手了。"),
  }),
  request("flit", 2, {
    n: 3,
    item: 1011,
    what: T("Flit 3 daffodils", "蝶叔 3 朵水仙"),
    title: T("Yellow for the early ones", "给早起蝴蝶的黄色"),
    intro: say(
      I,
      "The early butterflies wake to yellow. Three daffodils by the gate would call them.",
      "早起的蝴蝶看到黄色才醒。门边放三朵水仙就能把它们叫来。",
    ),
    outro: say(I, "Here they come, one, two, three. They counted too.", "来了，一只、两只、三只。它们也在数。"),
  }),
  request("flit", 3, {
    n: 2,
    item: 1013,
    what: T("Flit 2 ruby mushrooms", "蝶叔 2 朵红宝石蘑菇"),
    title: T("Red for the moths", "给飞蛾的红色"),
    intro: say(
      I,
      "The night moths like a red mushroom to rest on. Two, if you see them.",
      "夜里的飞蛾喜欢停在红蘑菇上。看到的话，两朵。",
    ),
    outro: say(I, "Tonight they'll have somewhere soft to sit.", "今晚它们有软软的地方可以歇脚了。"),
  }),
  // ── Nurse Why, the clinic ──
  request("why", 1, {
    n: 3,
    item: 1012,
    what: T("Nurse Why 3 mint", "护士小为 3 株薄荷"),
    title: T("Mint for tummy tea", "治肚子疼的薄荷茶"),
    intro: say(
      W.lecture,
      "Half the village has eaten too many sweets. Three mint for a tummy tea, quickly.",
      "半个村子都吃多了甜的。快给我三株薄荷泡肚子茶。",
    ),
    outro: say(W.smile, "Thank you. Everyone will feel better by supper.", "谢谢你。晚饭前大家都会好起来的。"),
  }),
  request("why", 2, {
    n: 2,
    item: 1011,
    what: T("Nurse Why 2 daffodils", "护士小为 2 朵水仙"),
    title: T("Flowers for the waiting room", "候诊室的花"),
    intro: say(
      W.smile,
      "The waiting room is very serious. Two daffodils would make it less so.",
      "候诊室太严肃了。两朵水仙能让它轻松一点。",
    ),
    outro: say(
      W.smile,
      "Better. Nobody is scared of a room with daffodils in it.",
      "好多了。没人会害怕放着水仙的房间。",
    ),
  }),
  request("why", 3, {
    n: 2,
    item: 1014,
    what: T("Nurse Why 2 chalkberries", "护士小为 2 颗粉笔莓"),
    title: T("Berries for the poorly", "给病号的莓果"),
    intro: say(
      W.lecture,
      "Chalkberries are good for a pet who is getting better. Two, please, for my patients.",
      "粉笔莓对病快好的宠物很有好处。请给我两颗，给我的病号。",
    ),
    outro: say(W.smile, "They'll be back on their feet in no time.", "它们很快就能活蹦乱跳了。"),
  }),
  // ── Jab, the arena ──
  request("jab", 1, {
    n: 1,
    item: 11302,
    what: T("Jab a burger", "阿刺一个汉堡"),
    title: T("Lunch for a champion", "冠军的午饭"),
    intro: say(
      AR.grin,
      "Training makes me hungry. A burger. Now, please. Very politely now, please.",
      "训练完饿了。一个汉堡。现在就要。非常有礼貌地现在就要。",
    ),
    outro: say(
      AR.shrug,
      "Champion food. I could fight a wall. I won't. But I could.",
      "冠军的伙食。我能打赢一堵墙。我不会去打。但我能。",
    ),
  }),
  request("jab", 2, {
    n: 1,
    item: 11233,
    what: T("Jab a gingerbread pal", "阿刺一个姜饼小人"),
    title: T("A sparring partner who can't hit back", "不会还手的陪练"),
    intro: say(
      AR.grin,
      "I need a sparring partner who won't hit back. A gingerbread pal. Then I eat it. Training.",
      "我要一个不会还手的陪练。一个姜饼小人。练完就吃掉。这叫训练。",
    ),
    outro: say(AR.shrug, "It put up a good fight. It was delicious.", "它打得很顽强。也很好吃。"),
  }),
  request("jab", 3, {
    n: 2,
    item: 11304,
    what: T("Jab 2 cookie sticks", "阿刺 2 根饼干棒"),
    title: T("Snacks for the spectators", "给观众的零食"),
    intro: say(
      AR.grin,
      "People watch the spars and get peckish. Two cookie sticks for the stands.",
      "大家看切磋会嘴馋。给看台准备两根饼干棒。",
    ),
    outro: say(AR.shrug, "The crowd is happy. A happy crowd cheers louder.", "观众高兴了。高兴的观众喊得更响。"),
  }),
  // ── Nimbus, the sky dreamer ──
  request("nimbus", 1, {
    n: 1,
    item: 11409,
    what: T("Nimbus a sparkle soda", "云朵一瓶气泡汽水"),
    title: T("Bubbles to watch", "看泡泡"),
    intro: say(
      L.dream,
      "I like to watch the bubbles rise in a sparkle soda. They look like tiny clouds going home.",
      "我喜欢看气泡汽水里的泡泡往上冒。像小小的云在回家。",
    ),
    outro: say(L.smile, "Look, that one's racing. Go on, little cloud.", "看，那个在赛跑。加油，小云朵。"),
  }),
  request("nimbus", 2, {
    n: 1,
    item: 21203,
    what: T("Nimbus a cherry sundae", "云朵一份樱桃圣代"),
    title: T("A sundae for cloudwatching", "看云时吃的圣代"),
    intro: say(
      L.dream,
      "Cloudwatching is better with a cherry sundae. Everything is, really.",
      "看云的时候吃樱桃圣代更好。其实什么时候都更好。",
    ),
    outro: say(
      L.smile,
      "That cloud looks like the sundae. Coincidence? I think not.",
      "那朵云像圣代。巧合吗？我看不是。",
    ),
  }),
  request("nimbus", 3, {
    n: 2,
    item: 1003,
    what: T("Nimbus 2 old bottles", "云朵 2 个旧瓶子"),
    title: T("Bottles to catch a breeze", "装风的瓶子"),
    intro: say(
      L.dream,
      "I'm going to catch the morning breeze in a bottle. Two bottles, in case it's a big one.",
      "我要用瓶子装早上的风。两个瓶子，万一风很大呢。",
    ),
    outro: say(L.smile, "Listen. Hold it to your ear. Can you hear it?", "听。贴到耳边。听到了吗？"),
  }),
];

/** Round the residents: each one's first request, then each one's second, then third, so the askers take turns. */
export const REQUESTS: QuestDef[] = [1, 2, 3].flatMap((k) => BY_RESIDENT.filter((q) => q.id.endsWith(`-${k}`)));
