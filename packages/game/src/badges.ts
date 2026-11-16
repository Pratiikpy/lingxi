/**
 * Care badges that keep building over every pet you raise (D5). Each badge counts a
 * lifetime total on the player's ledger, not on one pet, so a new egg carries on
 * where the last pet left off. Three tiers each: bronze, silver, gold.
 */

export type Metric =
  | "care"
  | "feed"
  | "play"
  | "clean"
  | "medicine"
  | "petting"
  | "lessons"
  | "stage"
  | "pets"
  | "children"
  | "sparWins"
  | "gifts"
  | "rooms"
  | "chainDays"
  | "kinship"
  | "seasonPlace"
  | "builders"
  | "behemothWins"
  | "laneParty";

export interface Badge {
  id: string;
  metric: Metric;
  tiers: readonly [number, number, number];
  name: { en: string; zh: string };
  /** what to do, with {n} for the next tier's number */
  how: { en: string; zh: string };
}

export const BADGES: readonly Badge[] = [
  { id: "caretaker", metric: "care", tiers: [50, 300, 1000], name: { en: "Caretaker", zh: "细心照料" }, how: { en: "Care for your pets {n} times", zh: "照顾宠物 {n} 次" } },
  { id: "chef", metric: "feed", tiers: [30, 150, 500], name: { en: "Little chef", zh: "小小厨师" }, how: { en: "Feed your pets {n} times", zh: "喂宠物 {n} 次" } },
  { id: "playmate", metric: "play", tiers: [30, 150, 500], name: { en: "Playmate", zh: "玩伴" }, how: { en: "Play with your pets {n} times", zh: "陪宠物玩 {n} 次" } },
  { id: "spotless", metric: "clean", tiers: [20, 100, 300], name: { en: "Spotless", zh: "干干净净" }, how: { en: "Give {n} baths", zh: "洗澡 {n} 次" } },
  { id: "warm", metric: "petting", tiers: [50, 300, 1000], name: { en: "Warm hands", zh: "暖暖的手" }, how: { en: "Pet them {n} times", zh: "摸摸它们 {n} 次" } },
  { id: "healer", metric: "medicine", tiers: [1, 5, 15], name: { en: "Healer", zh: "小医生" }, how: { en: "Nurse a sick pet back {n} times", zh: "治好生病的宠物 {n} 次" } },
  { id: "teacher", metric: "lessons", tiers: [1, 8, 25], name: { en: "Teacher", zh: "好老师" }, how: { en: "Teach {n} lessons", zh: "教会 {n} 课" } },
  { id: "grown", metric: "stage", tiers: [2, 3, 4], name: { en: "Growing up", zh: "长大啦" }, how: { en: "Raise a pet to {n}", zh: "把宠物养到{n}" } },
  { id: "keeper", metric: "pets", tiers: [1, 3, 8], name: { en: "Pet keeper", zh: "宠物之家" }, how: { en: "Raise {n} pets", zh: "养大 {n} 只宠物" } },
  { id: "family", metric: "children", tiers: [1, 3, 6], name: { en: "Family", zh: "一家人" }, how: { en: "Raise {n} little ones", zh: "养育 {n} 只小宝宝" } },
  { id: "spar", metric: "sparWins", tiers: [3, 20, 100], name: { en: "Spar star", zh: "切磋之星" }, how: { en: "Win {n} spars", zh: "赢得 {n} 场切磋" } },
  { id: "giver", metric: "gifts", tiers: [1, 5, 20], name: { en: "Gift giver", zh: "爱送礼" }, how: { en: "Send {n} gifts", zh: "送出 {n} 份礼物" } },
  { id: "explorer", metric: "rooms", tiers: [10, 35, 70], name: { en: "Explorer", zh: "探险家" }, how: { en: "Visit {n} places", zh: "走过 {n} 个地方" } },
  { id: "proven", metric: "chainDays", tiers: [1, 7, 30], name: { en: "On the record", zh: "有据可查" }, how: { en: "Save {n} days on X Layer", zh: "在 X Layer 上保存 {n} 天" } },
  { id: "season", metric: "seasonPlace", tiers: [1, 2, 3], name: { en: "Season star", zh: "赛季之星" }, how: { en: "Finish a weekly season {n}", zh: "在每周赛季里{n}" } },
  { id: "lane", metric: "builders", tiers: [1, 3, 5], name: { en: "Builders' Lane", zh: "建设者小巷" }, how: { en: "Meet {n} of the builders' pets", zh: "见到 {n} 只建设者的宠物" } },
  { id: "behemoth", metric: "behemothWins", tiers: [1, 3, 10], name: { en: "Beat the Behemoth", zh: "战胜巨兽" }, how: { en: "Win {n} spars against Behemoth", zh: "切磋赢过巨兽 {n} 次" } },
  { id: "party", metric: "laneParty", tiers: [1, 2, 3], name: { en: "Hundred days", zh: "百日庆" }, how: { en: "Be on the lane for {n} hundred-day parties", zh: "参加 {n} 次小巷的百日庆" } },
  { id: "bond", metric: "kinship", tiers: [50, 150, 250], name: { en: "Best friends", zh: "最好的朋友" }, how: { en: "Reach {n} kinship with a pet", zh: "和一只宠物的亲密度达到 {n}" } },
];

/** Metrics that keep the best value seen (on any pet) rather than a running total. */
export const BEST_OF: ReadonlySet<Metric> = new Set(["stage", "kinship", "seasonPlace", "builders"]);

export type Ledger = Partial<Record<Metric, number>> & { rooms_seen?: number[] };

/** 0 = not yet, 1 bronze, 2 silver, 3 gold. */
export function tierOf(b: Badge, ledger: Ledger): 0 | 1 | 2 | 3 {
  const v = ledger[b.metric] ?? 0;
  return (b.tiers.filter((t) => v >= t).length as 0 | 1 | 2 | 3);
}

/** Progress to the next tier: the value, the next target (null when gold), and a 0..1 fraction. */
export function progressOf(b: Badge, ledger: Ledger): { value: number; next: number | null; fraction: number } {
  const value = ledger[b.metric] ?? 0;
  const t = tierOf(b, ledger);
  if (t === 3) return { value, next: null, fraction: 1 };
  const from = t === 0 ? 0 : b.tiers[t - 1]!;
  const next = b.tiers[t]!;
  return { value, next, fraction: Math.max(0, Math.min(1, (value - from) / (next - from))) };
}

/** Apply one event to a ledger (a new ledger; the old one is left as it was). */
export function record(ledger: Ledger, metric: Metric, amount = 1): Ledger {
  if (BEST_OF.has(metric)) return (ledger[metric] ?? 0) >= amount ? ledger : { ...ledger, [metric]: amount };
  return { ...ledger, [metric]: (ledger[metric] ?? 0) + amount };
}

/** A room counts once, however often it is visited. */
export function visitRoom(ledger: Ledger, room: number): Ledger {
  const seen = ledger.rooms_seen ?? [];
  if (seen.includes(room)) return ledger;
  return { ...ledger, rooms_seen: [...seen, room], rooms: seen.length + 1 };
}

/** Badges whose tier went up between two ledgers. */
export function newTiers(before: Ledger, after: Ledger): Array<{ badge: Badge; tier: 1 | 2 | 3 }> {
  return BADGES.flatMap((b) => {
    const a = tierOf(b, before);
    const z = tierOf(b, after);
    return z > a ? [{ badge: b, tier: z as 1 | 2 | 3 }] : [];
  });
}
