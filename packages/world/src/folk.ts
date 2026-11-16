/**
 * How each resident greets you (plan 4.11): their mood and which line they choose, decided by a small circuit per
 * resident from what is true right now. The circuit reads:
 *
 *   bits 0-1  time of day (0 night, 1 morning, 2 day, 3 evening; the pet's own clock buckets)
 *   bits 2-4  trust level with this resident (0-5)
 *   bits 5-6  today's gift to them (0 none, 1 loved or liked, 2 accepted politely, 3 refused)
 *   bit  7    the pet is happy (joy at 600 or more)
 *   bit  8    the pet is hungry (food under 300)
 *   bit  9    a quest of theirs is ready to hand in
 *
 * and answers mood in bits 0-1 (0 low, 1 calm, 2 glad, 3 delighted) and the line in bits 2-4. Lines by slot:
 * 0 their usual hello, 1 morning, 2 evening or night, 3 thanks for today's gift, 4 after a refused gift,
 * 5 an old friend, 6 the pet looks hungry, 7 something is ready for them. Each resident ranks the slots in their
 * own order and has their own temper, so no two circuits are alike.
 */

import { type Line } from "./characters";

export type Slot = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Folk {
  id: string;
  /** which slot wins when several are true, most important first; slot 0 is always last */
  order: readonly Exclude<Slot, 0>[];
  /** mood before anything happens */
  base: 0 | 1 | 2 | 3;
  /** mood shift in the morning, and at evening and night */
  morning: -1 | 0 | 1;
  night: -1 | 0 | 1;
  /** mood shift when the pet is happy (some are lifted by it, some do not notice) */
  cheered: 0 | 1;
  /** faces for moods 0-3 */
  faces: readonly [string, string, string, string];
  /** lines for slots 1-7 (slot 0 is their greeting) */
  lines: Record<Exclude<Slot, 0>, Line>;
}

const L = (face: string, en: string, zh: string): Line => ({ face, en, zh });

