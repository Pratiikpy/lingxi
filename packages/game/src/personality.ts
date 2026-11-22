/**
 * Personality every day (G9): a pet's habits colour what it says about its choices. The choice is always the
 * circuit's; the words are chosen by the pet's strongest habit, so a shy pet and a greedy one say the same choice in
 * their own way. No new randomness: the same pet with the same traits says the same line for the same choice.
 */

import { HABIT } from "./visitors";
import { TRAITS, type Trait } from "./pet";
import type { MomentKey } from "./replay";

type Lines = Readonly<Record<MomentKey, { en: string; zh: string }>>;

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
  return TRAITS.filter((t) => (traits[t] ?? 0) >= HABIT).sort((a, b) => traits[b]! - traits[a]! || TRAITS.indexOf(a) - TRAITS.indexOf(b));
}

export const HABIT_LINES: Readonly<Record<Trait, Lines>> = {
  brave: {
    idle: { en: "I kept watch over the room for a while.", zh: "我守着房间看了一会儿。" },
    eat: { en: "I marched straight to my bowl.", zh: "我大步走到碗前面。" },
    play: { en: "I wanted a game, the rougher the better!", zh: "我想玩，越热闹越好！" },
    sleep: { en: "I slept where I could guard the door.", zh: "我睡在能守住门口的地方。" },
    explore: { en: "I went to see what was out there. Nothing scared me.", zh: "我出去看看外面有什么。什么都吓不到我。" },
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

/** How many of each choice, and how many a taught lesson made, among today's decisions (the "what I chose today" strip). */
export interface DayChoices {
  counts: Partial<Record<MomentKey, number>>;
  taught: number;
  total: number;
}
