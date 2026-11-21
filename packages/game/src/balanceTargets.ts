/**
 * The balance targets of the game-design plan (38-PLAN-GAME-DESIGN.md section 2, row G0), as data a machine can
 * check. Each target names what it is about in plain words, the predicate over the 90-day simulator's numbers
 * (packages/game/scripts/sim90.ts) that says whether it holds, and the plan row that owns making it true.
 *
 * Whether a target is met is never written by hand: `sim90.ts --write` runs every predicate on a fresh simulation and
 * records the value it measured and the verdict in balanceMeasured.generated.ts. `sim90.ts --check` and
 * test/balance.test.ts run the simulation again and fail if a target recorded as met no longer holds, so no later
 * change can quietly undo a balance a row has reached. Open targets are printed, never failed: G0 measures, the
 * later rows tune.
 *
 * Thresholds the plan left open ("bounded", "something worth saving for") are fixed here, each stated with its
 * target, so the row that owns it can argue with a number rather than a word.
 */

import { BALANCE_MEASURED } from "./balanceMeasured.generated";

export { BALANCE_MEASURED } from "./balanceMeasured.generated";

/* ── what the simulator measures ─────────────────────────────────────────── */

export const PLAYER_TYPES = ["once", "three", "weekend", "tapper", "grinder"] as const;
export type PlayerType = (typeof PLAYER_TYPES)[number];

/** One player's pet and world at the end of one local day. */
export interface PlayerDay {
  day: number;
  stage: string;
  level: number;
  /** XP earned that day (before any of it was spent on levels) */
  xp: number;
  coinsIn: number;
  coinsOut: number;
  coins: number;
  /** care mistakes the game's own care-miss logic recorded that day */
  mistakes: number;
  /** ill at the end of the day */
  sick: boolean;
  /** story quests open to take, taken or ready to hand in */
  questsOpen: number;
  /** today's dailies not yet done */
  dailiesOpen: number;
  /** workbench recipes the bag and tools allow right now */
  recipesReachable: number;
  /** rooms never entered */
  roomsUnseen: number;
  /** things first seen today: a quest opening, a recipe first in reach, a first find, a new room, a stage, a lesson slot, a skill tier, a form */
  newThings: number;
  /** minutes the owner watched (live beats with the game open) */
  watched: number;
  /** of those, minutes a taught lesson decided what the pet did */
  lessonFires: number;
  lessons: number;
  gates: number;
  gateBudget: number;
  spars: number;
  sparWins: number;
}

export interface PlayerNumbers {
  type: PlayerType;
  days: PlayerDay[];
  /** the first day the pet reached level 99, or null */
  level99Day: number | null;
  mistakes: number;
  /** returns after a weekend away that found the pet ill */
  sickAfterWeekend: number;
  weekends: number;
  maxDailyCoinsIn: number;
  /** the first day the player's coins could buy every permanent thing sold for coins, or null */
  allAffordableDay: number | null;
  /** days 1 to 90 on which nothing at all was new */
  daysWithNothingNew: number;
  lessonFiresPerWatchedMinute: number;
  /** each school lesson taught: minutes watched since and minutes it decided */
  byLesson: Record<string, { watched: number; fired: number }>;
  /** the first day a lesson was refused for the gate budget, or null */
  firstTooBigDay: number | null;
  /** the largest share of the gate budget used up to the end of the teen stage */
  teenGateShare: number;
}

/** One brain in the spar field and its record against every other brain. */
export interface FieldBrain {
  id: string;
  kind: "single" | "starter" | "guard" | "dodge" | "pounce" | "reader" | "partner";
  winRate: number;
}

export interface FieldNumbers {
  brains: FieldBrain[];
  seeds: number;
  /** the best brain of one rule: a single lesson on a starter, or a brain that only ever makes one move */
  bestSingle: { id: string; winRate: number };
  /** the best brain in the field other than the fight-reading one */
  bestOther: { id: string; winRate: number };
  reader: number;
  guardVsPounce: number;
  dodgeVsPounce: number;
  guardVsField: number;
  dodgeVsField: number;
}

/** One taught school lesson, watched for ten minutes from the moment it was taught. */
export interface LessonSeen {
  id: string;
  line: string;
  hour: number;
  /** the minute (0 = the teaching beat itself) it first decided, or null if it never did */
  firstFire: number | null;
  fires: number;
  beats: number;
}

export interface SimNumbers {
  seed: number;
  days: number;
  players: Record<PlayerType, PlayerNumbers>;
  field: FieldNumbers;
  lessons: LessonSeen[];
  /** coins to buy every permanent thing sold for coins: decorations, outfit pieces and tools */
  costOfEverything: number;
}

