/**
 * Personality every day (G9): a pet's habits colour what it says about its choices. The choice is always the
 * circuit's; the words are chosen by the pet's strongest habit, so a shy pet and a greedy one say the same choice in
 * their own way. No new randomness: the same pet with the same traits says the same line for the same choice.
 */

import type { StarterLine } from "@lingxi/brain";
import { HABIT } from "./visitors";
import { TRAITS, type Trait } from "./pet";
import type { MomentKey } from "./replay";

type Lines = Readonly<Record<MomentKey, { en: string; zh: string }>>;

/** What the Pet sheet says of a pet's nature (R64). */
export interface Nature {
  /** the egg's line: the temperament it hatched with, and its nature for life */
  line: StarterLine;
  /** the habits its doings have made of it (a trait at HABIT or more), the strongest two */
  habits: Trait[];
  /** before any is a habit, the trait its doings lean to; null when it has none, or habits to show */
  growing: Trait | null;
}

/**
 * A pet's nature as its sheet says it: the egg's line first, then the habits grown from what it does, counted from
 * HABIT as the voice and the visitors count them. A trait's first points of drift are a leaning, never its nature: a
 * Bold egg taught to share was read "gentle" the first time it met a friend (R64).
 */
export function natureOf(p: { line: StarterLine; traits: Readonly<Record<Trait, number>> }): Nature {
  const habits = habitsOf(p.traits).slice(0, 2);
  let growing: Trait | null = null;
  if (!habits.length)
    for (const t of TRAITS) if (p.traits[t] > 0 && (growing === null || p.traits[t] > p.traits[growing])) growing = t;
  return { line: p.line, habits, growing };
}

/** The strongest habit a pet has (a trait at HABIT or more), the first in TRAITS order on a tie; null when it has none yet. */
export function strongestHabit(traits: Readonly<Record<Trait, number>> | undefined): Trait | null {
  if (!traits) return null;
  let best: Trait | null = null;
  for (const t of TRAITS) if ((traits[t] ?? 0) >= HABIT && (best === null || traits[t]! > traits[best]!)) best = t;
  return best;
}

/** Every habit a pet has, strongest first (for the voice: up to three). */
export function habitsOf(traits: Readonly<Record<Trait, number>> | undefined): Trait[] {
  if (!traits) return [];
  return TRAITS.filter((t) => (traits[t] ?? 0) >= HABIT).sort(
    (a, b) => traits[b]! - traits[a]! || TRAITS.indexOf(a) - TRAITS.indexOf(b),
  );
}

