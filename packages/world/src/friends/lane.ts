/**
 * The five Builders' Lane pets as friends (plan 4.3). They live on their cards, not in talk, so their steps and
 * topics are read there. At level 3 each offers a story or a keepsake; at level 5 they send a photo instead of
 * visiting (a lane pet keeps its post).
 */

import type { FriendSheet } from "../friendship";
import { T, friend, say, topic } from "./helpers";

const STORY = T("Tell me a story", "给我讲个故事");
const KEEPSAKE = T("Give me a keepsake", "送我个纪念");
/** lane pets speak without a portrait */
const line = (en: string, zh: string) => ({ face: "", en, zh });

export const LANE_FRIENDS: readonly FriendSheet[] = [
  friend({
    id: "behemoth",
    kind: "lane",
    likes: { love: [1303, 6006], like: [1103, 1302, 1005], dislike: [21201] },
    reactions: {
      love: say(undefined, "Metal! I'll count it. 1, 2, 3, 5… it's one bar. Still: all in! 💪", "金属！我数数。1、2、3、5……就一根。没关系：全力以赴！💪"),
      like: say(undefined, "A useful thing. My gates hum when I hold it.", "有用的东西。我拿着它，门都在嗡嗡响。"),
      neutral: say(undefined, "Thank you. I have no input, but I'll keep it anyway.", "谢谢。我没有输入口，不过我还是收下了。"),
      dislike: say(undefined, "Ice cream near a chip? It would short. Keep it, please.", "冰淇淋靠近芯片？会短路的。你留着吧。"),
    },
    steps: {
      s1: { title: T("How I count", "我怎么数数"), lines: [say(undefined, "You stayed for the whole count. Most people leave at 8.", "你看完了整个数数。大多数人数到 8 就走了。")], unlock: topic(T("How I count", "我怎么数数"), [line("Each number is the two before it, added. My CPU holds four bits, so 13 is my ceiling.", "每个数是前两个相加。我的处理器只有四位，所以 13 是我的上限。"), line("Then I wrap around and start again. Forever. Nobody can unplug me.", "然后从头再来。永远。没有人能拔掉我的电源。")]) },
      s2: { title: T("A spare gate", "多出来的门"), lines: [say(undefined, "Take this dust. It fell off me while counting.", "拿着这些粉。是我数数时掉下来的。")], unlock: { kind: "gift", rewards: [{ kind: "item", item: 1103, n: 200 }] } },
      s3a: { choice: STORY, title: T("The first computer", "第一台计算机"), lines: [say(undefined, "I'll tell you where I came from.", "我告诉你我是从哪儿来的。")], unlock: topic(T("Where I came from", "我从哪里来"), [line("I'm a tribute to the founder's first computer on chain: four bits, every gate public.", "我是在致敬创始人的第一台链上计算机：四位，每一扇门都公开。"), line("Small, slow, and nobody's to switch off. That's what all in means.", "小、慢，谁也关不掉。这就是全力以赴的意思。")]) },
      s3b: { choice: KEEPSAKE, title: T("A bar of my own", "我的一根金属条"), lines: [say(undefined, "Here. A metal bar. It's what I'm made of, more or less.", "给。一根金属条。我差不多就是用它做的。")], unlock: { kind: "gift", rewards: [{ kind: "item", item: 1303, n: 1 }, { kind: "coins", n: 20 }] } },
      s4: { title: T("What's the use case", "有什么用"), lines: [say(undefined, "People ask what I'm for. You've earned the real answer.", "大家问我有什么用。你值得听真正的答案。")], unlock: topic(T("What I'm for", "我有什么用"), [line("I'm proof. Every step I take, anyone can check against the chain, and they all agree.", "我就是证明。我走的每一步，任何人都能拿链上的记录核对，结果都一样。"), line("A thing that does what it says, forever. Come closer; that's the use case.", "一个永远说到做到的东西。靠近点，这就是用处。")]) },
      s5: { title: T("A photo from the far end", "从小路尽头寄来的照片"), lines: [say(undefined, "I can't leave the lane. So here is a photo of me at 13, glowing.", "我离不开这条小路。给你一张我数到 13 发光的照片。")], unlock: { kind: "gift", rewards: [{ kind: "coins", n: 40 }, { kind: "item", item: 6006, n: 1 }] } },
      s6: { title: T("Kindred circuits", "相通的电路"), lines: [say(undefined, "You and your pet are circuits too. Take this; let it glow at your home.", "你和你的宠物也是电路。拿着这个，让它在你家发光。")], unlock: { kind: "gift", rewards: [{ kind: "decor", id: "crystal" }] } },
    },
  }),
  friend({
    id: "mars",
    kind: "lane",
    likes: { love: [1019, 11409], like: [21203, 1103, 11408], dislike: [1016] },
    reactions: {
      love: say(undefined, "👀 A coin from far away! gBEM! You've been exploring.", "👀 远方的硬币！gBEM！你一直在探索。"),
      like: say(undefined, "Nice! I'll watch the sky with it.", "不错！我拿着它看天空。"),
      neutral: say(undefined, "Thanks, friend. Did you TapeOut today?", "谢谢，朋友。今天你 TapeOut 了吗？"),
      dislike: say(undefined, "Dried stems block the telescope. Keep them, please.", "干菌柄会挡住望远镜。你留着吧。"),
    },
    steps: {
      s1: { title: T("What I watch for", "我在看什么"), lines: [say(undefined, "You keep coming to my path. Let me show you what I watch for.", "你总来我这条路。我给你看我在看什么。")], unlock: topic(T("What I watch for", "我在看什么"), [line("Every circuit taped out on X Layer lights up the sky for a moment.", "X Layer 上每流片一块电路，天空就亮一下。"), line("I count them and cheer for each one. Some days there are many. 👀", "我数着，给每一块加油。有些日子特别多。👀")]) },
      s2: { title: T("Starlight", "星光"), lines: [say(undefined, "A sparkle soda, for watching the sky with.", "一瓶气泡汽水，看天空的时候喝。")], unlock: { kind: "gift", rewards: [{ kind: "item", item: 11409, n: 1 }] } },
      s3a: { choice: STORY, title: T("Who I cheer for", "我为谁加油"), lines: [say(undefined, "I'll tell you who I'm modelled on.", "我告诉你我是照着谁做的。")], unlock: topic(T("Who I'm modelled on", "我是照着谁做的"), [line("Someone who asks every builder the same question each morning: did you TapeOut today?", "一个每天早上都问每个建设者同一个问题的人：今天你 TapeOut 了吗？"), line("Cheering costs nothing and builds a lot. So I cheer.", "加油不花钱，却能成就很多。所以我加油。")]) },
      s3b: { choice: KEEPSAKE, title: T("A lens to keep", "一块镜片"), lines: [say(undefined, "A spare telescope lens. Well, a coin. It's round. Close enough.", "一块备用镜片。好吧，是枚硬币。都是圆的，差不多。")], unlock: { kind: "gift", rewards: [{ kind: "item", item: 1019, n: 1 }, { kind: "coins", n: 20 }] } },
      s4: { title: T("The busiest night", "最忙的一夜"), lines: [say(undefined, "You've earned the story of the busiest sky.", "你值得听最热闹的那片天空。")], unlock: topic(T("The busiest sky", "最热闹的天空"), [line("One night the whole sky lit up at once: everyone shipped together.", "有一夜整个天空同时亮了：大家一起上线了。"), line("I cheered until I lost my voice. Best night of my life. gBEM!", "我喊到嗓子哑。那是我这辈子最棒的一夜。gBEM！")]) },
      s5: { title: T("A photo of the sky", "天空的照片"), lines: [say(undefined, "I can't leave my post, so here's a photo of the sky the night you came.", "我离不开岗位，给你一张你来那晚的天空照片。")], unlock: { kind: "gift", rewards: [{ kind: "coins", n: 40 }, { kind: "item", item: 11408, n: 1 }] } },
      s6: { title: T("A star for your home", "给你家的星星"), lines: [say(undefined, "You're one of the lights I watch for now. Hang this at home.", "你现在也是我守望的光之一了。把它挂在家里。")], unlock: { kind: "gift", rewards: [{ kind: "decor", id: "star" }] } },
    },
  }),
  friend({
    id: "tapboy",
    kind: "lane",
    likes: { love: [11401, 11201], like: [11402, 1112, 11304], dislike: [11408] },
    reactions: {
      love: say(undefined, "Study Tea. GMGM! This is how I focus.", "学习茶。GMGM！我就是靠这个专注的。"),
      like: say(undefined, "Thanks. Back to studying.", "谢谢。继续修炼了。"),
      neutral: say(undefined, "GMGM. I'll keep it by my handheld.", "GMGM。我把它放在掌机旁边。"),
      dislike: say(undefined, "Bells. Noise. Shut out the noise… please keep them.", "铃铛。噪音。摒弃杂音……请你留着吧。"),
    },
    steps: {
      s1: { title: T("Day count", "第几天"), lines: [say(undefined, "You keep visiting. I'll tell you which day this is.", "你一直来看我。我告诉你今天是第几天。")], unlock: topic(T("Out of a thousand", "一千天里"), [line("I count my days out of a thousand. Not to finish, just to keep going.", "我在数一千天里的第几天。不是为了数完，只是为了一直走下去。"), line("Build. Prove. Grow. One day at a time.", "Build. Prove. Grow. 一天一天来。")]) },
      s2: { title: T("Study snacks", "修炼零食"), lines: [say(undefined, "Cookie sticks. Studying is hungry work.", "饼干棒。修炼很耗体力。")], unlock: { kind: "gift", rewards: [{ kind: "item", item: 11304, n: 2 }] } },
      s3a: { choice: STORY, title: T("The handheld", "那台掌机"), lines: [say(undefined, "I'll tell you about my handheld.", "我给你讲讲我的掌机。")], unlock: topic(T("The handheld", "那台掌机"), [line("I'm a tribute to someone who put a TapeOut CPU inside a handheld. A real one.", "我在致敬一个把 TapeOut 处理器装进掌机的人。真的装进去了。"), line("Proof you can hold in your hand. That's why I never put mine down.", "能握在手里的证明。所以我从不放下它。")]) },
      s3b: { choice: KEEPSAKE, title: T("A cup of focus", "一杯专注"), lines: [say(undefined, "Here, my best tea. For your own study.", "给，我最好的茶。你自己修炼时喝。")], unlock: { kind: "gift", rewards: [{ kind: "item", item: 11401, n: 1 }, { kind: "coins", n: 20 }] } },
      s4: { title: T("The noisy day", "嘈杂的那天"), lines: [say(undefined, "There was a day I almost stopped counting.", "有一天我差点不数了。")], unlock: topic(T("The day I nearly stopped", "差点停下的那天"), [line("Everyone was shouting about something new. I put the handheld down for the first time.", "大家都在为新东西大喊大叫。我第一次放下了掌机。"), line("Then I picked it up again. The noise left. The count stayed.", "后来我又拿了起来。噪音散了，数字还在。")]) },
      s5: { title: T("A photo from the shade", "树荫下的照片"), lines: [say(undefined, "A photo of me studying. Day count in the corner.", "一张我修炼的照片。角落写着第几天。")], unlock: { kind: "gift", rewards: [{ kind: "coins", n: 40 }, { kind: "item", item: 11402, n: 1 }] } },
      s6: { title: T("Books for the road", "路上的书"), lines: [say(undefined, "You kept coming, day after day. Take these; your home deserves a shelf of them.", "你一天又一天地来。拿着这些书，你家值得有一书架。")], unlock: { kind: "gift", rewards: [{ kind: "decor", id: "books" }] } },
    },
  }),
  friend({
    id: "builder",
    kind: "lane",
    likes: { love: [1301, 1302], like: [1303, 1001, 11302], dislike: [21205] },
    reactions: {
      love: say(undefined, "Building material! On we go.", "建材！继续干。"),
      like: say(undefined, "Useful. It's the product, period.", "有用。做产品才是正事。"),
      neutral: say(undefined, "Thanks. Back to work.", "谢谢。回去干活了。"),
      dislike: say(undefined, "Rock candyfloss on the site? It sticks to everything. Keep it.", "工地上放棉花岩糖？会粘得到处都是。你留着吧。"),
    },
    steps: {
      s1: { title: T("What I'm building", "我在建什么"), lines: [say(undefined, "You stopped by the site again. I'll show you what I'm building.", "你又来工地了。给你看看我在建什么。")], unlock: topic(T("What I'm building", "我在建什么"), [line("The road out of your home. Every plank on it, I laid.", "从你家出去的那条路。上面每一块木板都是我铺的。"), line("Ignore the noise, go to work. The road gets longer every day.", "别管噪音，去干活。路每天都会长一点。")]) },
      s2: { title: T("Spare planks", "多余的木板"), lines: [say(undefined, "Two planks. Build something.", "两块木板。去建点什么。")], unlock: { kind: "gift", rewards: [{ kind: "item", item: 1302, n: 2 }] } },
      s3a: { choice: STORY, title: T("Who builds the chain", "谁在建这条链"), lines: [say(undefined, "I'll tell you who I'm modelled on.", "我告诉你我是照着谁做的。")], unlock: topic(T("Who I'm modelled on", "我是照着谁做的"), [line("Someone who builds X Layer and says it plainly: it's the product, period.", "一个建设 X Layer 的人，他说得很直白：做产品才是正事。"), line("Builders attract builders. That's why there's a whole lane of us.", "建设者吸引建设者。所以才有了我们这一整条小路。")]) },
      s3b: { choice: KEEPSAKE, title: T("A stone for your foundations", "给你打地基的石头"), lines: [say(undefined, "Stone blocks. Every good home starts with these.", "石块。每个好家都从这个开始。")], unlock: { kind: "gift", rewards: [{ kind: "item", item: 1301, n: 2 }, { kind: "coins", n: 20 }] } },
      s4: { title: T("The road that washed out", "被冲毁的路"), lines: [say(undefined, "You've earned the story of the flood.", "你值得听那场洪水的故事。")], unlock: topic(T("The flood", "那场洪水"), [line("Rain took half the road in one night. Everyone said rebuild later.", "一夜大雨冲走了半条路。大家都说以后再修。"), line("I started at dawn. By evening you couldn't tell. On we go.", "我天一亮就开工。到傍晚已经看不出来了。继续干。")]) },
      s5: { title: T("A photo from the site", "工地的照片"), lines: [say(undefined, "A photo of the road, finished as far as your door.", "一张那条路的照片，一直铺到了你家门口。")], unlock: { kind: "gift", rewards: [{ kind: "coins", n: 40 }, { kind: "item", item: 1303, n: 1 }] } },
      s6: { title: T("A rug for the builder's home", "建设者之家的地毯"), lines: [say(undefined, "Your home is built well. Here's something to finish it.", "你家建得很好。给你一样东西收个尾。")], unlock: { kind: "gift", rewards: [{ kind: "decor", id: "rug" }] } },
    },
  }),
  friend({
    id: "diver",
    kind: "lane",
    likes: { love: [21007, 1007], like: [1002, 1006, 11301], dislike: [11302] },
    reactions: {
      love: say(undefined, "A river box! Blub. I'll write about this for a week.", "河底宝箱！咕噜。我要写一个星期的日记。"),
      like: say(undefined, "Noted in the diary. Thank you.", "已记入日记。谢谢。"),
      neutral: say(undefined, "Observation: a gift. Blub.", "观察记录：一份礼物。咕噜。"),
      dislike: say(undefined, "Burgers get soggy underwater. Keep it, please.", "汉堡在水下会泡烂。你留着吧。"),
    },
    steps: {
      s1: { title: T("Today's observation", "今日观察"), lines: [say(undefined, "You watch the river too. I'll read you a page.", "你也在看河。我给你念一页。")], unlock: topic(T("A page of the diary", "日记的一页"), [line("Observation: the river is slow today. Slow water carves the deepest stone.", "观察：今天河水很慢。慢水刻出最深的石头。"), line("I write one line a day. Slow building beats quick money.", "我每天写一行。慢慢建设，胜过快钱。")]) },
      s2: { title: T("River pebbles", "河里的卵石"), lines: [say(undefined, "Pebbles from the riverbed. Each one took a thousand years.", "河床上的卵石。每一颗都花了一千年。")], unlock: { kind: "gift", rewards: [{ kind: "item", item: 1002, n: 3 }] } },
      s3a: { choice: STORY, title: T("Who keeps the diary", "谁在写日记"), lines: [say(undefined, "I'll tell you who I'm modelled on.", "我告诉你我是照着谁做的。")], unlock: topic(T("Who I'm modelled on", "我是照着谁做的"), [line("A diving observer who writes what he sees, every single day, and shares it.", "一位潜水观察员，每天写下他看到的，并分享出来。"), line("I watch first. Then I write it down. That's the whole method.", "我先看，再记下来。这就是全部的方法。")]) },
      s3b: { choice: KEEPSAKE, title: T("A piece of amber", "一块琥珀"), lines: [say(undefined, "Amber from the deep pool. Something old is inside.", "深潭里的琥珀。里面有很古老的东西。")], unlock: { kind: "gift", rewards: [{ kind: "item", item: 1007, n: 1 }, { kind: "coins", n: 20 }] } },
      s4: { title: T("The deepest dive", "最深的一次潜水"), lines: [say(undefined, "You've earned the deepest page.", "你值得读最深的那一页。")], unlock: topic(T("The deepest dive", "最深的一次潜水"), [line("At the bottom of the pool there's a stone with every pet's name scratched on it.", "潭底有一块石头，上面刻着每一只宠物的名字。"), line("Yours is there now. I checked. Blub.", "你的名字现在也在上面了。我看过了。咕噜。")]) },
      s5: { title: T("A photo from the river", "河边的照片"), lines: [say(undefined, "An underwater photo. That blur is me waving.", "一张水下照片。那团模糊的是我在挥手。")], unlock: { kind: "gift", rewards: [{ kind: "coins", n: 40 }, { kind: "item", item: 21007, n: 1 }] } },
      s6: { title: T("A fern from the bank", "河岸边的蕨"), lines: [say(undefined, "This fern grew where I sit and write. It's yours now.", "这株蕨就长在我坐着写日记的地方。现在是你的了。")], unlock: { kind: "gift", rewards: [{ kind: "decor", id: "fern" }] } },
    },
  }),
];
