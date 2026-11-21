/**
 * Quests: small goals about caring, teaching and exploring. Each reads only
 * what already happened (counts in the pet and the world), so progress can
 * never be faked by the quest itself. Rewards are coins and items, never tokens.
 */

import type { WorldState } from "./world";

export interface QuestView {
  world: WorldState;
  counts: { feed: number; play: number; clean: number; pet: number; lessons: number };
  stage: string;
  onChain: boolean;
}

export interface Quest {
  id: string;
  title: { en: string; zh: string };
  goal: { en: string; zh: string };
  need: number;
  progress: (v: QuestView) => number;
  reward: { coins: number; items?: Array<{ item: number; n: number }> };
  after?: string;
  /**
   * The story quest that asks for the very same deed (B6). Such a milestone pays nothing of its own: it is done when
   * that story quest is handed in, so one act is paid for once.
   */
  story?: string;
}

const STAGE_ORDER = ["baby", "child", "teen", "adult", "elder"];
const T = (en: string, zh: string) => ({ en, zh });

export const QUESTS: Quest[] = [
  { id: "hello", title: T("Hello, little one", "你好呀，小家伙"), goal: T("Pet your pet 3 times", "摸摸宠物 3 次"), need: 3, progress: (v) => v.counts.pet, reward: { coins: 10 }, story: "q01" },
  { id: "firstMeal", title: T("First meal", "第一顿饭"), goal: T("Feed your pet", "喂宠物吃一次"), need: 1, progress: (v) => v.counts.feed, reward: { coins: 10, items: [{ item: 11313, n: 1 }] }, story: "q02" },
  { id: "bath", title: T("Squeaky clean", "洗得香喷喷"), goal: T("Give a bath", "洗一次澡"), need: 1, progress: (v) => v.counts.clean, reward: { coins: 10 }, after: "hello", story: "q03" },
  { id: "playtime", title: T("Playtime", "玩耍时间"), goal: T("Play 5 times", "陪它玩 5 次"), need: 5, progress: (v) => v.counts.play, reward: { coins: 20, items: [{ item: 21201, n: 1 }] }, after: "firstMeal" },
  { id: "firstLesson", title: T("First lesson", "第一课"), goal: T("Teach your pet one thing", "教宠物一件事"), need: 1, progress: (v) => v.counts.lessons, reward: { coins: 25, items: [{ item: 11201, n: 2 }] }, after: "hello", story: "q10" },
  { id: "outside", title: T("Out the door", "出门啦"), goal: T("Visit 3 places", "去 3 个地方"), need: 3, progress: (v) => v.world.visited.length, reward: { coins: 15 }, after: "firstMeal" },
  { id: "explorer", title: T("Little explorer", "小小探险家"), goal: T("Visit 10 places", "去 10 个地方"), need: 10, progress: (v) => v.world.visited.length, reward: { coins: 40, items: [{ item: 11409, n: 1 }] }, after: "outside", story: "q29" },
  { id: "wanderer", title: T("Wanderer", "旅行家"), goal: T("Visit 30 places", "去 30 个地方"), need: 30, progress: (v) => v.world.visited.length, reward: { coins: 120, items: [{ item: 21007, n: 1 }] }, after: "explorer" },
  { id: "forager", title: T("Look closely", "仔细找找"), goal: T("Look around 5 times", "四处找找 5 次"), need: 5, progress: (v) => v.world.foragedCount, reward: { coins: 20 }, after: "outside" },
  { id: "maker", title: T("Handmade", "亲手做的"), goal: T("Make something at the workbench", "在工作台做一样东西"), need: 1, progress: (v) => v.world.crafted, reward: { coins: 25, items: [{ item: 1012, n: 2 }] }, after: "forager", story: "q08" },
  { id: "brewer", title: T("Tea time", "下午茶"), goal: T("Make 5 things", "做 5 样东西"), need: 5, progress: (v) => v.world.crafted, reward: { coins: 60 }, after: "maker" },
  { id: "scholar", title: T("Good student", "好学生"), goal: T("Teach 3 lessons", "教 3 课"), need: 3, progress: (v) => v.counts.lessons, reward: { coins: 60, items: [{ item: 11202, n: 1 }] }, after: "firstLesson" },
  { id: "grownUp", title: T("All grown up", "长大啦"), goal: T("Raise your pet to adulthood", "把宠物养到成年"), need: 1, progress: (v) => (STAGE_ORDER.indexOf(v.stage) >= 3 ? 1 : 0), reward: { coins: 150, items: [{ item: 11221, n: 1 }] }, after: "playtime" },
  { id: "chain", title: T("Kept forever", "永远留住"), goal: T("Keep your pet on X Layer", "把宠物放上 X Layer"), need: 1, progress: (v) => (v.onChain ? 1 : 0), reward: { coins: 50 }, after: "firstLesson" },
  { id: "caretaker", title: T("Caretaker", "贴心照料"), goal: T("Feed 20 times", "喂食 20 次"), need: 20, progress: (v) => v.counts.feed, reward: { coins: 80, items: [{ item: 21203, n: 1 }] }, after: "playtime" },
];

export type QuestState = "locked" | "active" | "ready" | "claimed";

export function questState(q: Quest, v: QuestView, claimed: readonly string[]): QuestState {
  if (milestoneDone(q.id, v.world, claimed)) return "claimed";
  if (q.after && !milestoneDone(q.after, v.world, claimed)) return "locked";
  // a milestone the story pays for is never claimed here (B6)
  if (q.story) return "active";
  return q.progress(v) >= q.need ? "ready" : "active";
}

/** A milestone is done once claimed, or, for one that repeats a story quest, once that story quest is handed in. */
function milestoneDone(id: string, w: WorldState, claimed: readonly string[]): boolean {
  if (claimed.includes(id)) return true;
  const story = QUESTS.find((q) => q.id === id)?.story;
  return !!story && w.quests?.done[story] !== undefined;
}

/** Whether a milestone already paid for this story quest's deed (a save from before B6 that claimed it first). */
export const paidByMilestone = (storyId: string, w: WorldState): boolean => QUESTS.some((q) => q.story === storyId && w.claimed.includes(q.id));