export const HABIT_LINES: Readonly<Record<Trait, Lines>> = {
  brave: {
    idle: { en: "I kept watch over the room for a while.", zh: "我守着房间看了一会儿。" },
    eat: { en: "I marched straight to my bowl.", zh: "我大步走到碗前面。" },
    play: { en: "I wanted a game, the rougher the better!", zh: "我想玩，越热闹越好！" },
    sleep: { en: "I slept where I could guard the door.", zh: "我睡在能守住门口的地方。" },
    explore: {
      en: "I went to see what was out there. Nothing scared me.",
      zh: "我出去看看外面有什么。什么都吓不到我。",
    },
    sulk: { en: "I huffed and stood my ground.", zh: "我哼了一声，站着不动。" },
    cuddle: { en: "I came over. Not because I was scared.", zh: "我过来了。才不是因为害怕。" },
    share: { en: "I gave my friend the best bit. Leaders do that.", zh: "我把最好的分给朋友。带头的都这样。" },
  },
  curious: {
    idle: { en: "I wondered about the ceiling for a while.", zh: "我对着天花板想了好一会儿。" },
    eat: { en: "I wanted to know what was in the bowl today.", zh: "我想知道今天碗里有什么。" },
    play: { en: "I wanted to play and find out how the toy works!", zh: "我想玩，顺便弄清楚玩具怎么动！" },
    sleep: { en: "I fell asleep in the middle of a question.", zh: "我想着一个问题就睡着了。" },
    explore: { en: "I went off to look at everything twice.", zh: "我出去把每样东西都看了两遍。" },
    sulk: { en: "I sulked, but I peeked to see if you noticed.", zh: "我闹别扭了，不过偷偷看你有没有注意到。" },
    cuddle: { en: "I came over to see what you were doing.", zh: "我过来看看你在做什么。" },
    share: { en: "I shared, to see what my friend would do.", zh: "我分享了，想看看朋友会怎么做。" },
  },
  greedy: {
    idle: { en: "I sat and thought about snacks.", zh: "我坐着想零食。" },
    eat: { en: "Food! I wanted food. All of it.", zh: "吃的！我想吃东西，全部都要。" },
    play: { en: "I wanted to play. Is there a snack after?", zh: "我想玩。玩完有零食吗？" },
    sleep: { en: "I slept and dreamed about dinner.", zh: "我睡着了，梦见了晚饭。" },
    explore: { en: "I went looking for anything I could eat.", zh: "我出去找能吃的东西。" },
    sulk: { en: "I sulked. My tummy was not consulted.", zh: "我闹别扭了。都没问过我的肚子。" },
    cuddle: { en: "I came over, in case you had a treat.", zh: "我过来了，说不定你有好吃的。" },
    share: { en: "I shared. It was hard. I am very proud.", zh: "我分享了。好难。我很骄傲。" },
  },
  calm: {
    idle: { en: "I sat quietly and let the day go by.", zh: "我安安静静地坐着，看着时间过去。" },
    eat: { en: "I ate slowly, one bite at a time.", zh: "我慢慢吃，一口一口。" },
    play: { en: "I wanted a gentle game.", zh: "我想玩一个慢慢的游戏。" },
    sleep: { en: "I settled down and slept deeply.", zh: "我安顿下来，睡得很沉。" },
    explore: { en: "I took a slow walk around.", zh: "我慢慢转了一圈。" },
    sulk: { en: "I sulked, quietly, without a fuss.", zh: "我闹别扭了，安安静静的，不吵不闹。" },
    cuddle: { en: "I came and sat beside you.", zh: "我过来坐在你旁边。" },
    share: { en: "I shared, because that felt right.", zh: "我分享了，因为这样感觉对。" },
  },
  playful: {
    idle: { en: "I bounced on the spot for no reason.", zh: "我原地蹦了蹦，没什么原因。" },
    eat: { en: "I ate, then chased my bowl around.", zh: "我吃完，还追着碗跑。" },
    play: { en: "Play! Play play play!", zh: "玩！玩玩玩！" },
    sleep: { en: "I played until I fell asleep mid-pounce.", zh: "我玩到扑到一半就睡着了。" },
    explore: { en: "I raced off to find something to play with.", zh: "我冲出去找好玩的。" },
    sulk: { en: "I sulked, then forgot and started playing.", zh: "我闹别扭，然后忘了，又玩起来了。" },
    cuddle: { en: "I tumbled over for a cuddle.", zh: "我滚过来要抱抱。" },
    share: { en: "I shared my toy so we could both play!", zh: "我把玩具分给朋友，这样我们能一起玩！" },
  },
  gentle: {
    idle: { en: "I sat softly and listened to the room.", zh: "我轻轻坐着，听房间里的声音。" },
    eat: { en: "I wanted a little something to eat, please.", zh: "我想吃一点点东西，拜托。" },
    play: { en: "I wanted to play, gently.", zh: "我想轻轻地玩一会儿。" },
    sleep: { en: "I curled up small and slept.", zh: "我缩成小小一团睡着了。" },
    explore: { en: "I tiptoed off to look around.", zh: "我踮着脚出去看看。" },
    sulk: { en: "I was a little sad, just for a bit.", zh: "我有一点难过，就一下下。" },
    cuddle: { en: "I came over for a soft cuddle.", zh: "我过来要一个软软的抱抱。" },
    share: { en: "I shared with my friend. It made me happy.", zh: "我和朋友分享了。我好开心。" },
  },
  shy: {
    idle: { en: "I stayed in my corner, where it's safe.", zh: "我待在我的角落，那里很安全。" },
    eat: { en: "I waited until no one was looking, then ate.", zh: "我等没人看的时候才吃。" },
    play: { en: "I wanted to play, if it's just us.", zh: "我想玩，要是只有我们俩的话。" },
    sleep: { en: "I hid under something and slept.", zh: "我躲在东西底下睡着了。" },
    explore: { en: "I peeked around the door, then a bit further.", zh: "我从门边探头看看，又往前走了一点。" },
    sulk: { en: "I hid my face for a while.", zh: "我把脸藏起来好一会儿。" },
    cuddle: { en: "I crept over for a cuddle. Don't tell anyone.", zh: "我悄悄过来要抱抱。别告诉别人。" },
    share: { en: "I shared, very quietly.", zh: "我分享了，很小声地。" },
  },
};