export const FOLK: readonly Folk[] = [
  {
    id: "wick",
    order: [7, 4, 3, 6, 5, 2, 1],
    base: 2,
    morning: 0,
    night: 1,
    cheered: 1,
    faces: ["wick_lost_in_thought.png", "wick.png", "wick_happy.png", "wick_clasping_hands.png"],
    lines: {
      1: L("wick.png", "Morning. I'm letting the lanterns rest; they worked hard all night.", "早上好。我让灯笼歇一歇，它们辛苦了一整夜。"),
      2: L("wick_happy.png", "There you are. I lit one more lantern tonight, just in case you came by.", "你来啦。今晚我多点了一盏灯，就怕你会路过。"),
      3: L("wick_clasping_hands.png", "You remembered me today. I'll hang it where the light falls on it.", "你今天想着我了。我要把它挂在灯光照得到的地方。"),
      4: L("wick_lost_in_thought.png", "Thank you for thinking of me. It isn't quite me, but the thought is.", "谢谢你想着我。这东西不太像我，但这份心意很像。"),
      5: L("wick_happy.png", "My favourite visitors. The lanterns brighten a little when you two walk in.", "我最喜欢的客人。你们俩一进来，灯笼都亮了一点。"),
      6: L("wick_lost_in_thought.png", "Your little one keeps looking at the shop. When did it last eat?", "你的小家伙一直往小店那边看。它上一顿是什么时候吃的？"),
      7: L("wick_clasping_hands.png", "Is that for me? You've done what I asked. Come, tell me everything.", "那是给我的吗？我拜托的事你办好了。快来，全都讲给我听。"),
    },
  },
  {
    id: "praline",
    order: [7, 3, 4, 6, 1, 5, 2],
    base: 1,
    morning: 1,
    night: -1,
    cheered: 0,
    faces: ["praline_pity_1.png", "praline_default_1.png", "praline_laugh_1.png", "praline_laugh_1.png"],
    lines: {
      1: L("praline_laugh_1.png", "Early bird. The shelves are full and nobody has haggled yet. Lovely.", "来得早。货架满着，还没人讨价还价。真好。"),
      2: L("praline_default_1.png", "We're closing soon. Buy something or keep me company, either is fine.", "快打烊了。买点东西也行，陪我聊聊也行。"),
      3: L("praline_laugh_1.png", "A gift? For the shopkeeper? You'll get a reputation.", "送礼？送给店主？你会出名的。"),
      4: L("praline_pity_1.png", "I sell those, darling. Giving one back to me is a little like returning it.", "亲爱的，那是我卖的东西。送回给我，有点像退货。"),
      5: L("praline_laugh_1.png", "My best customer. I still won't take promises, but I'll smile while I refuse.", "我最好的客人。我还是不收承诺，不过会笑着拒绝你。"),
      6: L("praline_pity_1.png", "That pet is staring at my sweets like they owe it money. Feed it, please.", "那小家伙盯着我的糖，好像糖欠了它钱。快喂喂它吧。"),
      7: L("praline_default_1.png", "You found what I wanted? Put it on the counter. Let's see it.", "我要的东西你找到了？放柜台上，让我看看。"),
    },
  },
  {
    id: "yonder",
    order: [7, 6, 4, 3, 1, 2, 5],
    base: 1,
    morning: 1,
    night: -1,
    cheered: 1,
    faces: ["yonder_night.png", "yonder_day.png", "yonder_pose_2.png", "yonder_pose_2.png"],
    lines: {
      1: L("yonder_day.png", "Good light for walking. The roads are quiet before noon.", "这光正适合走路。中午之前路上都很清静。"),
      2: L("yonder_night.png", "Late to be out. Stay near the lanterns on the way home.", "这么晚还在外面。回家路上离灯笼近一点。"),
      3: L("yonder_pose_2.png", "Useful. I'll carry it on the next long road.", "有用。下次走远路我就带着它。"),
      4: L("yonder_day.png", "Keep it. I travel light, and that would weigh on me.", "你留着吧。我出门东西带得少，这个会压着我。"),
      5: L("yonder_pose_2.png", "You two walk like you've done it a hundred times. You have, haven't you.", "你们俩走起路来像走过一百遍。确实走过吧。"),
      6: L("yonder_day.png", "That one's running on nothing. No one walks far on an empty belly.", "这小家伙肚子空空。空着肚子谁也走不远。"),
      7: L("yonder_pose_2.png", "Job done? Good. Hand it over and I'll find you the next one.", "活干完了？好。交给我，我给你找下一件。"),
    },
  },
  {
    id: "twain",
    order: [7, 4, 3, 2, 5, 6, 1],
    base: 1,
    morning: -1,
    night: 1,
    cheered: 1,
    faces: ["twain_frown.png", "twain_both.png", "twain_laugh.png", "twain_laugh.png"],
    lines: {
      1: L("twain_frown.png", "Morning. One of us is awake. The other is still deciding.", "早。我们俩醒了一个，另一个还在考虑。"),
      2: L("twain_laugh.png", "Night! The best time for thinking. Both heads agree, for once.", "夜晚！最适合思考的时候。这次两个脑袋难得意见一致。"),
      3: L("twain_laugh.png", "For us? Both heads say yes. That makes it a no, by our gate. We'll keep it anyway.", "给我们的？两个脑袋都说好。按我们的门，那就是不好。不过我们还是收下了。"),
      4: L("twain_frown.png", "Neither of us wants it. For once we agree completely.", "我们俩都不想要。这次我们完全意见一致。"),
      5: L("twain_laugh.png", "Old friend. You have outlasted most of our arguments.", "老朋友。你比我们大部分的争论都撑得久。"),
      6: L("twain_both.png", "Its hunger signal is lit. You can tell from here. So can we. Twice.", "它的饥饿信号亮了。你在这儿就看得出来。我们也看得出来，看了两遍。"),
      7: L("twain_both.png", "You've done it. Show us both, slowly, so neither head misses it.", "你做到了。慢慢拿给我们俩看，别让哪个脑袋漏看了。"),
    },
  },
  {
    id: "bolt",
    order: [7, 4, 3, 5, 6, 1, 2],
    base: 1,
    morning: 0,
    night: 0,
    cheered: 1,
    faces: ["bolt_clear3.png", "bolt_clear1.png", "bolt_clear2.png", "bolt_clear2.png"],
    lines: {
      1: L("bolt_clear1.png", "Morning. The birds already brought me two screws. Busy day ahead.", "早。鸟已经给我叼来两颗螺丝了。今天要忙了。"),
      2: L("bolt_clear1.png", "Too dark to solder. Good time to sort screws by feel.", "太暗了没法焊。正好摸黑给螺丝分类。"),
      3: L("bolt_clear2.png", "Your gift is already on the bench. I've drawn up plans. Three of them.", "你送的东西已经摆上工作台了。我画好了图纸，三张。"),
      4: L("bolt_clear3.png", "I checked the gears twice after that. All clean. No hard feelings. Beep.", "那之后我把齿轮检查了两遍。都很干净。没生气。哔。"),
      5: L("bolt_clear2.png", "My favourite pair of tinkerers. Boop. That one was on purpose.", "我最喜欢的两个小工匠。噗。这下是故意的。"),
      6: L("bolt_clear3.png", "Low battery on your friend there. Food first, then fixing.", "你的小伙伴电量不足了。先吃东西，再修东西。"),
      7: L("bolt_clear2.png", "Got the parts? Lay them out. I'll check every piece.", "零件带来了？摆出来吧。我一个个检查。"),
    },
  },
  {
    id: "flit",
    order: [7, 3, 4, 1, 5, 2, 6],
    base: 1,
    morning: 1,
    night: 0,
    cheered: 0,
    faces: ["flit.png", "flit.png", "flit.png", "flit.png"],
    lines: {
      1: L("flit.png", "Dew on every leaf. The beetles are slow in the morning. Best time to watch.", "每片叶子上都是露水。早上甲虫动得慢，最适合观察。"),
      2: L("flit.png", "The night ones are out. Quietly now, or they'll hide.", "夜里出来的那些都出来了。轻一点，不然它们会躲起来。"),
      3: L("flit.png", "Oh. Thank you. I'll note it in the book, under 'kindnesses'.", "哦。谢谢你。我会记在本子上，记在“善意”那一栏。"),
      4: L("flit.png", "Hm. I'll put it back where it lives. It's happier there.", "嗯。我把它放回它原来的地方。它在那儿更自在。"),
      5: L("flit.png", "You move like a watcher now. They don't fly off when you come.", "你现在的动作像个观察者了。你过来时它们都不飞走。"),
      6: L("flit.png", "Your pet is watching the beetles a bit too closely. Lunch?", "你的宠物盯着甲虫看得有点太认真了。该吃午饭了吧？"),
      7: L("flit.png", "You've found them? Slowly. Let me see.", "你找到了？慢一点。让我看看。"),
    },
  },
  {
    id: "why",
    order: [6, 7, 4, 3, 2, 5, 1],
    base: 2,
    morning: 0,
    night: -1,
    cheered: 1,
    faces: ["nurse_lecturing.png", "nurse_smiling.png", "nurse_smiling.png", "nurse_cradling.png"],
    lines: {
      1: L("nurse_smiling.png", "Good morning, both. Did everyone sleep? Mm-hm. Good.", "两位早上好。都睡好了吗？嗯。很好。"),
      2: L("nurse_lecturing.png", "It's late. Lights off soon, please. Cranky pets make poor choices.", "很晚了。请早点关灯。犯困的宠物会做出糟糕的选择。"),
      3: L("nurse_cradling.png", "For me? Oh, you shouldn't have. Well. I'm glad you did.", "给我的？哎呀，不用这样的。好吧，你送了我很高兴。"),
      4: L("nurse_smiling.png", "That's very kind, but I can't take it. Nurse's rules.", "你真好，可我不能收。这是护士的规矩。"),
      5: L("nurse_cradling.png", "My two favourite patients, and neither of you is even ill.", "我最喜欢的两个病人，而且你们俩都没生病。"),
      6: L("nurse_lecturing.png", "That tummy is empty. Feed it first; then we talk. Nurse's orders.", "这肚子是空的。先喂饱它，再说话。这是护士的吩咐。"),
      7: L("nurse_smiling.png", "Done already? Let's have a look. Mm-hm. Mm-hm.", "已经做好了？让我看看。嗯。嗯嗯。"),
    },
  },
  {
    id: "jab",
    order: [7, 3, 4, 5, 1, 6, 2],
    base: 2,
    morning: 1,
    night: 0,
    cheered: 1,
    faces: ["jab_shrug_1.png", "jab_default_1.png", "jab_default_1.png", "jab_scary_1.png"],
    lines: {
      1: L("jab_scary_1.png", "Morning! Fresh minds, fresh fights. Who's first?", "早！头脑清醒，正好比赛。谁先来？"),
      2: L("jab_default_1.png", "Late practice? That's how champions are made. And sleepy ones.", "这么晚还来练？冠军就是这样炼成的。困得要命的冠军。"),
      3: L("jab_scary_1.png", "A gift! I'll put it on the shelf with the trophies. It earned it.", "礼物！我要把它和奖杯一起摆上架子。它配得上。"),
      4: L("jab_shrug_1.png", "Not my style. But I respect the attempt. Very sporting.", "不是我的风格。不过这份尝试我很欣赏。很有风度。"),
      5: L("jab_scary_1.png", "My favourite rivals! Ready to lose gracefully? Ha. Kidding. Mostly.", "我最喜欢的对手！准备好体面地输了吗？哈，开玩笑的。大概是。"),
      6: L("jab_shrug_1.png", "No fighting on an empty stomach. Even champions eat.", "空着肚子不能比赛。冠军也要吃饭。"),
      7: L("jab_default_1.png", "You did it? Then come and claim it like a champion.", "你做到了？那就像冠军一样来领奖吧。"),
    },
  },
  {
    id: "nimbus",
    // a daydreamer: in the evening her dream comes before anything else but a finished errand
    order: [7, 2, 3, 4, 5, 6, 1],
    base: 1,
    morning: -1,
    night: 1,
    cheered: 1,
    faces: ["nimbus_daydreaming.png", "nimbus_daydreaming.png", "nimbus_smiling.png", "nimbus_smiling.png"],
    lines: {
      1: L("nimbus_daydreaming.png", "Mm, morning already? I was still dreaming about what your pet might become.", "嗯，已经早上了？我还在梦你的宠物以后会长成什么样。"),
      2: L("nimbus_smiling.png", "Evening is when little ones dream the most. Yours too, I think.", "傍晚是小家伙们做梦最多的时候。你的也是吧。"),
      3: L("nimbus_smiling.png", "For me? I'll keep it by the window, where the dreams come in.", "给我的？我要把它放在窗边，梦就是从那儿进来的。"),
      4: L("nimbus_daydreaming.png", "Oh, I couldn't. Give it to someone who'd dream about it.", "哦，我不能收。送给会梦到它的人吧。"),
      5: L("nimbus_smiling.png", "You two again. Every time I see you, I picture it a little older.", "又是你们俩。每次见到你们，我都会想它再长大一点的样子。"),
      6: L("nimbus_daydreaming.png", "It's hard to grow on an empty stomach. Something sweet, maybe?", "空着肚子很难长大。来点甜的吧？"),
      7: L("nimbus_smiling.png", "You found it? Show me. I want to remember this one.", "你找到了？给我看看。我想记住这一刻。"),
    },
  },
];

