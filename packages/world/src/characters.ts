/**
 * The people of the world. Who they are in
 * Lingxi, and everything they say, is written here in English and Chinese.
 *
 * A conversation is a greeting, then a choice of topics. Each topic is a few
 * lines and may end with a door into the game (the shop, the map, the arena…).
 * Choosing a topic always comes back to the choices; "goodbye" ends it.
 */

export type Action = "shop" | "map" | "quests" | "mind" | "spar" | "bag" | "proof";

export interface Line {
  /** portrait file under /art/npcs/ */
  face: string;
  en: string;
  zh: string;
}

export interface Topic {
  ask: { en: string; zh: string };
  lines: Line[];
  action?: Action;
}

export interface Character {
  id: string;
  name: { en: string; zh: string };
  role: { en: string; zh: string };
  room: number;
  /** name-tag colour, matched to the portrait */
  color: string;
  /** standing portrait shown in the room */
  stand: string;
  greeting: Line[];
  topics: Topic[];
  bye: Line;
}

const L = (face: string, en: string, zh: string): Line => ({ face, en, zh });
const ask = (en: string, zh: string) => ({ en, zh });

export const CHARACTERS: readonly Character[] = [
  {
    id: "wick",
    name: { en: "Wick", zh: "灯芯" },
    role: { en: "Lantern keeper", zh: "守灯人" },
    room: 64,
    color: "#8fa85a",
    stand: "wick.png",
    greeting: [L("wick_happy.png", "Oh! A new little one. Welcome to the Lantern Room — it's right outside your door.", "哎呀！新来的小家伙。欢迎来到灯笼屋——它就在你家门口。")],
    topics: [
      {
        ask: ask("Who are you?", "你是谁？"),
        lines: [
          L("wick.png", "I keep the lanterns lit so pets can find their way home in the dark.", "我负责点亮这些灯笼，好让宠物们天黑也能找到回家的路。"),
          L("wick_lost_in_thought.png", "Every lantern here was lit by someone for someone else. That's the only rule.", "这里的每一盏灯，都是有人为别人点的。这是唯一的规矩。"),
        ],
      },
      {
        ask: ask("Where should we go?", "我们该去哪儿？"),
        lines: [
          L("wick_clasping_hands.png", "Wander a little each day. Look around wherever you stop — the world leaves gifts for curious pets.", "每天出去走一走。每到一个地方就四处找找——这个世界会给好奇的宠物留礼物。"),
          L("wick_happy.png", "Walking tires your pet, so come home to rest. The map shows every road.", "走路会让宠物累，记得回家休息。地图上有每一条路。"),
        ],
        action: "map",
      },
      {
        ask: ask("About giving", "关于送礼"),
        lines: [
          L("wick.png", "Something you find can be shared. When a friend visits, a gift from your bag means more than you'd think.", "你找到的东西可以分享。朋友来做客时，从背包里拿一份礼物，意义比你想的更大。"),
          L("wick_lost_in_thought.png", "Pets remember who was kind to them. It's written into them, quite literally.", "宠物会记得谁对它好。这真的会写进它们心里。"),
        ],
        action: "bag",
      },
    ],
    bye: L("wick_happy.png", "Mind the step on your way back. The lanterns will be here.", "回去时小心台阶。灯笼会一直亮着。"),
  },
  {
    id: "praline",
    name: { en: "Praline", zh: "糖霜" },
    role: { en: "Sweets seller", zh: "糖果店主" },
    room: 13,
    color: "#c777d9",
    stand: "praline_default.png",
    greeting: [L("praline_default_1.png", "Welcome in. You may call me Praline. Browse all you like — the bell will tell me if you leave.", "欢迎光临，叫我糖霜就好。随便看——你走的时候，门铃会告诉我。")],
    topics: [
      {
        ask: ask("What do you sell?", "你卖什么？"),
        lines: [
          L("praline_default_1.png", "Treats for pets, mostly. And a few hobby tools for anyone who likes to mix and craft.", "主要是给宠物的零食。也有些手作工具，给喜欢调配东西的人。"),
          L("praline_laugh_1.png", "Coins only. I don't take promises, however sweet.", "只收金币。承诺再甜，我也不收。"),
        ],
        action: "shop",
      },
      {
        ask: ask("Does food matter?", "吃什么有关系吗？"),
        lines: [
          L("praline_default_1.png", "More than you'd think. A pet raised on fruit grows up differently from one raised on savoury things.", "比你想的更有关系。吃水果长大的宠物，和吃咸香食物长大的，长成的样子不一样。"),
          L("praline_pity_1.png", "Too many sweets and it gets fussy. I say that as someone who sells sweets.", "甜食吃太多会变挑剔。这话由卖糖的人来说，你该信。"),
        ],
      },
      {
        ask: ask("About you", "说说你自己"),
        lines: [
          L("praline_laugh_1.png", "Getting personal already? How forward.", "这么快就打听我？真直接。"),
          L("praline_default_1.png", "I go where the coins go. This corner seemed like a good place to stop for a while.", "金币去哪儿，我就去哪儿。这个街角看起来适合停一阵子。"),
        ],
      },
    ],
    bye: L("praline_default_1.png", "Come back hungry.", "下次饿着肚子来。"),
  },
  {
    id: "yonder",
    name: { en: "Yonder", zh: "阿远" },
    role: { en: "Wayfinder", zh: "引路人" },
    room: 3,
    color: "#77d97c",
    stand: "yonder.png",
    greeting: [L("yonder_day.png", "You walked all the way to the gate. Good legs, that one has.", "你们一路走到了鸟居这儿。这小家伙腿脚不错。")],
    topics: [
      {
        ask: ask("Any errands?", "有什么事要做吗？"),
        lines: [
          L("yonder_day.png", "Always. Small jobs, fair rewards. Finish one and the next will find you.", "一直都有。小差事，报酬公道。做完一件，下一件自然会来找你。"),
        ],
        action: "quests",
      },
      {
        ask: ask("Tips for exploring", "探索有什么诀窍？"),
        lines: [
          L("yonder_pose_2.png", "Every place hides different things. Once you've searched a spot it's picked clean for a while — try again in an hour.", "每个地方藏的东西都不一样。一个地方找过之后会空一阵子——过一个小时再来找。"),
          L("yonder_day.png", "Watch its energy. A tired pet walks home slowly and sulks all evening.", "注意它的精力。累坏的宠物回家走得慢，还会闹一晚上脾气。"),
        ],
        action: "map",
      },
      {
        ask: ask("Why do pets bow here?", "宠物为什么在这儿鞠躬？"),
        lines: [L("yonder_night.png", "Nobody taught them. Some things are in a pet before anyone teaches it anything.", "没人教过它们。有些东西，在谁都还没教的时候，就已经在宠物心里了。")],
      },
    ],
    bye: L("yonder_day.png", "Roads are long. Bring snacks.", "路很长，带上零食。"),
  },
  {
    id: "twain",
    name: { en: "Twain", zh: "双生者" },
    role: { en: "Keeper of the Wheel", zh: "轮之殿守护者" },
    room: 19,
    color: "#f5d107",
    stand: "twain_both.png",
    greeting: [
      L("twain_frown.png", "Hail, curious one. We are Twain. Two heads, one answer.", "你好，好奇的人。我们是双生者。两个头，一个答案。"),
      L("twain_laugh.png", "Which is more than most people manage. Heh heh.", "这已经比大多数人强了。嘿嘿。"),
    ],
    topics: [
      {
        ask: ask("How does a pet think?", "宠物是怎么思考的？"),
        lines: [
          L("twain_frown.png", "Its mind is a circuit — little gates that each look at two signals and answer yes or no.", "它的心智是一块电路——一个个小门，每个看两个信号，回答是或否。"),
          L("twain_laugh.png", "Rather like us. We say 'yes' unless both of us say yes. That gate is called NAND, and every other kind of gate can be built from it.", "有点像我们：除非我们俩都说“是”，否则我们就说“是”。这种门叫与非门，别的门都能用它搭出来。"),
          L("twain_frown.png", "Its senses go in, its wishes come out. Press the little chip in the corner of the room to watch it think.", "感觉从一头进去，愿望从另一头出来。点房间角落的小芯片，就能看它怎么思考。"),
        ],
      },
      {
        ask: ask("Can it remember?", "它会记事吗？"),
        lines: [
          L("twain_frown.png", "Some gates hold on to what they last saw. Latches, they're called. That is how a pet learns to trust you, one kindness at a time.", "有些门会记住上一次看到的东西，叫锁存器。宠物就是这样，一次一次地，学会信任你。"),
        ],
      },
      {
        ask: ask("Can I change its mind?", "我能改变它的想法吗？"),
        lines: [
          L("twain_laugh.png", "Teach it. Each lesson becomes a few more gates, and what you teach outranks what it was born with.", "教它。每一课都会变成几个新的门，而且你教的东西，比它天生的本能更优先。"),
          L("twain_frown.png", "Choose carefully. A crowded mind has no room for everything.", "要慎重挑选。心智装满了，就放不下所有东西。"),
        ],
        action: "mind",
      },
      {
        ask: ask("Is it really real?", "这些是真的吗？"),
        lines: [
          L("twain_frown.png", "Its circuit lives on the chain, and so does a fingerprint of everything that has happened to it.", "它的电路存在链上，它经历过的每一件事，也都留下了指纹。"),
          L("twain_laugh.png", "Anyone with its log can replay its thoughts and check them. We checked. We were disappointed it was honest.", "拿到它的日志，谁都可以重放它的想法来核对。我们核对过了。它太诚实，我们有点失望。"),
        ],
        action: "proof",
      },
    ],
    bye: L("twain_laugh.png", "Go well. Both of us mean it, which is rare.", "慢走。我们俩都是真心的，这可不常见。"),
  },
  {
    id: "bolt",
    name: { en: "Bolt", zh: "螺丝" },
    role: { en: "Tinker", zh: "修补匠" },
    room: 5,
    color: "#8e74e4",
    stand: "bolt_clear1.png",
    greeting: [L("bolt_clear1.png", "Beep. Sorry. Habit. I fix things, I make things, and I sit under these trees.", "哔。抱歉，习惯了。我修东西、做东西，然后坐在这些树下。")],
    topics: [
      {
        ask: ask("Can I make things?", "我能做东西吗？"),
        lines: [
          L("bolt_clear2.png", "Bring the right pieces and anything can be made. Recipes are in your bag, under crafting.", "带齐材料，什么都能做出来。配方在你背包里的“制作”那一栏。"),
          L("bolt_clear1.png", "What you find out in the world is usually the hard part.", "难的通常是去外面把材料找齐。"),
        ],
        action: "bag",
      },
      {
        ask: ask("Are you a robot?", "你是机器人吗？"),
        lines: [L("bolt_clear3.png", "I prefer 'very well organised'.", "我更喜欢“非常有条理”这个说法。")],
      },
    ],
    bye: L("bolt_clear1.png", "Boop. That one was on purpose.", "噗。这次是故意的。"),
  },
  {
    id: "flit",
    name: { en: "Flit", zh: "蝶叔" },
    role: { en: "Butterfly watcher", zh: "看蝴蝶的人" },
    room: 56,
    color: "#6f9ee8",
    stand: "flit.png",
    greeting: [L("flit.png", "Shh — slowly. They land on pets who stay still.", "嘘——慢一点。它们只会落在安静不动的宠物身上。")],
    topics: [
      {
        ask: ask("What lives here?", "这里住着什么？"),
        lines: [
          L("flit.png", "Butterflies, beetles, things with too many legs and things with none. Each forest keeps its own.", "蝴蝶、甲虫，腿太多的和没有腿的。每片森林都有自己的住客。"),
          L("flit.png", "Look around in different places and you'll find different things. Write down where.", "在不同的地方找找，会找到不同的东西。记得记下在哪儿找到的。"),
        ],
        action: "map",
      },
      {
        ask: ask("Does my pet like it here?", "我的宠物喜欢这儿吗？"),
        lines: [L("flit.png", "Curious ones never want to leave. Bold ones chase everything. Gentle ones just watch. All correct.", "好奇的不想走，勇敢的什么都追，温柔的只是看着。都没错。")],
      },
    ],
    bye: L("flit.png", "Quietly, now.", "轻轻地走。"),
  },
  {
    id: "why",
    name: { en: "Nurse Why", zh: "护士小慧" },
    role: { en: "Pet nurse", zh: "宠物护士" },
    room: 59,
    color: "#e2685c",
    stand: "nurse_smiling.png",
    greeting: [L("nurse_smiling.png", "Hello, hello. Let's have a look at you both. Mm-hm. Mm-hm.", "你好你好。让我看看你们俩。嗯。嗯嗯。")],
    topics: [
      {
        ask: ask("How do I keep it well?", "怎么让它健健康康？"),
        lines: [
          L("nurse_lecturing.png", "Four things: fed, happy, rested, clean. Let any of them run out for long and it will tell you — loudly.", "四件事：吃饱、开心、休息好、干净。哪样空了太久，它都会告诉你——很大声地。"),
          L("nurse_lecturing.png", "Lights off at night. A pet kept up too long gets cranky, and cranky pets make poor choices.", "晚上要关灯。熬夜太久的宠物会闹脾气，闹脾气的宠物会做出糟糕的决定。"),
        ],
      },
      {
        ask: ask("What if I'm away?", "我不在的时候呢？"),
        lines: [
          L("nurse_cradling.png", "It keeps living while you're gone, and it will be hungry when you're back. After a few days it curls up and sleeps until you return.", "你不在的时候它也在过日子，回来时它会饿。几天之后，它会蜷起来睡觉，一直等到你回来。"),
          L("nurse_smiling.png", "No pet is ever lost for being missed. It just misses you back.", "没有宠物会因为被冷落而消失。它只会同样地想你。"),
        ],
      },
    ],
    bye: L("nurse_smiling.png", "Water, rest, and a pat on the head. Doctor's orders. Well — nurse's.", "多喝水、多休息、摸摸头。医嘱。好吧——护士嘱。"),
  },
  {
    id: "jab",
    name: { en: "Jab", zh: "阿拳" },
    role: { en: "Spar coach", zh: "切磋教练" },
    room: 89,
    color: "#e25c81",
    stand: "jab_default_1.png",
    greeting: [L("jab_default_1.png", "Ah, a challenger! Every trophy in this room was won by a pet somebody taught well.", "哈，挑战者！这屋里的每一座奖杯，都是被好好教过的宠物赢来的。")],
    topics: [
      {
        ask: ask("How do spars work?", "切磋是怎么回事？"),
        lines: [
          L("jab_default_1.png", "Two pets, sixteen rounds. Nobody presses buttons. Each pet's own mind picks every move.", "两只宠物，十六个回合。没人按按钮，每一招都由宠物自己的心智决定。"),
          L("jab_shocked_1.png", "Which means the real fight happens before — when you teach it.", "所以说，真正的比赛在开打之前——就是你教它的时候。"),
        ],
        action: "spar",
      },
      {
        ask: ask("We keep losing", "我们老是输"),
        lines: [
          L("jab_shrug_1.png", "Everybody does at first. After a loss, listen to the coach — it tries every lesson in practice and tells you which one actually wins.", "一开始谁都这样。输了以后听听教练的——它会在练习里把每一课都试一遍，告诉你哪一课真的能赢。"),
        ],
        action: "spar",
      },
      {
        ask: ask("Can we fight friends?", "能和朋友切磋吗？"),
        lines: [L("jab_scary_1.png", "When a friend's pet is in the same room, tap it. Their real mind against yours. No mercy. Lots of hugs after.", "朋友的宠物和你在同一个房间时，点它一下。它真正的心智对你的。不手下留情，打完多抱抱。")],
      },
    ],
    bye: L("jab_default_1.png", "Go train! I'll polish a shelf for you.", "去练吧！我先给你擦好一层奖杯架。"),
  },
  {
    id: "nimbus",
    name: { en: "Nimbus", zh: "云朵" },
    role: { en: "Daydreamer", zh: "爱做梦的人" },
    room: 53,
    color: "#bfe25c",
    stand: "nimbus_default.png",
    greeting: [L("nimbus_daydreaming.png", "Oh — hello. I was just wondering what your pet will be when it grows up.", "哦——你好。我刚才还在想，你的宠物长大以后会变成什么样子。")],
    topics: [
      {
        ask: ask("What will it become?", "它会变成什么？"),
        lines: [
          L("nimbus_smiling.png", "It depends on how it's raised: how often you care for it, what it eats, how much it trusts you, how much it's taught. All of it counts.", "要看怎么养它：照顾得勤不勤、吃什么、有多信任你、教了它多少。都算数。"),
          L("nimbus_daydreaming.png", "Even that choice is made by a little circuit, so anyone can check it was fair.", "就连长成什么样，也是一块小电路决定的，所以谁都能核对它公不公平。"),
        ],
        action: "mind",
      },
      {
        ask: ask("Do pets have families?", "宠物有家人吗？"),
        lines: [
          L("nimbus_smiling.png", "When two grown pets are fond of each other, their owners can agree to raise a little one together.", "两只长大的宠物互相喜欢时，它们的主人可以商量着一起养一只小宝宝。"),
          L("nimbus_daydreaming.png", "The little one's mind is built from both of theirs. You can even see which half it got from whom.", "小宝宝的心智由它们俩的心智搭成。你甚至能看出哪一半来自谁。"),
        ],
      },
    ],
    bye: L("nimbus_smiling.png", "Sweet dreams, when it's time.", "到时候，做个好梦。"),
  },
];

export const CHARACTER_IN_ROOM: Record<number, Character> = Object.fromEntries(CHARACTERS.map((c) => [c.room, c]));
