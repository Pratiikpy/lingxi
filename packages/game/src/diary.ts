/**
 * The pet's diary (PRD S1). Every line comes from what really happened: today's
 * logged input words are replayed through the brain the pet had at the time, and
 * the diary reads the care it received and what its circuit decided (naps,
 * wanderings, sulks, cuddles) out of that replay. Nothing is invented; a quiet
 * day gives a short diary.
 */

import type { OutsideInstinct } from "./pet";
import { decodeSenses } from "@lingxi/brain";
import type { Rule } from "@lingxi/brain";
import { ACTION, type Brain, type Pet, WANT } from "./sim";
import { logSegments } from "./lessons";

export type DiaryKey =
  | "fed"
  | "played"
  | "cleaned"
  | "petted"
  | "medicine"
  | "talked"
  | "napped"
  | "wandered"
  | "sulked"
  | "cuddled"
  | "shared"
  | "excited"
  | "learned"
  | "friend"
  | "scared"
  | "quiet";

export interface DiaryLine {
  key: DiaryKey;
  /** how many times, or minutes, or the hour it happened */
  n?: number;
  hour?: number;
  /** what made it sulk: "hungry" | "dirty" | "tired" | "lonely" */
  why?: "hungry" | "dirty" | "tired" | "lonely";
}

const TIME_HOUR = [1, 8, 14, 20]; // night, morning, day, evening → a representative hour for the text

/**
 * Today's diary: the last `beats` logged words (one per minute), replayed from
 * the start of the log so the memory is exactly what it was.
 */
export function diaryOf(pet: Pet, brainFor: (lessons: Rule[], outside?: OutsideInstinct, skills?: number[]) => Brain, beats = 24 * 60): DiaryLine[] {
  return diaryOfStretches(logSegments(pet).map((s) => ({ brain: brainFor(s.lessons, s.outside, s.skills), words: s.words })), beats);
}

/**
 * The same diary from stretches of a log, each with the brain it ran on (for
 * example brains read from the chain, for a pet's public page).
 */
export function diaryOfStretches(segs: ReadonlyArray<{ brain: Brain; words: readonly number[] }>, beats = 24 * 60): DiaryLine[] {
  const total = segs.reduce((n, s) => n + s.words.length, 0);
  const from = Math.max(0, total - beats);
  let mem: Uint8Array | null = null;
  let i = 0;
  const lines: DiaryLine[] = [];
  const count = { fed: 0, played: 0, cleaned: 0, petted: 0, medicine: 0, talked: 0, cuddled: 0, shared: 0, excited: 0, friend: 0, scared: 0 };
  let nap: number | null = null;
  let wander = 0;
  let wanderBest = 0;
  let sulk = 0;
  let sulkBest = 0;
  let sulkWhy: DiaryLine["why"] = undefined;
  for (const seg of segs) {
    const brain = seg.brain;
    if (!mem || mem.length !== brain.nState) mem = new Uint8Array(brain.nState);
    for (const w of seg.words) {
      const out = brain.fast.step(mem, w);
      if (i++ < from) continue;
      const s = decodeSenses(w);
      const want = out & 7;
      const mood = (out >> 3) & 3;
      if (s.action === ACTION.feed) count.fed++;
      if (s.action === ACTION.play) count.played++;
      if (s.action === ACTION.clean) count.cleaned++;
      if (s.action === ACTION.pet) count.petted++;
      if (s.action === ACTION.medicine) count.medicine++;
      if (s.action === ACTION.talk) count.talked++;
      if (s.event === 1) count.friend++;
      if (s.event === 3) count.scared++;
      if (want === WANT.cuddle && s.owner) count.cuddled++;
      if (want === WANT.share) count.shared++;
      if (mood === 3) count.excited++;
      if (want === WANT.sleep && nap === null && s.time !== 0) nap = TIME_HOUR[s.time]!;
      wander = want === WANT.explore ? wander + 1 : 0;
      wanderBest = Math.max(wanderBest, wander);
      if (want === WANT.sulk) {
        sulk++;
        if (sulk > sulkBest) {
          sulkBest = sulk;
          sulkWhy = s.hunger >= 2 ? "hungry" : s.clean <= 0 ? "dirty" : s.energy <= 0 ? "tired" : "lonely";
        }
      } else sulk = 0;
    }
  }
  if (count.fed) lines.push({ key: "fed", n: count.fed });
  if (count.played) lines.push({ key: "played", n: count.played });
  if (count.petted) lines.push({ key: "petted", n: count.petted });
  if (count.cleaned) lines.push({ key: "cleaned" });
  if (count.medicine) lines.push({ key: "medicine" });
  if (count.talked) lines.push({ key: "talked" });
  if (nap !== null) lines.push({ key: "napped", hour: nap });
  if (wanderBest >= 20) lines.push({ key: "wandered", n: wanderBest });
  if (sulkBest >= 15) lines.push({ key: "sulked", n: sulkBest, ...(sulkWhy ? { why: sulkWhy } : {}) });
  if (count.cuddled >= 3) lines.push({ key: "cuddled" });
  if (count.shared) lines.push({ key: "shared" });
  if (count.friend) lines.push({ key: "friend" });
  if (count.scared) lines.push({ key: "scared" });
  if (count.excited >= 10) lines.push({ key: "excited" });
  // the brain changed today if a later segment of the log starts inside today's window
  const learnedToday = segs.some((_, k) => k > 0 && sumBefore(segs, k) >= from);
  if (learnedToday) lines.push({ key: "learned" });
  if (!lines.length) lines.push({ key: "quiet" });
  return lines;
}

