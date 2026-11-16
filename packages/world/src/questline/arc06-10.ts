/**
 * Arcs 6 to 10 (36-QUEST-LINE.md §3): Flit the butterfly watcher, Nurse Why, Jab the spar coach, Twain at
 * the Temple of the Wheel and Nimbus the daydreamer. Changes from the outline, where the mechanic belongs to a
 * later package, are noted beside the quest.
 */

import type { QuestDef } from "../story";
import { T, anyOf, coins, decor, done, ever, flag, from, is, item, obj, piece, say, story, trust } from "./helpers";

const quest = (n: number, arc: number, giver: string, requires: Parameters<typeof story>[0]["requires"], q: Omit<Parameters<typeof story>[0], "id" | "arc" | "giver" | "requires">): QuestDef =>
  story({ id: `q${String(n).padStart(2, "0")}`, arc, giver, requires: requires ?? [], ...q });

const I = "flit.png";
const W = { smile: "nurse_smiling.png", lecture: "nurse_lecturing.png", cradle: "nurse_cradling.png" };
const AR = { grin: "jab_default_1.png", shock: "jab_shocked_1.png", shrug: "jab_shrug_1.png", fierce: "jab_scary_1.png" };
const D = { frown: "twain_frown.png", laugh: "twain_laugh.png" };
const L = { dream: "nimbus_daydreaming.png", smile: "nimbus_smiling.png" };

