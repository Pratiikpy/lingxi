/**
 * The visitor album (PRD M9, after Neko Atsume): while you are away, the friends
 * who wander by (U4's "friend" surprises) are travelling pets from other
 * villages, each with a name. Some are common, a few are rare. Who came on a
 * beat is fixed by the pet and the beat, like every away surprise, so an
 * absence always brings the same visitors on any device. The album keeps who
 * has been, how often, and when first.
 */

import { timeOfDay } from "@lingxi/brain";
import { awayEvent } from "./away";
import { PET_SCHOOL } from "./lessons";
import type { Stage, Trait } from "./pet";
import { EVENT } from "./sim";
import { type WorldSeasonId, worldSeasonAt } from "./worldSeason";

export interface Visitor {
  id: string;
  name: { en: string; zh: string };
  note: { en: string; zh: string };
  /** "epic": one kind of pet in one season of the world, a once-in-a-season meeting (G4) */
  rarity: "common" | "uncommon" | "rare" | "epic";
  /** how it is drawn: an egg line's body in a palette, with an outfit */
  look: { line: "gentle" | "bold" | "curious"; stage: "baby" | "child" | "teen" | "adult"; palette: "mint" | "lilac" | "peach" | "night" | "coral" | "sunny" | "sky"; form?: "blossom" | "scholar" | "moonpetal" | "dumpling"; outfit?: { head?: string; face?: string; held?: string } };
  /**
   * G4: what brings it. A visitor with a need wanders by only to a pet that knows that school lesson, has that habit
   * (the trait at HABIT or more), is of that line, has reached that stage, wears that form, or in that world season.
   */
  need?: VisitorNeed;
  /** G4: what it leaves on its 3rd and its 10th visit (and every visitor its FRIENDSHIP_GIFT on its 25th); things, never coins, so a day of visitors never pushes coin income past its daily bound (D3's measure) */
  keepsakes?: { third: VisitorGift; tenth: VisitorGift };
}

export interface VisitorNeed {
  lesson?: string;
  trait?: Trait;
  line?: "gentle" | "bold" | "curious";
  stage?: Exclude<Stage, "egg">;
  form?: "puff" | "blossom" | "dumpling" | "scholar" | "moonpetal";
  season?: WorldSeasonId;
  /** D11: only at night where the pet lives (21:00 to 06:00 its local time, the brain's night) */
  night?: true;
}

export type VisitorGift = { kind: "item"; item: number; n: number } | { kind: "coins"; n: number } | { kind: "decor"; id: string };

/** What any visitor leaves on its 25th visit: a pot of tea shared, an old friend by now (G4). */
export const FRIENDSHIP_VISITS = 25;
export const FRIENDSHIP_GIFT: VisitorGift = { kind: "item", item: 11405, n: 1 };

/** A trait this strong is a habit a visitor notices (traits run 0 to 15). */
export const HABIT = 5;

/** What a visitor may notice about a pet when it chooses whom to visit. */
export interface VisitContext {
  lessons: readonly string[];
  traits: Readonly<Record<Trait, number>>;
  line: "gentle" | "bold" | "curious";
  stage: Exclude<Stage, "egg">;
  form?: string;
  /** the pet's time zone, minutes east of UTC, for a visitor who keeps the night (UTC when not known) */
  tzOffsetMin?: number;
}

