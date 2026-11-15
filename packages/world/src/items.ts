/**
 * Lingxi's items: pixel item art with Lingxi's own names, words and
 * effects. Items not listed here (dark or farming-only ones) do not exist in
 * Lingxi. Effects are in visible meter units (0..1000).
 */

export type ItemKind = "material" | "food" | "drink" | "treasure" | "box";
export type Diet = "sweet" | "fruit" | "savory" | "grain";

export interface ItemDef {
  name: { en: string; zh: string };
  desc: { en: string; zh: string };
  kind: ItemKind;
  /** what using it does to the pet */
  use?: { food?: number; joy?: number; energy?: number; clean?: number; xp?: number; diet?: Diet; wake?: boolean };
  /** shop price in coins; absent = not sold */
  price?: number;
}

const I = (en: string, zh: string, den: string, dzh: string, kind: ItemKind, use?: ItemDef["use"], price?: number): ItemDef => ({
  name: { en, zh },
  desc: { en: den, zh: dzh },
  kind,
  ...(use ? { use } : {}),
  ...(price !== undefined ? { price } : {}),
});

export const ITEMS: Record<number, ItemDef> = {
  // things found on walks
  1001: I("Stick", "小树枝", "A good stick. Every pet knows a good stick.", "一根好树枝。每只宠物都懂什么是好树枝。", "material"),
  1002: I("Pebble", "小石子", "Smooth and round, nice to hold.", "又圆又滑，握着很舒服。", "material"),
  1003: I("Old Bottle", "旧瓶子", "Rinsed and ready to hold something new.", "洗干净了，可以装点新东西。", "material"),
  1004: I("Pine Cone", "松果", "It smells like the forest. Slightly sacred.", "闻起来是森林的味道，有点神圣。", "material"),
  1005: I("Scrap", "铁片", "A bit of old metal. Could become something.", "一小块旧铁，说不定能做成什么。", "material"),
  1006: I("Glass Jar", "玻璃罐", "Somehow not a single crack.", "居然一点裂纹都没有。", "material"),
  1007: I("Amber", "琥珀", "Red amber from deep in the forest, warm in the hand.", "森林深处的红琥珀，握在手里暖暖的。", "material"),
  1010: I("Night Poppy", "夜罂粟", "So dark purple it looks black. A rare find.", "紫得发黑的花，很少见。", "material"),
  1011: I("Daffodil", "水仙", "A yellow flower that nods at its own reflection.", "对着自己倒影点头的黄色小花。", "material"),
  1012: I("Mint", "薄荷", "Cool and fresh. Pets sneeze at it.", "清凉提神，宠物闻了会打喷嚏。", "material"),
  1013: I("Ruby Mushroom", "红宝蘑菇", "A deep red mushroom. Not for eating raw.", "深红色的蘑菇，不能生吃。", "material"),
  1014: I("Chalkberry", "粉霜莓", "A bitter berry dusted white.", "裹着白霜的苦莓子。", "material"),
  1015: I("Old Coin", "古钱币", "Worn smooth, but it still catches the light. The shrine likes these.", "磨得很光滑，却还会反光。神社喜欢这个。", "treasure"),
  1016: I("Dried Stems", "干菌柄", "A little bundle of dried mushroom stems.", "一小捆晒干的蘑菇柄。", "material"),
  1017: I("Green Pipe", "铜绿管", "A short pipe gone green with age.", "放久了长出铜绿的短管子。", "material"),
  1019: I("Faraway Coin", "远方硬币", "The face on it has long pointy ears, like a cat's.", "上面的人像长着尖尖的长耳朵，像猫一样。", "treasure"),
  1021: I("Glow Root", "荧光根", "A root that took on a crystal's soft blue light.", "染上了水晶蓝光的树根。", "material"),
  1102: I("Stone Cup", "石杯", "A little cup carved from a pebble.", "用小石子凿成的小杯子。", "material"),
  1103: I("Sparkle Dust", "闪粉", "Fine glittering powder made from old bottles.", "用旧瓶子磨成的亮晶晶的细粉。", "material"),
  1104: I("Pine Pollen", "松花粉", "Golden dust shaken from pine cones.", "从松果里抖出来的金色粉末。", "material"),
  1107: I("Amber Powder", "琥珀粉", "Ground amber, for polishing things bright.", "磨碎的琥珀，能把东西擦得亮亮的。", "material"),
  1110: I("Poppy Ink", "罂粟墨", "Thick dark ink pressed from night poppies.", "用夜罂粟压出来的浓稠墨汁。", "material"),
  1111: I("Daffodil Drops", "水仙露", "A few precious drops of daffodil.", "几滴珍贵的水仙露。", "material"),
  1112: I("Mint Leaves", "薄荷叶", "Shredded mint, ready for tea.", "切碎的薄荷，可以泡茶。", "material"),
  1113: I("Mushroom Spice", "蘑菇香料", "A reddish spice that smells a bit like coffee.", "红褐色的香料，闻着有点像咖啡。", "material"),
  1114: I("Berry Frost", "莓霜", "The white frost scraped from chalkberries.", "从粉霜莓上刮下来的白霜。", "material"),
  1121: I("Glow Paste", "荧光膏", "A pale paste that still glows a little in the dark.", "苍白的膏，在黑暗里还会微微发光。", "material"),
  1201: I("Sweet Syrup", "甜糖浆", "Sacred dust stirred into water.", "神圣的粉末调进水里。", "material"),
  1202: I("Resin Syrup", "树脂糖浆", "Spicy-sweet syrup from tree resin.", "树脂熬成的又辣又甜的糖浆。", "material"),
  1301: I("Stone Block", "石块", "A heavy block of rough stone, waiting to become something.", "一块沉甸甸的粗石，等着被做成什么。", "material"),
  1302: I("Plank", "木板", "Pressed strips of wood, strong and light.", "压制的木条，结实又轻巧。", "material"),
  1303: I("Metal Bar", "金属条", "Soft green metal, easy to shape.", "柔软的绿色金属，很容易塑形。", "material"),
  6001: I("Spark of Hearing", "听之火", "One of six sense crystals. A little blue flame that listens.", "六颗感官水晶之一。会倾听的小蓝火苗。", "treasure"),
  6002: I("Spark of Smell", "嗅之云", "One of six sense crystals. A tiny cloud that smells of flowers.", "六颗感官水晶之一。闻起来像花的小云朵。", "treasure"),
  6003: I("Spark of Sight", "视之珠", "One of six sense crystals. An orb that seems to look back.", "六颗感官水晶之一。好像会回看你的圆珠。", "treasure"),
  6004: I("Spark of Taste", "味之苞", "One of six sense crystals. A stone flower bud.", "六颗感官水晶之一。石头做的花苞。", "treasure"),
  6005: I("Spark of Touch", "触之息", "One of six sense crystals. It tickles.", "六颗感官水晶之一。摸上去痒痒的。", "treasure"),
  6006: I("Spark of Thought", "思之树", "One of six sense crystals. A tiny mirror-bark tree.", "六颗感官水晶之一。树皮像镜子一样的小树。", "treasure"),
  6007: I("Heart of the Senses", "五感之心", "All six sense crystals joined into one warm, humming ball.", "六颗感官水晶合成的一颗温暖、嗡嗡作响的心。", "treasure"),
  11004: I("Moon Tonic", "月光补剂", "A glowing blue tonic that wakes a pet from the longest sleep.", "发着蓝光的补剂，能把睡得最久的宠物唤醒。", "drink", { energy: 400, wake: true }),
  11011: I("Sacred Dust", "神圣粉末", "Dust from the shrine. It feels important.", "神社里的粉末，感觉很重要。", "material"),
  // the garden
  7001: I("Compost", "堆肥", "What's left after a good bath, turned into rich soil. Plants grow twice as fast in it.", "好好洗完澡剩下的东西，变成了肥沃的土。植物长得快一倍。", "material"),
  7101: I("Apple Seeds", "苹果种子", "Plant in the Mushroom Garden. A golden apple tree, in eight hours.", "种在蘑菇园里。八小时长出金苹果树。", "material", undefined, 18),
  7102: I("Rice Seeds", "稻种", "Plant in the Mushroom Garden. Rice, in six hours.", "种在蘑菇园里。六小时长出稻子。", "material", undefined, 12),
  7103: I("Pepper Seeds", "辣椒种子", "Plant in the Mushroom Garden. Peppers, in five hours.", "种在蘑菇园里。五小时长出辣椒。", "material", undefined, 12),
  7104: I("Clover Seeds", "三叶草种子", "Plant in the Mushroom Garden. Honey clover, in four hours.", "种在蘑菇园里。四小时长出蜜三叶草。", "material", undefined, 10),
  7201: I("Rice Sheaf", "稻穗", "Fresh rice from your own garden. Grain, the base of every good meal.", "自己园子里的新米。谷物是每顿好饭的底子。", "food", { food: 200, joy: 30, diet: "grain" }),
  7202: I("Garden Pepper", "园子辣椒", "Crunchy and a little hot. Pets either love it or sneeze.", "脆脆的，有点辣。宠物要么爱死，要么打喷嚏。", "food", { food: 160, joy: 40, energy: 30, diet: "savory" }),
  // food and treats
  11110: I("Taro Mochi", "芋泥麻薯", "Purple mochi filled with sweet root paste.", "紫色麻薯，裹着甜甜的芋泥。", "food", { food: 260, joy: 60, diet: "grain" }, 40),
  11120: I("Sunset Mochi", "晚霞麻薯", "Red-gold mochi with warm apple jam inside.", "红金色的麻薯，里面是温热的苹果酱。", "food", { food: 240, joy: 80, diet: "fruit" }, 45),
  11130: I("Butterfly Mochi", "蝴蝶麻薯", "Blue mochi stamped with a butterfly, soft and milky.", "印着蝴蝶的蓝色麻薯，软软的奶香。", "food", { food: 300, joy: 20, diet: "grain" }, 30),
  11140: I("Honey Mochi", "蜂蜜麻薯", "Sky-blue mochi with honey grains that pop.", "天蓝色的麻薯，蜂蜜米粒一咬就爆开。", "food", { food: 220, joy: 100, diet: "sweet" }, 50),
  11201: I("Wisdom Candy", "智慧糖", "A little candy that helps your pet remember.", "能帮宠物记住东西的小糖。", "food", { food: 30, joy: 30, xp: 20, diet: "sweet" }, 25),
  11202: I("Wisdom Candy+", "大智慧糖", "A bigger candy for bigger lessons.", "更大的糖，配更难的课。", "food", { food: 40, joy: 40, xp: 60, diet: "sweet" }, 60),
  11233: I("Gingerbread Pal", "姜饼小人", "A cookie shaped like a friend.", "做成朋友模样的饼干。", "food", { food: 140, joy: 140, diet: "sweet" }, 45),
  11301: I("Maple Gum", "枫糖口香糖", "The simplest snack there is. Chewy.", "最简单的零食，嚼嚼嚼。", "food", { food: 80, joy: 20, diet: "sweet" }, 8),
  11302: I("Burger", "汉堡", "Still in its paper. A hearty meal.", "还包着纸，分量十足的一餐。", "food", { food: 380, joy: 0, diet: "savory" }, 35),
  11303: I("Pom-Pom Candy", "绒球果糖", "Fruit candy that fizzes with energy.", "会冒气泡、充满能量的水果糖。", "food", { food: 120, joy: 60, energy: 80, diet: "fruit" }, 30),
  11304: I("Cookie Sticks", "饼干棒", "Crunchy sticks that keep a pet going all day.", "嘎嘣脆的饼干棒，够宠物撑一整天。", "food", { food: 350, joy: 30, diet: "grain" }, 40),
  11311: I("Tree Honey", "树蜜", "Sticky sap that tastes like spiced honey.", "黏黏的树汁，尝起来像加了香料的蜂蜜。", "food", { food: 100, joy: 60, energy: 60, diet: "sweet" }),
  11312: I("Honeydrop", "蜜露", "A sweet bead that forms on mushrooms.", "长在蘑菇上的甜蜜小珠子。", "food", { food: 60, joy: 90, diet: "sweet" }),
  11313: I("Golden Apple", "金苹果", "A sweet golden apple from a silver branch.", "银枝上长出的甜甜的金苹果。", "food", { food: 180, joy: 60, diet: "fruit" }, 30),
  11314: I("Blue Pansy", "蓝色三色堇", "A blue flower shaped like a butterfly. Pets nibble the petals.", "像蝴蝶一样的蓝花，宠物会啃花瓣。", "food", { food: 60, joy: 80, diet: "fruit" }),
  11221: I("Heart Crystal", "心之水晶", "It pulses with warmth. Brings you and your pet closer.", "跳动着暖意，让你和宠物更亲近。", "treasure", { joy: 300, xp: 120 }),
  11222: I("Half Heart", "半颗心", "Slightly warm in the hand.", "握在手里微微发暖。", "treasure", { joy: 150, xp: 50 }),
  21201: I("Ice Cream", "冰淇淋", "One scoop, cold and happy.", "一个球，又冰又开心。", "food", { food: 120, joy: 120, diet: "sweet" }, 25),
  21202: I("Double Scoop", "双球冰淇淋", "Two scoops. Obviously better.", "两个球，当然更好。", "food", { food: 160, joy: 180, diet: "sweet" }, 45),
  21203: I("Cherry Sundae", "樱桃圣代", "A tall sundae with a cherry on top. It never melts.", "顶着樱桃的高高圣代，永远不会化。", "food", { food: 140, joy: 260, diet: "sweet" }, 70),
  21205: I("Rock Candyfloss", "棉花岩糖", "A soft, sweet crystal you can eat.", "可以吃的柔软甜水晶。", "food", { food: 60, joy: 160, diet: "sweet" }),
  11413: I("Mistletoe", "槲寄生", "Special at this time of year.", "每年这个时候都特别。", "treasure", { joy: 200 }),
  11414: I("Old Candy", "老糖果", "Wrapped in wax paper, dated long ago, still perfectly fine.", "包着蜡纸，日期很久以前，却一点没坏。", "food", { food: 40, joy: 120, diet: "sweet" }),
  // drinks made at home
  11401: I("Study Tea", "学习茶", "A cup of tea that makes lessons stick.", "一杯让功课记得更牢的茶。", "drink", { xp: 80, energy: 40 }),
  11402: I("Scholar's Tea", "学者茶", "Strong tea for a serious student.", "给认真学生的浓茶。", "drink", { xp: 240, energy: 60 }),
  11404: I("Calm Tea", "安神茶", "Mint and daffodil. Helps a tired pet rest.", "薄荷加水仙，帮累了的宠物好好休息。", "drink", { energy: 220, joy: 40 }),
  11405: I("Lucky Tea", "好运茶", "A sweet tea that brings a good mood.", "带来好心情的甜茶。", "drink", { joy: 220 }),
  11406: I("Sorry Note", "道歉信", "A letter your pet writes when it has been grumpy. It means it.", "宠物闹完脾气后写的信，是真心的。", "treasure", { joy: 260 }),
  11408: I("Festival Bells", "节日铃铛", "Little bells that make every day feel like a festival.", "让每一天都像过节的小铃铛。", "treasure", { joy: 180, energy: 60 }),
  11409: I("Sparkle Soda", "气泡汽水", "Fizzy and bright. Pets do a little dance.", "冒着泡、亮晶晶。宠物会跳一小段舞。", "drink", { energy: 300, joy: 60 }, 35),
  11411: I("Sage's Tea", "贤者茶", "The strongest tea, brewed with a spark of thought.", "加了思之树熬成的最浓的茶。", "drink", { xp: 600, energy: 100 }),
  21007: I("River Box", "河底宝箱", "A silt-caked box from the bottom of the pool. Open it and see.", "从池底捞上来的、糊满淤泥的箱子。打开看看。", "box"),
  // keys of the castle quest
  100001: I("Star Disk", "星盘", "A golden disk engraved with strange stars.", "刻着奇怪星辰的金色圆盘。", "treasure"),
  100002: I("Old Gear", "古老齿轮", "A sturdy part from some ancient machine.", "某台古老机器上的结实零件。", "treasure"),
  100003: I("Temple Map", "神殿地图", "A golden disk shaped like a map of a temple.", "做成神殿地图模样的金色圆盘。", "treasure"),
  100004: I("Sky Sextant", "天空六分仪", "It points the way to places beyond sight.", "能指向看不见的地方。", "treasure"),
  100010: I("Dowsing Rod", "探水杖", "It twitches near hidden things.", "靠近藏起来的东西时会抖动。", "treasure"),
  100012: I("Twig Charm", "树枝护身符", "A little charm of stick, pebble and honey.", "用树枝、小石子和树蜜做的小护身符。", "treasure"),
};