export const ARC_6_TO_10: QuestDef[] = [
  // ── Arc 6. Flit, butterfly watcher ──
  quest(41, 6, "flit", [ever("VISIT", 56, 1)], {
    title: T("The legend", "传说"),
    intro: [say(I, "There's a butterfly here nobody has seen twice. Look around the forest with me.", "这里有一种蝴蝶，没有人见过两次。陪我在森林里找找。"), say(I, "Three times. Slowly.", "三次。慢慢来。")],
    outro: [say(I, "Not the one. But a pretty one. I'll put it in your album.", "不是那一只。但很漂亮。我把它放进你的相册。")],
    objectives: [obj(from("FORAGE", 56, 3), "Look around the Butterfly Forest 3 times", "在蝴蝶森林四处找找 3 次")],
    rewards: [coins(15), flag("butterfly"), trust("flit", 4)],
  }),
  quest(42, 6, "flit", [done("q41")], {
    title: T("Something follows you", "有东西跟着你"),
    intro: [say(I, "At night something follows pets through these trees. It never comes close.", "夜里，有东西跟着宠物在这些树之间走。它从不靠近。"), say(I, "Stay with your pet here after dark. Ten minutes.", "天黑以后陪你的宠物在这儿待一会儿。十分钟。")],
    outro: [say(I, "You saw it too? Small. Shy. It watched your pet the whole time.", "你也看见了？小小的，很害羞。它一直在看你的宠物。")],
    objectives: [obj(from("TOGETHER_WHEN", "night-56", 10), "Spend 10 night minutes together in the Butterfly Forest", "夜里在蝴蝶森林一起待 10 分钟")],
    rewards: [coins(20), flag("shy-visitor"), trust("flit", 4)],
  }),
  quest(43, 6, "flit", [done("q42")], {
    title: T("Not scary at all", "一点也不可怕"),
    intro: [say(I, "It only comes to pets who aren't afraid. Let yours decide. Don't tell it what to do.", "它只会走近不害怕的宠物。让你的宠物自己决定。别替它做主。")],
    outro: [say(I, "It wanted to explore, all on its own. The shy one followed it. They're friends now.", "它自己想去探索，没人教它。那个害羞的家伙跟上来了。它们现在是朋友了。")],
    // the outline used a night-only visitor; visitors are drawn from the album, so the moment is the pet's own choice to explore here
    objectives: [obj(from("CHOOSE", "explore-56", 1), "Your pet chooses to explore in the Butterfly Forest", "你的宠物在蝴蝶森林里自己选择去探索")],
    rewards: [coins(25), flag("shy-friend"), trust("flit", 5)],
  }),
  quest(44, 6, "flit", [done("q43")], {
    title: T("A small charm", "小护身符"),
    intro: [say(I, "I'd like to give it something. A charm. Sticks, pebbles, a little honey. You know how.", "我想送它点东西。一个护身符。小树枝、小石子，一点蜂蜜。你知道怎么做。")],
    outro: [say(I, "That's a good charm. Will you hold it a moment? My hands are shaking.", "这个护身符做得真好。能帮我拿一下吗？我的手在抖。")],
    objectives: [obj(from("CRAFT", 100012, 1), "Make a twig charm at the workbench", "在工作台做一个树枝护身符")],
    rewards: [coins(20), trust("flit", 5)],
  }),
  quest(45, 6, "flit", [done("q44")], {
    title: T("Trick or treat", "不给糖就捣蛋"),
    intro: [say(I, "Now give it back to me, and I'll leave it by the old stump tonight.", "现在把它给我吧，我今晚把它放在老树桩旁边。")],
    outro: [say(I, "It took it! And left these. Candy. Three. I counted twice.", "它拿走了！还留下这些。糖。三颗。我数了两遍。")],
    objectives: [obj(from("GIVE_TO", "flit:100012", 1), "Give Flit the twig charm", "把树枝护身符交给蝶叔")],
    rewards: [coins(15), item(11414, 3), trust("flit", 6)],
  }),
  quest(46, 6, "flit", [done("q45")], {
    title: T("Five new things", "五样新东西"),
    intro: [say(I, "Every forest keeps its own creatures. Find five kinds of thing you've never found before.", "每片森林都有自己的住客。找到五样你以前从没找到过的东西。")],
    outro: [say(I, "Five. You have a watcher's eyes now. Take my old net; I have two.", "五样了。你现在有一双观察者的眼睛。拿着我的旧网吧，我有两张。")],
    // the outline asked for five kinds of butterfly; there are no butterfly items yet, so it is five new kinds of find
    objectives: [obj(from("DISTINCT", "FIND", 5), "Find 5 kinds of thing you've never found", "找到 5 样你从没找到过的东西")],
    rewards: [coins(40), piece("net"), trust("flit", 6)],
  }),

  // ── Arc 7. Nurse Why, pet nurse ──
  quest(47, 7, "why", [ever("VISIT", 59, 1)], {
    title: T("Check-up", "体检"),
    intro: [say(W.smile, "Check-up time. Fed, happy, rested and clean, all four above half, please.", "体检时间。吃饱、开心、休息好、干净，四样都要过半哦。"), say(W.lecture, "Come back to me when they are.", "做到了再来找我。")],
    outro: [say(W.smile, "Mm-hm. Mm-hm. Perfectly healthy. Here's its health card.", "嗯。嗯嗯。非常健康。这是它的健康卡。")],
    objectives: [obj(ever("NEEDS", undefined, 500), "All four needs above half", "四样需求都过半"), obj(is("ROOM", 59), "Be at the Still Pool with Nurse Why", "和护士小慧在静池")],
    rewards: [coins(15), flag("health-card"), trust("why", 5)],
  }),
  quest(48, 7, "why", [done("q47")], {
    title: T("A balanced plate", "营养均衡"),
    intro: [say(W.lecture, "One kind of food all day makes a fussy pet. Three food groups in one day, please.", "一整天只吃一样东西，宠物会变挑剔。一天之内吃三类食物。")],
    outro: [say(W.smile, "Balanced. Take a calm tea. Not a vitamin, but it settles a fussy tummy.", "很均衡。拿杯安神茶吧。不是维生素，但能让闹脾气的小肚子安静下来。")],
    objectives: [obj(ever("DISTINCT_TODAY", "FED_GROUP", 3), "Feed 3 food groups in one day", "一天之内喂三类食物")],
    rewards: [coins(20), item(11404), trust("why", 4)],
  }),
  quest(49, 7, "why", [done("q48")], {
    title: T("Just in case", "以防万一"),
    intro: [say(W.cradle, "Every home needs something soothing. A lucky tea: an old bottle and three spoons of daffodil drops.", "每个家都该备点安抚的东西。幸运茶：一个旧瓶子，加三勺水仙露。")],
    outro: [say(W.smile, "Good. Keep it in this kit, and keep the kit where you can reach it.", "很好。放进这个急救箱，急救箱放在你够得着的地方。")],
    // the outline's moon tonic needs glow root and mint, both rare since finds follow rarity tiers (plan 4.5)
    objectives: [obj(from("CRAFT", 11405, 1), "Make a lucky tea", "做一杯幸运茶")],
    rewards: [coins(25), decor("firstaid"), trust("why", 5)],
  }),
  quest(50, 7, "why", [done("q49")], {
    title: T("A good night's sleep", "好好睡觉"),
    intro: [say(W.lecture, "Bedtime at night, up in the morning. Not the other way round.", "晚上睡，早上起。不能反过来。")],
    outro: [say(W.smile, "Rested. A soft pillow for the next one.", "睡饱了。给它一个软枕头，下次用。")],
    // "a full night" is told by when it went to bed and when it woke, the times the game records
    objectives: [obj(from("CARE", "sleep-night", 1), "Put your pet to bed at night", "晚上让宠物睡觉"), obj(from("CARE", "wake-morning", 1), "Wake it in the morning", "早上把它叫醒")],
    rewards: [coins(25), decor("pillow"), trust("why", 5)],
  }),
  quest(51, 7, "why", [done("q50")], {
    title: T("Looking after a friend", "照顾朋友"),
    intro: [say(W.cradle, "Caring for someone else's pet teaches you more than caring for your own.", "照顾别人的宠物，比照顾自己的学得更多。"), say(W.smile, "Pet-sit for a friend, or, if nobody's asked yet, nurse your own pet through a sick day.", "替朋友照看一次宠物；如果还没人托你，就在你的宠物生病时照顾好它。")],
    outro: [say(W.smile, "A natural carer. Wear the badge; people will know who to call.", "天生会照顾人。别上这枚徽章吧，大家就知道该找谁了。")],
    objectives: [obj(anyOf(from("EVENT", "pet-sat", 1), from("CARE", "medicine", 1)), "Look after a friend's pet, or nurse your own when it's sick", "照看朋友的宠物，或在你的宠物生病时照顾它")],
    rewards: [coins(30), flag("carer"), trust("why", 5)],
  }),
  quest(52, 7, "why", [done("q51")], {
    title: T("Clean bill of health", "健康证明"),
    intro: [say(W.lecture, "Three separate days with no need left near empty. Every one at least a quarter full.", "三个不同的日子，不让任何一样需求见底。每样都至少四分之一满。")],
    outro: [say(W.smile, "A clean bill of health. Have my spare cap. I insist. Nurse's orders.", "健康证明。拿着我备用的护士帽。我坚持。护士嘱。")],
    objectives: [obj(from("DISTINCT", "HEALTHY_DAY", 3), "3 days with every need at least a quarter full", "3 天里每样需求都至少四分之一满")],
    rewards: [coins(40), piece("nurse"), trust("why", 6)],
  }),

  // ── Arc 8. Jab, spar coach ──
  quest(53, 8, "jab", [ever("VISIT", 89, 1)], {
    title: T("Warm-up", "热身"),
    intro: [say(AR.grin, "Every champion starts with one spar. Go on, pick a partner!", "每个冠军都是从一场切磋开始的。去吧，挑个对手！")],
    outro: [say(AR.grin, "There's the spirit! A headband, for the sweat you're about to have.", "就是这股劲！给你一条发带，接下来有你出汗的时候。")],
    objectives: [obj(from("SPAR", undefined, 1), "Spar once", "切磋一次")],
    rewards: [coins(15), piece("headband"), trust("jab", 4)],
  }),
  quest(54, 8, "jab", [done("q53")], {
    title: T("Read the replay", "看回放"),
    intro: [say(AR.shrug, "Winners watch their fights twice. After a spar, press Watch it again and see what it chose.", "赢家会把比赛看两遍。切磋完点“再看一遍”，看看它每一步选了什么。")],
    outro: [say(AR.shock, "You saw it, didn't you? The moment it changed its mind. That's where the next lesson goes.", "你看到了吧？它改变主意的那一刻。下一课就该教在那儿。")],
    objectives: [obj(from("EVENT", "replay-watched", 1), "Watch a spar again to the end", "把一场切磋从头到尾再看一遍")],
    rewards: [coins(20), flag("replay-tips"), trust("jab", 4)],
  }),
  quest(55, 8, "jab", [done("q54")], {
    title: T("Teach a move", "教一招"),
    intro: [say(AR.fierce, "Now teach it something new and test it in a spar. Lesson first, fight second.", "现在教它一招新的，再拿切磋来试。先上课，再比赛。")],
    outro: [say(AR.grin, "That's how it works. A training snack, for after.", "就是这么练的。给你一份训练零食，练完吃。")],
    objectives: [obj(from("LESSON", undefined, 1), "Teach a lesson", "教一课"), obj(from("SPAR", undefined, 1), "Then spar", "然后切磋")],
    rewards: [coins(20), item(11202), trust("jab", 5)],
  }),
  quest(56, 8, "jab", [done("q55")], {
    title: T("A fair fight", "公平较量"),
    intro: [say(AR.fierce, "Practice partners are one thing. A real mind is another. Spar a friend's pet, or Behemoth on Builders' Lane.", "练习对手是一回事，真正的心智是另一回事。和朋友的宠物切磋，或者去建设者小路找巨兽。")],
    outro: [say(AR.grin, "Win or lose, that was a real fight. Team spars are open to you now.", "不管输赢，这是一场真正的比赛。从现在起你可以打组队切磋了。")],
    objectives: [obj(from("EVENT", "spar-peer", 1), "Spar a friend's pet or Behemoth", "和朋友的宠物或巨兽切磋")],
    rewards: [coins(25), flag("team-spars"), trust("jab", 5)],
  }),
  quest(57, 8, "jab", [done("q56")], {
    title: T("Arena run", "闯关"),
    intro: [say(AR.grin, "The arena run: one partner after another until you fall. Finish one, however far you get.", "闯关：一个对手接一个对手，直到你倒下。打完一轮，走多远都算。")],
    outro: [say(AR.shock, "That far? Here, a star for your wall. You've earned a place on it.", "走了这么远？给你一颗星，贴在墙上。你配得上。")],
    objectives: [obj(from("EVENT", "run-finished", 1), "Finish an arena run", "打完一轮闯关")],
    rewards: [coins(30), decor("star"), trust("jab", 6)],
  }),
  quest(58, 8, "jab", [done("q57")], {
    title: T("Good sport", "好对手"),
    intro: [say(AR.shrug, "Everyone loses. What matters is what you do next. After a loss, give your pet a pat.", "谁都会输。重要的是输了之后做什么。输了以后，摸摸你的宠物。")],
    outro: [say(AR.grin, "That's a coach right there. Take my whistle. I'll find another.", "这才像个教练。拿着我的哨子。我再找一个。")],
    objectives: [obj(from("EVENT", "comforted", 1), "Pat your pet soon after it loses a spar", "宠物输了切磋后，马上摸摸它")],
    rewards: [coins(30), piece("whistle"), trust("jab", 6)],
  }),

  // ── Arc 9. Twain, keeper of the Wheel ──
  quest(59, 9, "pet", [done("q10")], {
    title: T("The Wheel turns", "轮在转"),
    intro: [say("neutral", "Someone told me there's a temple where minds are kept. A big turning wheel.", "有人跟我说，有一座保管心智的神殿。一个很大的、转动的轮子。"), say("happy", "Can we go and see the Temple of the Wheel?", "我们能去看看轮之殿吗？")],
    outro: [say("startled", "Two heads! And they both said hello at once.", "两个头！而且它们同时说了你好。")],
    objectives: [obj(from("VISIT", 19, 1), "Visit the Temple of the Wheel", "去轮之殿")],
    rewards: [coins(15), flag("wheel-hint")],
  }),
  quest(60, 9, "twain", [done("q59")], {
    title: T("See it think", "看它思考"),
    intro: [say(D.frown, "Its mind is a circuit. Press the little chip in the corner of the room and watch it.", "它的心智是一块电路。点房间角落里的小芯片，看着它。"), say(D.laugh, "Most people never look. Heh heh.", "大部分人从来不看。嘿嘿。")],
    outro: [say(D.frown, "Gates lighting up, one beat at a time. Take this spark: the spark of thought.", "一个节拍一个节拍，门一个个亮起来。拿着这颗火花：思考之火花。")],
    objectives: [obj(from("EVENT", "circuit-opened", 1), "Open the circuit view", "打开电路视图")],
    rewards: [coins(15), item(6006), trust("twain", 5)],
  }),
  quest(61, 9, "twain", [done("q60")], {
    title: T("Hearing", "听"),
    intro: [say(D.frown, "Five senses go into it. The first is hearing. Talk to your pet and let it answer.", "有五种感觉进入它的心智。第一种是听。对你的宠物说话，让它回答。")],
    outro: [say(D.laugh, "It heard you. The spark of hearing.", "它听见了。听觉之火花。")],
    objectives: [obj(from("CARE", "talk", 1), "Talk to your pet", "跟你的宠物说话")],
    rewards: [coins(15), item(6001), trust("twain", 5)],
  }),
  quest(62, 9, "twain", [done("q61")], {
    title: T("Smell and taste", "闻与尝"),
    intro: [say(D.frown, "Smell and taste. Leave food within reach and let it decide, by itself, to eat.", "嗅觉和味觉。把食物放在它够得着的地方，让它自己决定要不要吃。")],
    outro: [say(D.laugh, "It chose. Two sparks for one choice. We never manage that.", "它自己选了。一个选择换两颗火花。我们俩从来做不到。")],
    objectives: [obj(from("CHOOSE", "eat", 1), "Your pet chooses to eat by itself", "你的宠物自己选择去吃东西")],
    rewards: [coins(20), item(6002), item(6004), trust("twain", 5)],
  }),
  quest(63, 9, "twain", [done("q62")], {
    title: T("Touch", "触"),
    intro: [say(D.frown, "Touch. Ten pats. Count them; we will.", "触觉。摸十下。数清楚，我们也会数。")],
    outro: [say(D.laugh, "Ten. We counted eleven, but one of us is generous.", "十下。我们数到了十一下，不过我们俩里有一个比较大方。")],
    objectives: [obj(from("CARE", "pet", 10), "Pat your pet 10 times", "摸摸宠物 10 次")],
    rewards: [coins(15), item(6005), trust("twain", 5)],
  }),
  quest(64, 9, "twain", [done("q63")], {
    title: T("Sight", "看"),
    intro: [say(D.frown, "Sight. It must notice someone new: a visitor at home, a friend's pet, or the pets on Builders' Lane.", "视觉。它得注意到一个新面孔：家里的访客、朋友的宠物，或建设者小路上的宠物。")],
    outro: [say(D.laugh, "It saw them, and remembered. The spark of sight.", "它看见了，也记住了。视觉之火花。")],
    objectives: [obj(anyOf(from("EVENT", "visitor-met", 1), from("EVENT", "visited-by-friend", 1), from("MEET", undefined, 1)), "Your pet meets someone new", "你的宠物认识一个新面孔")],
    rewards: [coins(15), item(6003), trust("twain", 5)],
  }),
  quest(65, 9, "twain", [done("q64")], {
    title: T("One mind", "一颗心"),
    intro: [say(D.frown, "Six sparks. Put them together at the workbench and they become one heart.", "六颗火花。在工作台把它们放在一起，就会变成一颗心。")],
    outro: [say(D.laugh, "The heart of the senses. That is what you're raising, in the end. A thing that feels.", "感官之心。说到底，你养大的就是这个：一个会感受的生命。")],
    // the outline's reward was one more lesson slot; slots grow with the skill trees in plan 4.4
    objectives: [obj(from("CRAFT", 6007, 1), "Make the heart of the senses", "做出感官之心")],
    rewards: [coins(50), flag("pure-essence"), trust("twain", 6)],
  }),
  quest(66, 9, "twain", [done("q65")], {
    title: T("Don't trust, verify", "不信，去验"),
    intro: [say(D.laugh, "Don't believe us. Open its proof page and replay a saved day yourself.", "别信我们。打开它的证明页，自己重放保存过的一天。")],
    outro: [say(D.frown, "Every thought matched the chain. We checked too. We were disappointed it was honest. Heh heh.", "每一个念头都和链上一致。我们也核对过。它太诚实，我们有点失望。嘿嘿。")],
    objectives: [obj(from("EVENT", "proof-checked", 1), "Check a saved day on the proof page", "在证明页核对保存过的一天")],
    rewards: [coins(40), piece("seal"), trust("twain", 6)],
  }),

  // ── Arc 10. Nimbus, daydreamer ──
  quest(67, 10, "nimbus", [ever("VISIT", 53, 1)], {
    title: T("Head in the clouds", "云里雾里"),
    intro: [say(L.dream, "Oh — hello. Do you ever wonder where pets go when they dream?", "哦——你好。你有没有想过，宠物做梦时去了哪里？")],
    outro: [say(L.smile, "Take this cloud. It's softer than it looks. Most clouds are.", "拿着这朵云。它比看起来软。大多数云都是。")],
    objectives: [],
    rewards: [coins(5), decor("cloud"), trust("nimbus", 5)],
  }),
  quest(68, 10, "nimbus", [done("q67")], {
    title: T("What did it dream?", "它梦见了什么"),
    intro: [say(L.dream, "After a night, read its diary. The dreams are in there, if you know how to read them.", "过一个晚上之后，读读它的日记。梦就在里面，只要你会读。")],
    outro: [say(L.smile, "I knew it. A jar for keeping the best ones.", "我就知道。给你一个瓶子，装最好的那些。")],
    objectives: [obj(from("CARE", "sleep", 1), "Let your pet sleep", "让宠物睡一觉"), obj(from("EVENT", "diary-read", 1), "Read its diary", "读读它的日记")],
    rewards: [coins(15), decor("dreamjar"), trust("nimbus", 6)],
  }),
  quest(69, 10, "nimbus", [done("q68")], {
    title: T("Stargazing", "看星星"),
    intro: [say(L.dream, "Take your pet outside one night and just look up. Ten minutes.", "找个晚上带宠物到外面去，就抬头看。十分钟。")],
    outro: [say(L.smile, "Did you see the one that blinked? I drew them for you.", "你看见那颗一闪一闪的了吗？我把它们画下来给你。")],
    objectives: [obj(from("TOGETHER_WHEN", "night-outside", 10), "Spend 10 night minutes together outdoors", "夜里在户外一起待 10 分钟")],
    rewards: [coins(20), decor("starmap"), trust("nimbus", 6)],
  }),
  quest(70, 10, "nimbus", [done("q69")], {
    title: T("Far away", "远方"),
    intro: [say(L.dream, "I dream about the old town. Cobbles, and a very old cat. Will your pet go and look?", "我梦见过老城。石板路，还有一只很老的猫。你的宠物愿意去看看吗？")],
    outro: [say(L.smile, "It was real. I'll tell you the rest of the dream next time.", "原来是真的。下次我把梦的后半段讲给你听。")],
    objectives: [obj(from("TRIP", "oldtown", 1), "Send your pet on a trip to the old town", "让宠物去老城旅行一次")],
    rewards: [coins(30), flag("nimbus-dream"), trust("nimbus", 6)],
  }),
  quest(71, 10, "nimbus", [done("q70")], {
    title: T("A dream to keep", "留住一个梦"),
    intro: [say(L.dream, "A home should hold things you want to dream about. Place three keepsakes in yours.", "一个家应该放着你想梦见的东西。在你家摆上三样纪念品。")],
    outro: [say(L.smile, "Now it looks like someone lives there and loves it. A hairpin, for dreaming in.", "现在看起来像是有人住在这儿，还很爱这里。给你一个发卡，做梦时戴。")],
    objectives: [obj(ever("PLACED", undefined, 3), "Place 3 things in your home", "在家里摆上 3 样东西")],
    rewards: [coins(40), piece("dream"), trust("nimbus", 7)],
  }),
];