export const VISITORS: readonly Visitor[] = [
  { id: "pip", rarity: "common", name: { en: "Pip from the mill", zh: "磨坊的皮皮" }, note: { en: "Always passing by on an errand.", zh: "总是在跑腿的路上经过。" }, look: { line: "bold", stage: "baby", palette: "peach" } },
  { id: "moss", rarity: "common", name: { en: "Moss", zh: "青苔" }, note: { en: "Sat in the sun for an hour and left.", zh: "晒了一小时太阳就走了。" }, look: { line: "gentle", stage: "child", palette: "mint" } },
  { id: "lulu", rarity: "common", name: { en: "Lulu", zh: "露露" }, note: { en: "Hums a tune nobody else knows.", zh: "哼着一首别人都不会的歌。" }, look: { line: "curious", stage: "baby", palette: "lilac" } },
  { id: "dot", rarity: "common", name: { en: "Dot", zh: "小点" }, note: { en: "Very small. Very polite.", zh: "很小，很有礼貌。" }, look: { line: "gentle", stage: "baby", palette: "sky" } },
  { id: "bramble", rarity: "common", name: { en: "Bramble", zh: "荆棘" }, note: { en: "Came for the shade under the tree.", zh: "是来树下乘凉的。" }, look: { line: "bold", stage: "child", palette: "mint", outfit: { held: "flag" } } },
  { id: "pebble", rarity: "common", name: { en: "Pebble", zh: "石子" }, note: { en: "Left a smooth stone on the step.", zh: "在台阶上留了一颗光滑的石子。" }, look: { line: "curious", stage: "child", palette: "night" } },
  { id: "picnic", rarity: "uncommon", name: { en: "Picnic Pia", zh: "野餐的皮娅" }, note: { en: "Brought a basket and forgot to open it.", zh: "带了野餐篮，结果忘了打开。" }, look: { line: "gentle", stage: "teen", palette: "peach", outfit: { head: "sunhat", held: "balloon" } } },
  { id: "scholar", rarity: "uncommon", name: { en: "Professor Fen", zh: "芬教授" }, note: { en: "Asked your pet three questions and wrote down the answers.", zh: "问了你的宠物三个问题，还把答案记了下来。" }, look: { line: "curious", stage: "adult", palette: "lilac", form: "scholar", outfit: { face: "glasses" } } },
  { id: "snow", rarity: "uncommon", name: { en: "Snowcap", zh: "雪帽" }, note: { en: "Smelled of pine and cold air.", zh: "身上有松树和冷空气的味道。" }, look: { line: "bold", stage: "teen", palette: "sky", outfit: { head: "beanie" } } },
  { id: "bloom", rarity: "uncommon", name: { en: "Bloom", zh: "花开" }, note: { en: "Every step left a petal.", zh: "每走一步都落下一片花瓣。" }, look: { line: "gentle", stage: "adult", palette: "coral", form: "blossom" } },
  { id: "monarch", rarity: "rare", name: { en: "The Little Monarch", zh: "小小君主" }, note: { en: "Inspected the room, approved, departed.", zh: "巡视了一圈，点头，离开。" }, look: { line: "bold", stage: "adult", palette: "sunny", outfit: { head: "crown", face: "shades", held: "lantern" } } },
  { id: "moonwalker", rarity: "rare", name: { en: "Moonwalker", zh: "月行者" }, note: { en: "Only ever comes at night, and only for a moment.", zh: "只在夜里来，而且只待一会儿。" }, look: { line: "curious", stage: "adult", palette: "night", form: "moonpetal" }, need: { night: true } },
  // ── G4: visitors who come for what a pet is: a lesson it knows, a habit, its line, stage or form, or the season ──
  { id: "tansy", rarity: "uncommon", name: { en: "Tansy the Trader", zh: "交换小能手丹西" }, note: { en: "Swapped a ribbon for a bottle cap, and both left happy.", zh: "用一根丝带换了个瓶盖，两边都很开心。" }, look: { line: "gentle", stage: "child", palette: "coral", outfit: { held: "balloon" } }, need: { lesson: "share" }, keepsakes: { third: { kind: "item", item: 1011, n: 3 }, tenth: { kind: "item", item: 11313, n: 1 } } },
  { id: "burr", rarity: "uncommon", name: { en: "Captain Burr", zh: "刺球船长" }, note: { en: "Stood guard at the door until your pet said thank you.", zh: "在门口站岗，直到你的宠物说了谢谢。" }, look: { line: "bold", stage: "teen", palette: "sunny", outfit: { held: "flag" } }, need: { lesson: "brave" }, keepsakes: { third: { kind: "item", item: 1002, n: 6 }, tenth: { kind: "item", item: 11313, n: 1 } } },
  { id: "dew", rarity: "common", name: { en: "Drowsy Dew", zh: "瞌睡露" }, note: { en: "Napped in the warm spot. Snored, a little.", zh: "在暖和的地方睡了一觉，有一点点打呼。" }, look: { line: "curious", stage: "baby", palette: "sky" }, need: { lesson: "nap" }, keepsakes: { third: { kind: "item", item: 1012, n: 3 }, tenth: { kind: "item", item: 11405, n: 1 } } },
  { id: "hob", rarity: "common", name: { en: "Hello Hob", zh: "你好小霍" }, note: { en: "Said hello to everything, including the door.", zh: "跟所有东西打招呼，包括门。" }, look: { line: "gentle", stage: "baby", palette: "peach" }, need: { lesson: "greet" }, keepsakes: { third: { kind: "item", item: 11312, n: 2 }, tenth: { kind: "item", item: 11405, n: 1 } } },
  { id: "willow", rarity: "uncommon", name: { en: "Old Willow", zh: "老柳" }, note: { en: "Waited by the window without a fuss, then waved.", zh: "安安静静在窗边等着，然后挥了挥手。" }, look: { line: "gentle", stage: "adult", palette: "mint" }, need: { lesson: "patient" }, keepsakes: { third: { kind: "item", item: 11404, n: 1 }, tenth: { kind: "item", item: 11313, n: 1 } } },
  { id: "sprig", rarity: "common", name: { en: "Sprig the Sweeper", zh: "扫地的小枝" }, note: { en: "Tidied a corner nobody had asked about.", zh: "把一个没人管的角落收拾干净了。" }, look: { line: "bold", stage: "child", palette: "lilac" }, need: { lesson: "tidy" }, keepsakes: { third: { kind: "item", item: 1016, n: 4 }, tenth: { kind: "item", item: 11405, n: 1 } } },
  { id: "juno", rarity: "uncommon", name: { en: "Map-Maker Juno", zh: "画地图的朱诺" }, note: { en: "Drew your room on a map and labelled the snack shelf.", zh: "把你的房间画进了地图，还标出了零食架。" }, look: { line: "curious", stage: "teen", palette: "sunny", outfit: { face: "glasses", held: "sunflower" } }, need: { lesson: "explore" }, keepsakes: { third: { kind: "item", item: 1004, n: 3 }, tenth: { kind: "item", item: 11313, n: 1 } } },
  { id: "muffin", rarity: "common", name: { en: "Muffin", zh: "小松饼" }, note: { en: "Said thank you for the crumbs, very formally.", zh: "非常郑重地为面包屑道了谢。" }, look: { line: "gentle", stage: "child", palette: "peach", outfit: { face: "hearts" } }, need: { lesson: "thanks" }, keepsakes: { third: { kind: "item", item: 11201, n: 1 }, tenth: { kind: "item", item: 11405, n: 1 } } },
  { id: "thistle", rarity: "uncommon", name: { en: "Thistle", zh: "蓟草" }, note: { en: "Dared your pet to touch the fence. Both did.", zh: "跟你的宠物比胆量摸栅栏，两个都摸了。" }, look: { line: "bold", stage: "child", palette: "coral" }, need: { trait: "brave" }, keepsakes: { third: { kind: "item", item: 1013, n: 2 }, tenth: { kind: "item", item: 11313, n: 1 } } },
  { id: "quill", rarity: "uncommon", name: { en: "Quill", zh: "羽笔" }, note: { en: "Asked why, and then why again, and then why.", zh: "问了一个为什么，又问为什么，又问为什么。" }, look: { line: "curious", stage: "child", palette: "lilac", outfit: { face: "glasses" } }, need: { trait: "curious" }, keepsakes: { third: { kind: "item", item: 1003, n: 2 }, tenth: { kind: "item", item: 11313, n: 1 } } },
  { id: "crumb", rarity: "common", name: { en: "Crumb", zh: "面包屑" }, note: { en: "Checked under every bowl. Found one raisin.", zh: "把每个碗底都翻了一遍，找到一颗葡萄干。" }, look: { line: "bold", stage: "baby", palette: "sunny" }, need: { trait: "greedy" }, keepsakes: { third: { kind: "item", item: 11302, n: 1 }, tenth: { kind: "item", item: 11405, n: 1 } } },
  { id: "pond", rarity: "uncommon", name: { en: "Still Pond", zh: "静水" }, note: { en: "Sat so quietly the dust settled around it.", zh: "坐得那么安静，灰尘都落在它身边。" }, look: { line: "gentle", stage: "teen", palette: "sky" }, need: { trait: "calm" }, keepsakes: { third: { kind: "item", item: 11011, n: 2 }, tenth: { kind: "item", item: 11313, n: 1 } } },
  { id: "skip", rarity: "common", name: { en: "Skip", zh: "蹦蹦" }, note: { en: "Bounced in, bounced round, bounced out.", zh: "蹦进来，蹦一圈，蹦出去。" }, look: { line: "curious", stage: "baby", palette: "coral" }, need: { trait: "playful" }, keepsakes: { third: { kind: "item", item: 1014, n: 3 }, tenth: { kind: "item", item: 11405, n: 1 } } },
  { id: "velvet", rarity: "uncommon", name: { en: "Velvet", zh: "天鹅绒" }, note: { en: "Groomed your pet's ear and left without a word.", zh: "帮你的宠物理了理耳朵，一句话没说就走了。" }, look: { line: "gentle", stage: "adult", palette: "lilac" }, need: { trait: "gentle" }, keepsakes: { third: { kind: "item", item: 11311, n: 1 }, tenth: { kind: "item", item: 11313, n: 1 } } },
  { id: "whisper", rarity: "rare", name: { en: "Whisper", zh: "悄悄" }, note: { en: "Hid behind the curtain the whole time. You only saw its tail.", zh: "整个时候都躲在窗帘后面，你只看到了尾巴。" }, look: { line: "curious", stage: "child", palette: "night" }, need: { trait: "shy" }, keepsakes: { third: { kind: "item", item: 1021, n: 1 }, tenth: { kind: "decor", id: "hidebox" } } },
  { id: "fawn", rarity: "uncommon", name: { en: "Shy Fawn", zh: "害羞小鹿" }, note: { en: "Peeked in, blushed, and peeked again.", zh: "探头看了看，脸红了，又探头看了看。" }, look: { line: "gentle", stage: "teen", palette: "peach", outfit: { head: "bow" } }, need: { line: "gentle" }, keepsakes: { third: { kind: "item", item: 1011, n: 2 }, tenth: { kind: "item", item: 11313, n: 1 } } },
  { id: "grizzle", rarity: "rare", name: { en: "Grizzle the Rival", zh: "劲敌灰须" }, note: { en: "Challenged your pet to a staring match. It was a draw.", zh: "找你的宠物比瞪眼，结果平手。" }, look: { line: "bold", stage: "adult", palette: "night", outfit: { head: "crown" } }, need: { line: "bold", stage: "teen" }, keepsakes: { third: { kind: "item", item: 1005, n: 8 }, tenth: { kind: "decor", id: "rosette" } } },
  { id: "riddle", rarity: "uncommon", name: { en: "Riddle", zh: "谜语" }, note: { en: "Left a puzzle on the floor. It is still not solved.", zh: "在地上留了一道谜题，到现在还没解开。" }, look: { line: "curious", stage: "teen", palette: "mint", outfit: { face: "shades" } }, need: { line: "curious" }, keepsakes: { third: { kind: "item", item: 1007, n: 1 }, tenth: { kind: "item", item: 11313, n: 1 } } },
  { id: "oak", rarity: "rare", name: { en: "Grandmother Oak", zh: "橡树奶奶" }, note: { en: "Told a story older than the village, then dozed off.", zh: "讲了一个比村子还老的故事，然后打起了盹。" }, look: { line: "gentle", stage: "adult", palette: "mint", form: "blossom" }, need: { stage: "elder" }, keepsakes: { third: { kind: "item", item: 11313, n: 1 }, tenth: { kind: "item", item: 1021, n: 2 } } },
  { id: "bun", rarity: "uncommon", name: { en: "Bun", zh: "小包子" }, note: { en: "Admired your pet's round shape. Approved.", zh: "欣赏了一下你宠物圆圆的身形，表示认可。" }, look: { line: "bold", stage: "adult", palette: "peach", form: "dumpling" }, need: { form: "dumpling" }, keepsakes: { third: { kind: "item", item: 11110, n: 2 }, tenth: { kind: "item", item: 11313, n: 1 } } },
  { id: "sprite", rarity: "rare", name: { en: "Petal Sprite", zh: "花瓣精灵" }, note: { en: "Arrived on a gust of petals and left one in every corner.", zh: "乘着一阵花瓣来，在每个角落都留下一片。" }, look: { line: "gentle", stage: "child", palette: "coral", form: "blossom" }, need: { season: "blossom" }, keepsakes: { third: { kind: "decor", id: "petalbowl" }, tenth: { kind: "item", item: 11404, n: 2 } } },
  { id: "moth", rarity: "rare", name: { en: "Lantern Moth", zh: "灯笼蛾" }, note: { en: "Circled the lamp three times and bowed.", zh: "绕着灯转了三圈，鞠了一躬。" }, look: { line: "curious", stage: "teen", palette: "sunny", outfit: { held: "lantern" } }, need: { season: "lantern" }, keepsakes: { third: { kind: "decor", id: "moonlamp" }, tenth: { kind: "item", item: 11404, n: 2 } } },
  { id: "hermit", rarity: "rare", name: { en: "Acorn Hermit", zh: "橡果隐士" }, note: { en: "Traded an acorn for a crumb and called it fair.", zh: "用一颗橡果换了一块面包屑，说很公平。" }, look: { line: "bold", stage: "adult", palette: "sunny", outfit: { head: "sunhat" } }, need: { season: "harvest" }, keepsakes: { third: { kind: "decor", id: "pumpkin" }, tenth: { kind: "item", item: 11404, n: 2 } } },
  // ── G4: once-in-a-season meetings, each for one line of pet in one season ──
  { id: "blossom-gentle", rarity: "epic", name: { en: "Blossom Bride", zh: "花嫁小樱" }, note: { en: "Wore a crown of petals and gave one to your pet.", zh: "戴着花瓣冠，还分了一片给你的宠物。" }, look: { line: "gentle", stage: "adult", palette: "coral", form: "blossom" }, need: { season: "blossom", line: "gentle" }, keepsakes: { third: { kind: "item", item: 11314, n: 2 }, tenth: { kind: "item", item: 11404, n: 2 } } },
  { id: "blossom-bold", rarity: "epic", name: { en: "Petal Knight", zh: "花瓣骑士" }, note: { en: "Saluted with a twig sword and marched off through the flowers.", zh: "举起树枝剑敬了个礼，踏着花走了。" }, look: { line: "bold", stage: "teen", palette: "coral", outfit: { held: "flag" } }, need: { season: "blossom", line: "bold" }, keepsakes: { third: { kind: "item", item: 1011, n: 4 }, tenth: { kind: "item", item: 11404, n: 2 } } },
  { id: "blossom-curious", rarity: "epic", name: { en: "Seed Counter", zh: "数种子的" }, note: { en: "Counted every seed in the garden. Twice.", zh: "把园子里的种子数了一遍，又数了一遍。" }, look: { line: "curious", stage: "child", palette: "mint", outfit: { face: "glasses" } }, need: { season: "blossom", line: "curious" }, keepsakes: { third: { kind: "item", item: 7104, n: 2 }, tenth: { kind: "item", item: 11404, n: 2 } } },
  { id: "lantern-gentle", rarity: "epic", name: { en: "Lamplighter Lin", zh: "点灯的阿琳" }, note: { en: "Lit a tiny lantern by your door and tiptoed away.", zh: "在你门边点了一盏小灯，踮着脚走了。" }, look: { line: "gentle", stage: "teen", palette: "sunny", outfit: { held: "lantern" } }, need: { season: "lantern", line: "gentle" }, keepsakes: { third: { kind: "item", item: 1010, n: 2 }, tenth: { kind: "item", item: 11404, n: 2 } } },
  { id: "lantern-bold", rarity: "epic", name: { en: "Firefly Captain", zh: "萤火虫队长" }, note: { en: "Led a parade of fireflies three times round the room.", zh: "带着一队萤火虫在屋里绕了三圈。" }, look: { line: "bold", stage: "adult", palette: "night", outfit: { head: "crown" } }, need: { season: "lantern", line: "bold" }, keepsakes: { third: { kind: "item", item: 1021, n: 1 }, tenth: { kind: "item", item: 11404, n: 2 } } },
  { id: "lantern-curious", rarity: "epic", name: { en: "Star Reader", zh: "读星星的" }, note: { en: "Pointed at the sky and named every star. Some names were made up.", zh: "指着天空给每颗星星起名字。有些名字是编的。" }, look: { line: "curious", stage: "adult", palette: "night", form: "moonpetal" }, need: { season: "lantern", line: "curious" }, keepsakes: { third: { kind: "item", item: 1003, n: 2 }, tenth: { kind: "item", item: 11404, n: 2 } } },
  { id: "harvest-gentle", rarity: "epic", name: { en: "Apple Aunt", zh: "苹果阿姨" }, note: { en: "Left a basket of apples and refused to take it back.", zh: "留下一篮苹果，怎么都不肯拿回去。" }, look: { line: "gentle", stage: "adult", palette: "peach", outfit: { head: "sunhat" } }, need: { season: "harvest", line: "gentle" }, keepsakes: { third: { kind: "item", item: 11313, n: 2 }, tenth: { kind: "item", item: 11404, n: 2 } } },
  { id: "harvest-bold", rarity: "epic", name: { en: "Haystack Champ", zh: "草垛冠军" }, note: { en: "Jumped into the leaf pile and came out a different colour.", zh: "跳进落叶堆，出来就换了个颜色。" }, look: { line: "bold", stage: "teen", palette: "sunny" }, need: { season: "harvest", line: "bold" }, keepsakes: { third: { kind: "item", item: 1004, n: 4 }, tenth: { kind: "item", item: 11404, n: 2 } } },
  { id: "harvest-curious", rarity: "epic", name: { en: "Mushroom Scout", zh: "找蘑菇的" }, note: { en: "Found three mushrooms you didn't know were there.", zh: "找到三朵你都不知道在那里的蘑菇。" }, look: { line: "curious", stage: "child", palette: "peach" }, need: { season: "harvest", line: "curious" }, keepsakes: { third: { kind: "item", item: 1013, n: 3 }, tenth: { kind: "item", item: 11404, n: 2 } } },
  { id: "frost-gentle", rarity: "epic", name: { en: "Snow Knitter", zh: "织雪的" }, note: { en: "Knitted your pet a tiny scarf. It is mostly holes.", zh: "给你的宠物织了一条小围巾。大部分是洞。" }, look: { line: "gentle", stage: "teen", palette: "sky", outfit: { head: "beanie" } }, need: { season: "frost", line: "gentle" }, keepsakes: { third: { kind: "item", item: 11311, n: 2 }, tenth: { kind: "item", item: 11404, n: 2 } } },
  { id: "frost-bold", rarity: "epic", name: { en: "Icicle Racer", zh: "冰柱赛跑手" }, note: { en: "Slid in on the frost and slid out again.", zh: "顺着霜滑进来，又滑了出去。" }, look: { line: "bold", stage: "adult", palette: "sky" }, need: { season: "frost", line: "bold" }, keepsakes: { third: { kind: "item", item: 1002, n: 8 }, tenth: { kind: "item", item: 11404, n: 2 } } },
  { id: "frost-curious", rarity: "epic", name: { en: "Snowflake Keeper", zh: "收雪花的" }, note: { en: "Showed your pet a snowflake under glass. No two the same.", zh: "给你的宠物看玻璃下的雪花。没有两片一样。" }, look: { line: "curious", stage: "teen", palette: "lilac", outfit: { face: "glasses" } }, need: { season: "frost", line: "curious" }, keepsakes: { third: { kind: "item", item: 1007, n: 1 }, tenth: { kind: "item", item: 11404, n: 2 } } },
  { id: "fox", rarity: "rare", name: { en: "Frost Fox", zh: "霜狐" }, note: { en: "Left little frosted pawprints that took an hour to melt.", zh: "留下一串结霜的小爪印，过了一小时才化。" }, look: { line: "curious", stage: "adult", palette: "sky", outfit: { head: "beanie" } }, need: { season: "frost" }, keepsakes: { third: { kind: "decor", id: "snowpal" }, tenth: { kind: "item", item: 11404, n: 2 } } },
];