function sumBefore(segs: ReadonlyArray<{ words: readonly number[] }>, idx: number): number {
  let n = 0;
  for (let k = 0; k < idx; k++) n += segs[k]!.words.length;
  return n;
}

/** The diary line in the pet's own voice. */
export function diaryText(l: DiaryLine, lang: "en" | "zh"): string {
  const n = l.n ?? 0;
  const why = { hungry: ["my tummy was rumbling", "肚子饿得咕咕叫"], dirty: ["I felt grubby", "身上脏兮兮的"], tired: ["I was so tired", "我太累了"], lonely: ["nobody was around", "身边没人陪"] } as const;
  const en: Record<DiaryKey, string> = {
    fed: n > 1 ? `You fed me ${n} times. Yum.` : "You fed me. Yum.",
    played: n > 1 ? `We played ${n} times!` : "We played together!",
    petted: n > 1 ? `You gave me ${n} pats.` : "You gave me a pat.",
    cleaned: "I had a bath. I sneezed.",
    medicine: "I took my medicine. Bleh, but better.",
    talked: "You taught me something and I listened.",
    napped: `I took a nap around ${l.hour}:00.`,
    wandered: `I wandered off exploring for ${n} minutes.`,
    sulked: `I sulked for ${n} minutes${l.why ? ` because ${why[l.why][0]}` : ""}.`,
    cuddled: "I came over for cuddles.",
    shared: "I shared my things with a friend.",
    excited: "Some moments today were the best ever!",
    learned: "My mind changed today. I know something new.",
    friend: "A friend came by!",
    scared: "Something startled me today.",
    quiet: "A quiet day. I mostly thought about snacks.",
  };
  const zh: Record<DiaryKey, string> = {
    fed: n > 1 ? `你喂了我 ${n} 次，好吃！` : "你喂我吃东西了，好吃！",
    played: n > 1 ? `我们一起玩了 ${n} 次！` : "我们一起玩啦！",
    petted: n > 1 ? `你摸了我 ${n} 次。` : "你摸了摸我。",
    cleaned: "洗了个澡，打了个喷嚏。",
    medicine: "吃了药，好苦，但舒服多了。",
    talked: "你教了我东西，我认真听了。",
    napped: `大概 ${l.hour} 点的时候我睡了一觉。`,
    wandered: `我跑出去探险了 ${n} 分钟。`,
    sulked: `我闹了 ${n} 分钟别扭${l.why ? `，因为${why[l.why][1]}` : ""}。`,
    cuddled: "我跑过来要抱抱。",
    shared: "我把东西分给了朋友。",
    excited: "今天有几个时刻开心得不得了！",
    learned: "今天我的心智变了，学会了新东西。",
    friend: "有朋友来找我玩啦！",
    scared: "今天有东西吓了我一跳。",
    quiet: "安静的一天，我一直在想零食。",
  };
  return (lang === "zh" ? zh : en)[l.key];
}