/** Recipes Lingxi keeps, by recipe index, with Lingxi names. */
export const RECIPE_NAMES: Record<number, { en: string; zh: string }> = {
  1: { en: "Brew Study Tea", zh: "泡学习茶" },
  2: { en: "Brew Scholar's Tea", zh: "泡学者茶" },
  4: { en: "Brew Calm Tea", zh: "泡安神茶" },
  5: { en: "Brew Lucky Tea", zh: "泡好运茶" },
  6: { en: "Shake out Pollen", zh: "抖松花粉" },
  7: { en: "Grind Sparkle Dust", zh: "磨闪粉" },
  8: { en: "Press Daffodil Drops", zh: "压水仙露" },
  9: { en: "Shred Mint", zh: "切薄荷" },
  10: { en: "Press Poppy Ink", zh: "压罂粟墨" },
  11: { en: "Build the Sky Sextant", zh: "组装天空六分仪" },
  12: { en: "Scrape Berry Frost", zh: "刮莓霜" },
  13: { en: "Grind Amber", zh: "磨琥珀" },
  14: { en: "Stir Sweet Syrup", zh: "调甜糖浆" },
  15: { en: "Cook Resin Syrup", zh: "熬树脂糖浆" },
  16: { en: "Grind Mushroom Spice", zh: "磨蘑菇香料" },
  17: { en: "Carve a Stone Cup", zh: "凿石杯" },
  19: { en: "Mix Sparkle Soda", zh: "调气泡汽水" },
  20: { en: "Write a Sorry Note", zh: "写道歉信" },
  21: { en: "Make Festival Bells", zh: "做节日铃铛" },
  29: { en: "Brew Sage's Tea", zh: "泡贤者茶" },
  30: { en: "Join the Six Sparks", zh: "合成五感之心" },
  31: { en: "Press a Plank from Stems", zh: "用菌柄压木板" },
  32: { en: "Bend a Metal Bar", zh: "弯金属条" },
  34: { en: "Press a Plank", zh: "压木板" },
  35: { en: "Melt a Metal Bar", zh: "熔金属条" },
  36: { en: "Cut a Stone Block", zh: "切石块" },
  39: { en: "Make Glow Paste", zh: "做荧光膏" },
  40: { en: "Brew Moon Tonic", zh: "熬月光补剂" },
  41: { en: "Make a Dowsing Rod", zh: "做探水杖" },
  42: { en: "Make a Twig Charm", zh: "做树枝护身符" },
  10002: { en: "Offer an Old Coin", zh: "献上古钱币" },
};