export const VISITOR: Readonly<Record<string, Visitor>> = Object.fromEntries(VISITORS.map((v) => [v.id, v]));
const WEIGHT = { common: 12, uncommon: 4, rare: 1, epic: 2 } as const;
const STAGES = ["baby", "child", "teen", "adult", "elder"] as const;

/** The school lesson ids a pet knows, from its lessons' labels (what a visitor with a lesson need looks for). */
export const schoolIdsOf = (lessons: ReadonlyArray<{ label?: string }>): string[] => PET_SCHOOL.filter((s) => lessons.some((l) => l.label === s.rule.label)).map((s) => s.id);

/** Would this visitor come to this pet now? A visitor with no need comes to anyone. */
export function visitorComes(v: Visitor, ctx: VisitContext | undefined, ms: number): boolean {
  const n = v.need;
  if (!n) return true;
  if (n.season && worldSeasonAt(ms).id !== n.season) return false;
  if (n.night && timeOfDay(new Date(ms + (ctx?.tzOffsetMin ?? 0) * 60_000).getUTCHours()) !== 0) return false;
  if (!ctx) return !n.lesson && !n.trait && !n.line && !n.stage && !n.form;
  if (n.lesson && !ctx.lessons.includes(n.lesson)) return false;
  if (n.trait && (ctx.traits[n.trait] ?? 0) < HABIT) return false;
  if (n.line && ctx.line !== n.line) return false;
  if (n.stage && STAGES.indexOf(ctx.stage) < STAGES.indexOf(n.stage)) return false;
  if (n.form && ctx.form !== n.form) return false;
  return true;
}