/** D6: a second line for every habit and choice, so a story of several moments is not one sentence repeated. */
export const HABIT_LINES_2: Readonly<Record<Trait, Lines>> = {
  brave: {
    idle: { en: "I stood tall and looked around, just in case.", zh: "我挺直身子四处看看，以防万一。" },
    eat: { en: "I ate like a hero after a long day.", zh: "我像忙了一天的英雄一样大口吃。" },
    play: { en: "I wanted to play something with a bit of danger!", zh: "我想玩点有挑战的！" },
    sleep: { en: "I slept with one ear up.", zh: "我睡觉时竖着一只耳朵。" },
    explore: { en: "I marched off to the far corner first.", zh: "我先大步走到最远的角落。" },
    sulk: { en: "I sulked, but bravely.", zh: "我闹别扭了，不过很勇敢地闹。" },
    cuddle: { en: "I leaned on you. Guarding you, really.", zh: "我靠在你身上。其实是在保护你。" },
    share: { en: "I shared, and stood between my friend and the dark.", zh: "我分享了，还挡在朋友和黑暗中间。" },
  },
  curious: {
    idle: { en: "I counted the spots on the floor.", zh: "我数了数地板上的斑点。" },
    eat: { en: "I sniffed my food from every side first.", zh: "我先从每个方向闻了闻吃的。" },
    play: { en: "I wanted to play a game I had never played!", zh: "我想玩一个从没玩过的游戏！" },
    sleep: { en: "I dreamed about where the wind goes.", zh: "我梦见风会吹到哪里去。" },
    explore: { en: "I went to find out what was behind the door.", zh: "我去看看门后面有什么。" },
    sulk: { en: "I sulked and wondered why I was sulking.", zh: "我闹着别扭，又想知道自己为什么闹别扭。" },
    cuddle: { en: "I came over to ask you something. I forgot what.", zh: "我过来想问你点事。忘了要问什么。" },
    share: { en: "I shared to find out if sharing feels nice. It does.", zh: "我分享了，想知道分享是什么感觉。很好。" },
  },
  greedy: {
    idle: { en: "I sat by my bowl, waiting politely.", zh: "我坐在碗旁边，很有礼貌地等着。" },
    eat: { en: "I ate, then checked for seconds.", zh: "我吃完了，又看看还有没有。" },
    play: { en: "I wanted to play the game where you win a treat.", zh: "我想玩能赢零食的那种游戏。" },
    sleep: { en: "I fell asleep thinking about breakfast.", zh: "我想着早饭睡着了。" },
    explore: { en: "I followed my nose. It led to crumbs.", zh: "我跟着鼻子走，找到了面包屑。" },
    sulk: { en: "I sulked. Nobody gave me a biscuit.", zh: "我闹别扭了。没人给我饼干。" },
    cuddle: { en: "I cuddled up. You smell like snacks.", zh: "我凑过来抱抱。你身上有零食的味道。" },
    share: { en: "I shared half. The smaller half, but still.", zh: "我分了一半。小的那半，不过也算分了。" },
  },
  calm: {
    idle: { en: "I watched the light move across the wall.", zh: "我看着光慢慢移过墙面。" },
    eat: { en: "I ate quietly and enjoyed every bite.", zh: "我安安静静地吃，每一口都很享受。" },
    play: { en: "I wanted to play, nice and slow.", zh: "我想慢悠悠地玩一会儿。" },
    sleep: { en: "I closed my eyes and let the day go.", zh: "我闭上眼睛，让这一天过去。" },
    explore: { en: "I wandered, in no hurry at all.", zh: "我慢慢地转，一点也不急。" },
    sulk: { en: "I was a little cross, then it passed.", zh: "我有点不高兴，然后就过去了。" },
    cuddle: { en: "I rested my head on you for a while.", zh: "我把头靠在你身上歇了一会儿。" },
    share: { en: "I shared, and we sat together a while.", zh: "我分享了，然后我们一起坐了一会儿。" },
  },
  playful: {
    idle: { en: "I chased my own tail for a bit.", zh: "我追了一会儿自己的尾巴。" },
    eat: { en: "I ate in three big happy gulps.", zh: "我开心地三大口吃完了。" },
    play: { en: "Again! I wanted to play again!", zh: "再来！我还想玩！" },
    sleep: { en: "I napped, then woke up ready to play.", zh: "我打了个盹，醒来又想玩了。" },
    explore: { en: "I zoomed off to see who wanted to play.", zh: "我冲出去看看谁想一起玩。" },
    sulk: { en: "I sulked for a moment. Then I bounced.", zh: "我闹了一下下别扭，然后又蹦起来了。" },
    cuddle: { en: "I pounced on you for a cuddle!", zh: "我扑过来要抱抱！" },
    share: { en: "I shared my ball and we played catch!", zh: "我把球分给朋友，我们玩了接球！" },
  },
  gentle: {
    idle: { en: "I hummed a little song to myself.", zh: "我轻轻哼了一首小歌。" },
    eat: { en: "I ate softly and said thank you.", zh: "我轻轻地吃，还说了谢谢。" },
    play: { en: "I wanted to play something kind.", zh: "我想玩一个温柔的游戏。" },
    sleep: { en: "I tucked my paws in and slept.", zh: "我把爪子收好，睡着了。" },
    explore: { en: "I went to say hello to the flowers.", zh: "我去跟花儿打招呼。" },
    sulk: { en: "I felt a bit down, and hugged my tail.", zh: "我有点低落，就抱着自己的尾巴。" },
    cuddle: { en: "I nuzzled in close and stayed.", zh: "我轻轻蹭过来，就待在那儿。" },
    share: { en: "I shared, so my friend wouldn't feel left out.", zh: "我分享了，这样朋友就不会觉得被冷落。" },
  },
  shy: {
    idle: { en: "I peeked out, then tucked back in.", zh: "我探出头看看，又缩了回去。" },
    eat: { en: "I took my food somewhere quiet.", zh: "我把吃的带到安静的地方。" },
    play: { en: "I wanted to play, a little bit.", zh: "我想玩，就一小会儿。" },
    sleep: { en: "I curled up where no one could see.", zh: "我缩在没人看得见的地方睡了。" },
    explore: { en: "I went exploring, keeping close to the wall.", zh: "我贴着墙边去探险。" },
    sulk: { en: "I hid and hoped you'd find me.", zh: "我躲起来，希望你能找到我。" },
    cuddle: { en: "I came close. Very close. Shh.", zh: "我靠近了。很近很近。嘘。" },
    share: { en: "I left something for my friend and ran.", zh: "我给朋友留了点东西就跑开了。" },
  },
};

/** The habit's line for a choice: one of its two, picked by the moment (no randomness). */
export function habitLine(habit: Trait, key: MomentKey, lang: "en" | "zh", moment: number): string {
  return ((moment % 2) + 2) % 2 === 0 ? HABIT_LINES[habit][key][lang] : HABIT_LINES_2[habit][key][lang];
}

/** D6: how each habit rests, for the "what I chose today" strip: the circuit's rest, in the pet's own way. */
export const HABIT_REST: Readonly<Record<Trait, { en: string; zh: string }>> = {
  brave: { en: "keep watch", zh: "站岗" },
  curious: { en: "wonder", zh: "发呆琢磨" },
  greedy: { en: "wait for snacks", zh: "等零食" },
  calm: { en: "quiet time", zh: "静静待着" },
  playful: { en: "bounce about", zh: "蹦蹦跳跳" },
  gentle: { en: "hum softly", zh: "轻轻哼歌" },
  shy: { en: "hide away", zh: "躲起来" },
};

/** How many of each choice, and how many a taught lesson made, among today's decisions (the "what I chose today" strip). */
export interface DayChoices {
  counts: Partial<Record<MomentKey, number>>;
  taught: number;
  total: number;
}