/* ── the targets ─────────────────────────────────────────────────────────── */

export interface BalanceTarget {
  id: string;
  /** plain words: what the target is about */
  what: string;
  /** plain words: the predicate below */
  target: string;
  /** the plan row that owns making it true */
  owner: "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7";
  /** what the simulator measured, in a line */
  value: (n: SimNumbers) => string;
  met: (n: SimNumbers) => boolean;
}

/** The most coins any player type may earn in one day (G6's "income bounded per day"). */
export const DAILY_COIN_CAP = 150;
/** A taught lesson is "seen" when it decides within this minute and at least this often in a ten-minute visit. */
export const SEEN_WITHIN = 1;
export const SEEN_IN_TEN = 3;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const types = (n: SimNumbers) => PLAYER_TYPES.map((t) => n.players[t]);
const lessonIds = (n: SimNumbers) => [...new Set(n.lessons.map((l) => l.id))];
const seen = (l: LessonSeen) => l.firstFire !== null && l.firstFire <= SEEN_WITHIN && l.fires >= SEEN_IN_TEN;
const day = (p: PlayerNumbers, d: number) => p.days[Math.min(d, p.days.length) - 1];

export const BALANCE_TARGETS: readonly BalanceTarget[] = [
  {
    id: "lessons-seen",
    what: "A taught lesson changes what the pet does while you watch",
    target: `every school lesson, on every egg line and at every visit hour sampled, decides within ${SEEN_WITHIN} minute of being taught and at least ${SEEN_IN_TEN} times in ten minutes`,
    owner: "G1",
    value: (n) => {
      const ids = lessonIds(n);
      const ok = ids.filter((id) => n.lessons.filter((l) => l.id === id).every(seen));
      const rare = ids.filter((id) => {
        const ls = n.lessons.filter((l) => l.id === id);
        return ls.reduce((s, l) => s + l.fires, 0) / Math.max(1, ls.reduce((s, l) => s + l.beats, 0)) < 0.05;
      });
      return `${ok.length} of ${ids.length} lessons seen everywhere; ${rare.length} of ${ids.length} decide under 5% of watched minutes (${rare.join(", ") || "none"})`;
    },
    met: (n) => n.lessons.length > 0 && n.lessons.every(seen),
  },
  {
    id: "spar-best-single",
    what: "No brain of one lesson or one move dominates the spar field",
    target: "the best brain of one rule (one lesson on a starter, or one move every round) wins at most 60% of its spars against the field",
    owner: "G2",
    value: (n) => `${n.field.bestSingle.id} wins ${pct(n.field.bestSingle.winRate)}`,
    met: (n) => n.field.bestSingle.winRate <= 0.6,
  },
  {
    id: "spar-reading-pays",
    what: "A brain that reads the fight beats one that does not",
    target: "the fight-reading brain wins more of its spars against the field than every other brain in it",
    owner: "G2",
    value: (n) => `reader ${pct(n.field.reader)}; best other ${n.field.bestOther.id} ${pct(n.field.bestOther.winRate)}`,
    met: (n) => n.field.reader > n.field.bestOther.winRate,
  },
  {
    id: "spar-guard-answers",
    what: "Guarding is a real answer to something",
    target: "a guard-only brain wins 40% to 60% against a pounce-only brain, what guarding is meant to counter",
    owner: "G2",
    value: (n) => `guard-only ${pct(n.field.guardVsPounce)} against pounce-only, ${pct(n.field.guardVsField)} against the field`,
    met: (n) => n.field.guardVsPounce >= 0.4 && n.field.guardVsPounce <= 0.6,
  },
  {
    id: "spar-dodge-answers",
    what: "Dodging is a real answer to something",
    target: "a dodge-only brain wins 40% to 60% against a pounce-only brain",
    owner: "G2",
    value: (n) => `dodge-only ${pct(n.field.dodgeVsPounce)} against pounce-only, ${pct(n.field.dodgeVsField)} against the field`,
    met: (n) => n.field.dodgeVsPounce >= 0.4 && n.field.dodgeVsPounce <= 0.6,
  },
  {
    id: "level-not-by-tapping",
    what: "Level 99 is paced by days of real care, not by tapping",
    target: "the tapper never reaches level 99 in 90 days, and on day 30 stands no more than a quarter above the three-visit player",
    owner: "G3",
    value: (n) => {
      const t = n.players.tapper;
      const c = n.players.three;
      return `tapper level 99 on ${t.level99Day === null ? "no day" : `day ${t.level99Day}`}; day 30: tapper ${day(t, 30)?.level ?? "-"}, three visits ${day(c, 30)?.level ?? "-"}`;
    },
    met: (n) => {
      const t = n.players.tapper;
      const c = n.players.three;
      return t.level99Day === null && (day(t, 30)?.level ?? 0) <= Math.ceil(1.25 * (day(c, 30)?.level ?? 0));
    },
  },
  {
    id: "trees-by-90",
    what: "Skill points worth choosing: one tree finished and a second begun by day 90, never every tree full",
    target: "the three-visit player reaches level 64 (63 points: one tree of 62 and a first point in another) by day 90, and level 64 not before day 50",
    owner: "G3",
    value: (n) => {
      const c = n.players.three;
      const reached = c.days.find((d) => d.level >= 64)?.day ?? null;
      return `three visits: level ${day(c, 90)?.level ?? "-"} on day 90, level 64 on ${reached === null ? "no day" : `day ${reached}`}`;
    },
    met: (n) => {
      const reached = n.players.three.days.find((d) => d.level >= 64)?.day ?? null;
      return reached !== null && reached >= 50 && reached <= 90;
    },
  },
  {
    id: "coins-bounded",
    what: "Coin income is bounded per day",
    target: `no player type earns more than ${DAILY_COIN_CAP} coins in a day`,
    owner: "G6",
    value: (n) => types(n).map((p) => `${p.type} ${p.maxDailyCoinsIn}`).join(", "),
    met: (n) => types(n).every((p) => p.maxDailyCoinsIn <= DAILY_COIN_CAP),
  },
  {
    id: "coins-worth-saving",
    what: "Something is worth saving for at every stage through day 90",
    target: "no player type holds enough coins to buy every permanent thing sold for coins before day 90",
    owner: "G6",
    value: (n) => `everything costs ${n.costOfEverything}; ` + types(n).map((p) => `${p.type} ${p.allAffordableDay === null ? "never" : `day ${p.allAffordableDay}`}`).join(", "),
    met: (n) => types(n).every((p) => p.allAffordableDay === null),
  },
  {
    id: "once-a-day-safe",
    what: "One visit a day is always safe",
    target: "the once-a-day player makes no care mistake in 90 days",
    owner: "G5",
    value: (n) => `${n.players.once.mistakes} care mistakes in ${n.days} days`,
    met: (n) => n.players.once.mistakes === 0,
  },
  {
    id: "weekend-not-sick",
    what: "A weekend away never ends in a sick pet",
    target: "the weekend-away player never comes back on Monday to an ill pet",
    owner: "G5",
    value: (n) => `${n.players.weekend.sickAfterWeekend} of ${n.players.weekend.weekends} weekends end with the pet ill; ${n.players.weekend.mistakes} care mistakes`,
    met: (n) => n.players.weekend.weekends > 0 && n.players.weekend.sickAfterWeekend === 0,
  },
  {
    id: "new-every-day",
    what: "Something new or changing every day through day 90",
    target: "for every player type, every day from 1 to 90 brings at least one new thing",
    owner: "G4",
    value: (n) => types(n).map((p) => `${p.type} ${p.daysWithNothingNew} empty days`).join(", "),
    met: (n) => types(n).every((p) => p.daysWithNothingNew === 0),
  },
  {
    id: "gate-budget-binds",
    what: "The gate budget is a choice the player meets by the teen stage",
    target: "the three-visit player has a lesson refused for the gate budget by the end of the teen stage (day 7)",
    owner: "G7",
    value: (n) => {
      const p = n.players.three;
      return `first refusal ${p.firstTooBigDay === null ? "never" : `day ${p.firstTooBigDay}`}; at most ${pct(p.teenGateShare)} of the budget used by day 7`;
    },
    met: (n) => n.players.three.firstTooBigDay !== null && n.players.three.firstTooBigDay <= 7,
  },
];

/** Every target judged on these numbers: what was measured and whether the predicate holds. */
export function evaluateTargets(n: SimNumbers): Array<{ id: string; value: string; met: boolean }> {
  return BALANCE_TARGETS.map((t) => ({ id: t.id, value: t.value(n), met: t.met(n) }));
}

export type BalanceStatus = "met" | "open";

/** The targets with what the last `sim90.ts --write` measured: its value and its verdict. */
export const balanceTargets = (): Array<BalanceTarget & { measured: string; status: BalanceStatus }> =>
  BALANCE_TARGETS.map((t) => {
    const m = BALANCE_MEASURED.targets[t.id];
    return { ...t, measured: m?.value ?? "not measured yet", status: m?.status ?? "open" };
  });