export const FOLK_BY_ID: Readonly<Record<string, Folk>> = Object.fromEntries(FOLK.map((f) => [f.id, f]));

export interface FolkView {
  /** 0 night, 1 morning, 2 day, 3 evening */
  timeOfDay: number;
  trustLevel: number;
  /** 0 none, 1 loved or liked, 2 accepted politely, 3 refused */
  giftToday: 0 | 1 | 2 | 3;
  petHappy: boolean;
  petHungry: boolean;
  questReady: boolean;
}

export const folkWord = (v: FolkView): number =>
  (v.timeOfDay & 3) | (Math.min(5, Math.max(0, v.trustLevel)) << 2) | ((v.giftToday & 3) << 5) | (v.petHappy ? 1 << 7 : 0) | (v.petHungry ? 1 << 8 : 0) | (v.questReady ? 1 << 9 : 0);

/** The resident's mood and line as plain arithmetic: the reference their circuit is compiled from. */
export function folkReference(f: Folk, word: number): number {
  const tod = word & 3;
  const trust = Math.min(5, (word >> 2) & 7);
  const gift = (word >> 5) & 3;
  const happy = (word >> 7) & 1;
  const hungry = (word >> 8) & 1;
  const ready = (word >> 9) & 1;
  const holds: Record<Exclude<Slot, 0>, boolean> = {
    1: tod === 1,
    2: tod === 0 || tod === 3,
    3: gift === 1 || gift === 2,
    4: gift === 3,
    5: trust >= 3,
    6: hungry === 1,
    7: ready === 1,
  };
  const slot = f.order.find((s) => holds[s]) ?? 0;
  const mood =
    f.base + (tod === 1 ? f.morning : 0) + (tod === 0 || tod === 3 ? f.night : 0) + (gift === 1 ? 1 : gift === 3 ? -1 : 0) + (trust >= 3 ? 1 : 0) + (happy ? f.cheered : 0) - (hungry && slot === 6 ? 1 : 0);
  return Math.max(0, Math.min(3, mood)) | (slot << 2);
}
