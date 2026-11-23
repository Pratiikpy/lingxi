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
/** D13: the gate budget over every set of school lessons, per line (see the simulator's budgetChoice). */
export type BudgetChoice = Record<string, { teenSets: number; teenNoMind: number; teenFiveMind: number; adultSets: number; adultNoMind: number; adultFiveMind: number; elderAllEight: number; elderBudget: number }>;

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
  /** G4: the fewest things left to do at the end of any day (open story quests and dailies, commissions and garden plots the pet is old enough for) */
  fewestThingsLeft?: number;
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
  kind: "single" | "starter" | "guard" | "dodge" | "pounce" | "reader" | "partner" | "taught";
  winRate: number;
}

export interface FieldNumbers {
  brains: FieldBrain[];
  seeds: number;
  /** the best brain of one rule: a single lesson on a starter, or a brain that only ever makes one move */
  bestSingle: { id: string; winRate: number };
  /** the brain of one rule with the weakest answer: the field brain that beats it most, and how often */
  leastAnswered: { id: string; by: string; winRate: number };
  /** brains of one rule that beat the fight-reading brain head to head */
  beatReader: string[];
  /** D20: against the opponents players actually meet (the sparring partners and taught pets), the reader's win rate and the best brain of one rule */
  realOpponents: { reader: number; bestSingle: { id: string; winRate: number } };
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
  /** what brings it about (lightBulb.ts): the game stages an event, asks for a care, or it waits for a moment */
  trigger: "event" | "care" | "watched" | "moment";
  /** for a care lesson: how many times the watching player gave the care */
  cares?: number;
  /** for a moment lesson: whether the taught brain, in the lesson's moment, picks the lesson */
  inMoment?: boolean;
}