function mix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x5bd1e995, 0x27d4eb2f) ^ Math.imul(b ^ 0x165667b1, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Who a friend surprise on this beat was: one of the visitors who would come to this pet then (G4), chosen by rarity.
 * Fixed by the pet, the beat and what the pet is, like every away surprise.
 */
export function visitorOn(petSeed: number, beat: number, ctx?: VisitContext): Visitor {
  const pool = VISITORS.filter((v) => visitorComes(v, ctx, beat * 60_000));
  const total = pool.reduce((t, v) => t + WEIGHT[v.rarity], 0);
  let r = mix(petSeed | 0, beat) % total;
  for (const v of pool) {
    r -= WEIGHT[v.rarity];
    if (r < 0) return v;
  }
  return pool[0]!;
}

/** Everyone who came by between two beats (the friend surprises of an absence), in order. */
export function visitorsDuring(petSeed: number, from: number, to: number, ctx?: VisitContext): Array<{ beat: number; visitor: Visitor }> {
  const out: Array<{ beat: number; visitor: Visitor }> = [];
  for (let b = from + 1; b <= to; b++) if (awayEvent(petSeed, b) === EVENT.friend) out.push({ beat: b, visitor: visitorOn(petSeed, b, ctx) });
  return out;
}

/** The keepsakes these visits earn: each visitor's 3rd and 10th visit, counted from the album before them. */
export function keepsakesFrom(album: Album, visits: ReadonlyArray<{ visitor: Visitor }>): Array<{ visitor: Visitor; which: "third" | "tenth" | "friend"; gift: VisitorGift }> {
  const counts: Record<string, number> = Object.fromEntries(Object.entries(album).map(([id, e]) => [id, e.count]));
  const out: Array<{ visitor: Visitor; which: "third" | "tenth" | "friend"; gift: VisitorGift }> = [];
  for (const { visitor } of visits) {
    const n = (counts[visitor.id] = (counts[visitor.id] ?? 0) + 1);
    if (!visitor.keepsakes) {
      if (n === FRIENDSHIP_VISITS) out.push({ visitor, which: "friend", gift: FRIENDSHIP_GIFT });
      continue;
    }
    if (n === 3) out.push({ visitor, which: "third", gift: visitor.keepsakes.third });
    if (n === 10) out.push({ visitor, which: "tenth", gift: visitor.keepsakes.tenth });
    if (n === FRIENDSHIP_VISITS) out.push({ visitor, which: "friend", gift: FRIENDSHIP_GIFT });
  }
  return out;
}

export interface HintNames {
  trait: (t: Trait) => string;
  season: (s: WorldSeasonId) => string;
  stage: (s: string) => string;
  line: (l: string) => string;
  form: (f: string) => string;
}

/** The album's hint for a visitor: what brings it, in plain words (G4). */
export function visitorHint(v: Visitor, lang: "en" | "zh", names: HintNames): string {
  const n = v.need;
  if (!n) return lang === "zh" ? "谁都有可能遇到。" : "Might wander by anyone.";
  const parts: string[] = [];
  if (n.lesson) {
    const say = PET_SCHOOL.find((s) => s.id === n.lesson)?.say[lang] ?? n.lesson;
    parts.push(lang === "zh" ? `学过“${say}”的宠物` : `a pet taught “${say}”`);
  }
  if (n.trait) parts.push(lang === "zh" ? `很${names.trait(n.trait)}的宠物` : `a very ${names.trait(n.trait)} pet`);
  if (n.line) parts.push(lang === "zh" ? `${names.line(n.line)}的宠物` : `a ${names.line(n.line)} pet`);
  if (n.stage) parts.push(lang === "zh" ? `长到${names.stage(n.stage)}的宠物` : `a pet grown to ${names.stage(n.stage)}`);
  if (n.form) parts.push(lang === "zh" ? `${names.form(n.form)}形态的宠物` : `a pet in its ${names.form(n.form)} form`);
  const who = parts.join(lang === "zh" ? "、" : " and ");
  if (n.season) {
    const when = names.season(n.season);
    if (lang === "zh") return who ? `${when}来看${who}。` : `只在${when}来。`;
    return who ? `Comes to ${who} in ${when}.` : `Comes only in ${when}.`;
  }
  if (n.night) {
    if (lang === "zh") return who ? `夜里来看${who}。` : "只在夜里来（晚上 9 点到早上 6 点）。";
    return who ? `Comes to ${who} at night.` : "Comes only at night (9 pm to 6 am).";
  }
  return lang === "zh" ? `会来看${who}。` : `Comes to ${who}.`;
}

export interface AlbumEntry {
  count: number;
  /** ms of the first visit */
  first: number;
}
export type Album = Record<string, AlbumEntry>;

/** The album with these visits added (beats are minutes). */
export function addToAlbum(album: Album, visits: ReadonlyArray<{ beat: number; visitor: Visitor }>): Album {
  const next: Album = { ...album };
  for (const v of visits) {
    const e = next[v.visitor.id];
    next[v.visitor.id] = e ? { count: e.count + 1, first: Math.min(e.first, v.beat * 60_000) } : { count: 1, first: v.beat * 60_000 };
  }
  return next;
}