export interface SimNumbers {
  seed: number;
  days: number;
  players: Record<PlayerType, PlayerNumbers>;
  /** B8: the tapper down each tapping path (pats and words, three-star play, baths, meals) */
  tapPaths?: Record<string, { level99Day: number | null; day30Level: number | null }>;
  field: FieldNumbers;
  lessons: LessonSeen[];
  /** coins to buy every permanent thing sold for coins: decorations, the Builder's commissions, outfit pieces, tools and the garden's extra plots */
  costOfEverything: number;
  /** G6: recipes and trust branches strictly worse than their alternative (worthFindings in @lingxi/world) */
  worth?: string[];
  /**
   * G5: a pet of each line hatched and left alone, as the game's own catch-up lives it: its lowest need at 72 hours, and
   * the hours until it first falls ill (null if not within ten days)
   */
  alone?: Array<{ line: string; lowestAt72h: number; firstSickHours: number | null }>;
  /** D1: a pet only ever patted (every 93.6 hours, never fed or cleaned): its stage on day 62, whether it fell ill, its mistakes */
  patOnly?: { stageDay62: string; ill: boolean; mistakes: number };
  /** D3: for each line, whether a teen with one point of Wide Mind (a Mind-first player) is still refused a fourth school lesson */
  /** D13: per line, the school-lesson sets that fill a teen's and an adult's slots that fit (cheapest order), and the elder's eight */
  budgetChoice?: BudgetChoice;
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
const seen = (l: LessonSeen) =>
  l.trigger === "moment" ? l.inMoment === true : l.firstFire !== null && l.firstFire <= SEEN_WITHIN && l.fires >= (l.trigger === "care" ? (l.cares ?? SEEN_IN_TEN) : SEEN_IN_TEN);
/** Every tapping path measured, or the pats-and-words tapper alone in a record from before B8. */
const tapPathsOf = (n: SimNumbers): Array<[string, { level99Day: number | null; day30Level: number | null }]> =>
  n.tapPaths ? Object.entries(n.tapPaths) : [["petTalk", { level99Day: n.players.tapper.level99Day, day30Level: day(n.players.tapper, 30)?.level ?? null }]];
const day = (p: PlayerNumbers, d: number) => p.days[Math.min(d, p.days.length) - 1];

export const BALANCE_TARGETS: readonly BalanceTarget[] = [
  {
    id: "lessons-seen",
    what: "A taught lesson changes what the pet does while you watch",
    // B4 restated this from "every lesson decides within a minute and 3 times in ten, at every hour": a lesson that waits
    // on the time of day or a need cannot fire at once at every hour (an afternoon nap taught at 8 in the morning)
    // without staging the clock or the meters, which no proof would replay; those are measured in their moment instead.
    target: `every school lesson, on every egg line and at every visit hour sampled: one that answers an event (staged by the game right after teaching), the owner, or a care (the player asked to give it) decides within ${SEEN_WITHIN} minute of being taught and at least ${SEEN_IN_TEN} times in ten minutes (a care lesson each time the care is given); one that waits on the time of day or a need decides when that moment comes`,
    owner: "G1",
    value: (n) => {
      const ids = lessonIds(n);
      const ok = ids.filter((id) => n.lessons.filter((l) => l.id === id).every(seen));
      const rare = ids.filter((id) => {
        const ls = n.lessons.filter((l) => l.id === id);
        return ls.reduce((s, l) => s + l.fires, 0) / Math.max(1, ls.reduce((s, l) => s + l.beats, 0)) < 0.05;
      });
      const moments = ids.filter((id) => n.lessons.find((l) => l.id === id)?.trigger === "moment");
      return `${ok.length} of ${ids.length} lessons seen everywhere; ${rare.filter((id) => !moments.includes(id)).length} of ${ids.length - moments.length} brought about at once decide under 5% of watched minutes (${rare.filter((id) => !moments.includes(id)).join(", ") || "none"}); ${moments.length} wait for their moment (${moments.join(", ")})`;
    },
    met: (n) => n.lessons.length > 0 && n.lessons.every(seen),
  },
  {
    id: "spar-best-single",
    what: "No brain of one lesson or one move dominates the spar field",
    // G2 restated this from "the best brain of one rule wins at most 60% against the field": 48 of the field's 65
    // brains are untaught or care-taught pets that never attack, so any brain that attacks at all beats them, and no
    // setting of the fight's numbers brought the best below 75% (600 settings searched, BUILD-STATUS section 259).
    // Beating beginners is not dominating; having no answer is.
    // D20 (Prateek left the choice to the product, 2026-11-23): the plan's 60% is restated as below. Against the
    // opponents players actually meet a tap-only brain stayed near 61% at any tap damage, so 60% would have meant a
    // useless tap; what matters is that no lazy brain beats reading the fight there, and that every one has an answer.
    target: "every brain of one rule (one lesson on a starter, or one move every round) has an answer in the field that beats it in at least 55% of their spars, and none beats the fight-reading brain; and against the opponents players actually meet (the sparring partners and taught pets) no brain of one rule wins more than the fight-reading brain",
    owner: "G2",
    value: (n) =>
      `least answered: ${n.field.leastAnswered.id}, beaten ${pct(n.field.leastAnswered.winRate)} by ${n.field.leastAnswered.by}; ${n.field.beatReader.length ? `${n.field.beatReader.join(", ")} beat the reader` : "none beats the reader"}; best ${n.field.bestSingle.id} wins ${pct(n.field.bestSingle.winRate)} of the field; against real opponents the reader ${pct(n.field.realOpponents.reader)}, best one-rule ${n.field.realOpponents.bestSingle.id} ${pct(n.field.realOpponents.bestSingle.winRate)}`,
    met: (n) => n.field.leastAnswered.winRate >= 0.55 && n.field.beatReader.length === 0 && n.field.realOpponents.bestSingle.winRate < n.field.realOpponents.reader,
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
    // B8: a tapper down every tapping path (pats and words, three-star play, baths, meals), so the fastest decides
    target: "a tapper, down whichever tapping path is fastest (pats and words, three-star play, baths or meals), never reaches level 99 in 90 days, and on day 30 stands no more than a quarter above the three-visit player",
    owner: "G3",
    value: (n) => {
      const c = n.players.three;
      const paths = tapPathsOf(n);
      return `${paths.map(([k, p]) => `${k}: level 99 ${p.level99Day === null ? "never" : `day ${p.level99Day}`}, day 30 level ${p.day30Level ?? "-"}`).join("; ")}; three visits day 30 level ${day(c, 30)?.level ?? "-"}`;
    },
    met: (n) => {
      const cap = Math.ceil(1.25 * (day(n.players.three, 30)?.level ?? 0));
      return tapPathsOf(n).every(([, p]) => p.level99Day === null && (p.day30Level ?? 0) <= cap);
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
    value: (n) => types(n).map((p) => `${p.type} ${p.maxDailyCoinsIn}${p.days?.length ? ` (day ${p.days.findIndex((r) => r.coinsIn === p.maxDailyCoinsIn) + 1})` : ""}`).join(", "),
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
    id: "recipes-worth",
    what: "No recipe or trust branch is strictly worse than its alternative",
    target: "no everyday recipe is beaten in every input by another, none costs more in bought inputs than the shop price of what it makes, and no friend's recipe branch needs a rare find or costs more than that friend's shelf",
    owner: "G6",
    value: (n) => (n.worth === undefined ? "not measured" : n.worth.length ? n.worth.join("; ") : "none strictly worse"),
    met: (n) => n.worth !== undefined && n.worth.length === 0,
  },
  {
    id: "neglect-costs",
    what: "Neglect is never rewarded",
    target: "a pet only ever patted, once every 93.6 hours, never fed or cleaned, falls ill, makes care mistakes and is not an elder on day 62",
    owner: "G5",
    value: (n) => (n.patOnly ? `${n.patOnly.stageDay62} on day 62, ${n.patOnly.ill ? "fell ill" : "never ill"}, ${n.patOnly.mistakes} mistakes` : "not measured"),
    met: (n) => !!n.patOnly && n.patOnly.ill && n.patOnly.mistakes > 0 && n.patOnly.stageDay62 !== "elder",
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
    id: "first-absence-floor",
    what: "A first long absence leaves every need at its floor or above",
    target: "a pet of every line, cared for once and left 72 hours, has every need at its floor (240 of 1,000, just inside the lowest band the brain reads) or above",
    owner: "G5",
    value: (n) => (n.alone ?? []).map((a) => `${a.line} ${a.lowestAt72h}`).join(", ") || "not measured",
    met: (n) => !!n.alone?.length && n.alone.every((a) => a.lowestAt72h >= 240),
  },
  {
    id: "sick-only-after-days",
    what: "A pet falls ill only after days of neglect",
    target: "a pet of every line, cared for once and left alone, first falls ill no sooner than 96 hours later",
    owner: "G5",
    value: (n) => (n.alone ?? []).map((a) => `${a.line} ${a.firstSickHours === null ? "not in 10 days" : `${a.firstSickHours} h`}`).join(", ") || "not measured",
    met: (n) => !!n.alone?.length && n.alone.every((a) => a.firstSickHours === null || a.firstSickHours >= 96),
  },
  {
    id: "new-every-day",
    what: "Something new or changing every day through day 90",
    target: "for every player type, every day from 1 to 90 that the player opens the game brings at least one new or changing thing it actually meets (plan 38 section 2; D16: the village happening counts only once used), and something left that can be done that day (open story quests and dailies, today's village happening, a commission or plot the pet is old enough for and the player can pay for)",
    owner: "G4",
    value: (n) => types(n).map((p) => `${p.type} ${p.daysWithNothingNew} days with nothing new, at least ${p.fewestThingsLeft ?? "?"} left`).join(", "),
    met: (n) => types(n).every((p) => p.daysWithNothingNew === 0 && (p.fewestThingsLeft ?? 0) > 0),
  },
  {
    id: "gate-budget-binds",
    what: "The gate budget is a choice the player meets by the teen stage",
    target: "the three-visit player has a lesson refused for the gate budget by the end of the teen stage (day 7); and over every set of school lessons in its cheapest order, on every line: with no Mind points at most half the sets that fill a teen's slots and at most half that fill an adult's fit, and an elder cannot hold all eight; five points of Wide Mind let every teen set fit (the skill's visible effect)",
    owner: "G7",
    value: (n) => {
      const p = n.players.three;
      const bc = n.budgetChoice
        ? Object.entries(n.budgetChoice)
            .map(([l, b]) => `${l}: teen ${b.teenNoMind}/${b.teenSets} (5 points ${b.teenFiveMind}), adult ${b.adultNoMind}/${b.adultSets}, all eight ${b.elderAllEight} of ${b.elderBudget}`)
            .join("; ")
        : "not measured";
      return `first refusal ${p.firstTooBigDay === null ? "never" : `day ${p.firstTooBigDay}`}; at most ${pct(p.teenGateShare)} of the budget used by day 7; sets that fit with no Mind points: ${bc}`;
    },
    met: (n) =>
      n.players.three.firstTooBigDay !== null &&
      n.players.three.firstTooBigDay <= 7 &&
      !!n.budgetChoice &&
      Object.values(n.budgetChoice).every((b) => b.teenNoMind * 2 <= b.teenSets && b.adultNoMind * 2 <= b.adultSets && b.elderAllEight > b.elderBudget && b.teenFiveMind === b.teenSets),
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

/**
 * D21: the targets whose recorded value no longer matches what the simulator measures (a status that regressed is
 * reported on its own); any of these makes the simulator's check fail, so the record cannot drift from the game.
 */
export function staleTargets(now: ReadonlyArray<{ id: string; value: string; met: boolean }>, recorded: Readonly<Record<string, { value: string; status: "met" | "open" }>>): string[] {
  return now.filter((t) => recorded[t.id] && recorded[t.id]!.value !== t.value && !(recorded[t.id]!.status === "met" && !t.met)).map((t) => t.id);
}
