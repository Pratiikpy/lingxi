/**
 * The condition engine (plan 4.1): one record shape for every requirement, objective and gate in the game, after
 * the source's `LibConditional` (note A §1.1): `{type, logic, index, value}`, where logic is HANDLER_OPERATOR.
 *
 *   CURR_MIN / CURR_MAX / CURR_EQUAL   the value now, compared with `value`
 *   INC_MIN / INC_MAX / INC_EQUAL      how much it rose since the quest was accepted (a snapshot)
 *   BOOL_IS / BOOL_NOT                 a yes/no fact, or its opposite
 *
 * A list passes when every condition passes; an empty list passes (as the source). Every type is declared once in
 * TYPES with its kind and what its index names, so a sheet is checked before it can ship (the source's loader only
 * logged a bad row and carried on, note A §2.8). Two deliberate differences from the source: INC reads the same
 * value CURR reads, so it works on every count (theirs only on generic counters, §2.4), and an INC objective whose
 * snapshot is missing never passes (theirs reads a missing snapshot as 0 and completes at once).
 */

import { TRUST_POINTS, trustLevelOf } from "./rules";
import { CHARACTERS } from "./characters";
import { tallyOf } from "./tally";
import { ITEM, ROOMS, type WorldState } from "./world";

export type Handler = "CURR" | "INC" | "BOOL";
export type Operator = "MIN" | "MAX" | "EQUAL" | "IS" | "NOT";
export type Logic = "CURR_MIN" | "CURR_MAX" | "CURR_EQUAL" | "INC_MIN" | "INC_MAX" | "INC_EQUAL" | "BOOL_IS" | "BOOL_NOT";
export const LOGICS: readonly Logic[] = ["CURR_MIN", "CURR_MAX", "CURR_EQUAL", "INC_MIN", "INC_MAX", "INC_EQUAL", "BOOL_IS", "BOOL_NOT"];

export interface Condition {
  type: ConditionType;
  logic: Logic;
  /** what is measured within the type: an item or room number, a resident, a quest id, an action word */
  index?: number | string;
  /** the threshold (counts), or a number the yes/no fact needs (QUEST_DELAY: seconds) */
  value?: number;
  /** ANY only: passes when one of these passes (a solo path beside a path that needs another player) */
  of?: readonly Condition[];
}

/** Everything a condition may read, gathered by the game from the world, the active pet and the ledgers. */
export interface ConditionView {
  world: WorldState;
  /** the active pet; null before the first egg hatches */
  pet: { level: number; stage: StageName; onChain: boolean; needsMin: number } | null;
  /** pets this player has raised, every one counted once */
  pets: number;
  now: number;
  /** 0 night, 1 morning, 2 day, 3 evening: the brain's own `timeOfDay` of the pet's local hour */
  timeOfDay: 0 | 1 | 2 | 3;
  /** the player's local calendar day, "YYYY-MM-DD" */
  day: string;
  /** the highest friendship level the active pet has with any friend's pet */
  bondLevel: number;
  /** community goals that are complete (package 4.10) */
  goalsDone: readonly string[];
}

export type StageName = "baby" | "child" | "teen" | "adult" | "elder";
export const STAGE_ORDER: readonly StageName[] = ["baby", "child", "teen", "adult", "elder"];
export const TIMES_OF_DAY = ["night", "morning", "day", "evening"] as const;

/** What an index names; "any" counters accept no index (the total) or one of that kind. */
type IndexKind = "none" | "item" | "room" | "resident" | "quest" | "giveTo" | "time" | "word" | "event" | "lane" | "counter";

interface TypeSpec {
  kind: "count" | "bool";
  index: IndexKind;
  /** the index may be left out (reads the total) */
  optional?: boolean;
  read: (v: ConditionView, index: number | string | undefined, value: number | undefined) => number | boolean;
  /** the closest type in the source, when there is one (note A §8.3) */
  source?: string;
}

const t = (type: string) => (v: ConditionView, index: number | string | undefined) => tallyOf(v.world, type, index ?? 0);

/**
 * One-off things the game reports by name (EVENT:<name>), checked against this list so a sheet cannot ask for
 * an event nothing ever sends. Each is sent from one place in the web app, named beside it.
 */
export const EVENTS = [
  "visited-by-friend", // a friend's pet came to your home (live rooms)
  "replay-watched", // a spar replay watched to its end
  "run-finished", // an arena run ended, won or lost
  "spar-peer", // a spar with a friend's pet or a Builders' Lane pet
  "comforted", // the pet patted within ten minutes of losing a spar
  "circuit-opened", // the circuit view opened
  "diary-read", // the diary opened
  "proof-checked", // a saved day replayed on the proof page
  "visitor-met", // a visiting pet met in the room
  "pet-sat", // a friend's pet looked after
  "lane-count", // Behemoth seen counting all the way to 13
  "lane-checked", // a Behemoth step checked against BNB Chain
  "child-born", // a little one welcomed
  "adopted", // a pet adopted from the adoption centre (store.ts welcome)
] as const;
const EVENT_SET = new Set<string>(EVENTS);

/** The Builders' Lane residents (their ids in the game package). */
export const LANE = ["behemoth", "mars", "tapboy", "builder", "diver"] as const;
const LANE_SET = new Set<string>(LANE);

/** Trust with a resident climbs through six levels (0 to 5) and never decays (plan 4.3). */
/** Trust levels begin at these points; the level itself is read from the trust circuit (rules.ts). */
export const TRUST_LEVELS = TRUST_POINTS;
export const trustLevel = (points: number): number => trustLevelOf(points);

/** Distinct keys of a counter: "FIND" counts kinds found; "MEET_DAY:tapboy" counts days Tapboy was met. */
function distinct(v: ConditionView, index: string, extra = ""): number {
  const [type, sub] = index.split(":");
  const prefix = sub ? `${type}:${sub}-${extra}` : `${type}:${extra}`;
  return Object.keys(v.world.tally ?? {}).filter((k) => k.startsWith(prefix) && k !== `${type}:0`).length;
}
const stageRank = (s: StageName | undefined) => (s ? STAGE_ORDER.indexOf(s) : -1);

export const TYPES = {
  // ── counted by the tally, bumped by the actions themselves ──
  GIVE: { kind: "count", index: "item", optional: true, read: t("GIVE"), source: "ITEM_BURN" },
  GIVE_TO: { kind: "count", index: "giveTo", read: t("GIVE_TO"), source: "ITEM_BURN" },
  TOGETHER: { kind: "count", index: "room", optional: true, read: t("TOGETHER"), source: "HARVEST_TIME" },
  TOGETHER_NIGHT: { kind: "count", index: "none", read: t("TOGETHER_NIGHT"), source: "HARVEST_TIME_MOONSIDE" },
  FORAGE: { kind: "count", index: "room", optional: true, read: t("FORAGE"), source: "SCAV_CLAIM_NODE" },
  FIND: { kind: "count", index: "item", optional: true, read: t("FIND"), source: "DROPTABLE_ITEM_TOTAL" },
  // a room's familiarity bar filled: what the room hides was found there (plan 4.5)
  FAMILIAR: { kind: "count", index: "room", optional: true, read: t("FAMILIAR") },
  CRAFT: { kind: "count", index: "item", optional: true, read: t("CRAFT"), source: "CRAFT_ITEM" },
  MAKE: { kind: "count", index: "word", optional: true, read: t("MAKE") },
  MOVE: { kind: "count", index: "none", read: t("MOVE"), source: "MOVE" },
  BUY: { kind: "count", index: "item", optional: true, read: t("BUY"), source: "LISTING_BUY_TOTAL" },
  COINS_SPENT: { kind: "count", index: "none", read: t("COINS_SPENT"), source: "ITEM_SPEND" },
  COINS_EARNED: { kind: "count", index: "none", read: t("COINS_EARNED"), source: "ITEM_TOTAL" },
  USE: { kind: "count", index: "item", optional: true, read: t("USE"), source: "PET_ITEM_USE" },
  HARVEST: { kind: "count", index: "word", optional: true, read: t("HARVEST") },
  WALK: { kind: "count", index: "none", read: t("WALK") },
  TRIP: { kind: "count", index: "word", optional: true, read: t("TRIP") },
  // ── counted by the tally, bumped by the game for the pet's events ──
  CARE: { kind: "count", index: "word", optional: true, read: t("CARE") },
  LESSON: { kind: "count", index: "none", read: t("LESSON"), source: "SKILL_POINTS_USE" },
  SPAR: { kind: "count", index: "none", read: t("SPAR") },
  SPAR_WIN: { kind: "count", index: "none", read: t("SPAR_WIN"), source: "LIQUIDATE_TOTAL" },
  SAVE: { kind: "count", index: "none", read: t("SAVE") },
  GIFT: { kind: "count", index: "none", read: t("GIFT"), source: "TRADE_EXECUTE" },
  CHOOSE: { kind: "count", index: "word", read: t("CHOOSE") },
  VISIT: { kind: "count", index: "room", optional: true, read: t("VISIT") },
  TOGETHER_WHEN: { kind: "count", index: "word", read: t("TOGETHER_WHEN") },
  MOVE_WEARING: { kind: "count", index: "word", read: t("MOVE_WEARING") },
  FED: { kind: "count", index: "word", optional: true, read: t("FED") },
  TALK: { kind: "count", index: "resident", optional: true, read: t("TALK") },
  MEET: { kind: "count", index: "lane", optional: true, read: t("MEET") },
  EVENT: { kind: "count", index: "event", read: t("EVENT") },
  DISTINCT: { kind: "count", index: "counter", read: (v, i) => distinct(v, String(i)) },
  DISTINCT_TODAY: { kind: "count", index: "counter", read: (v, i) => distinct(v, String(i), `${v.day}-`) },
  // ── read from the state itself ──
  ITEM: { kind: "count", index: "item", read: (v, i) => v.world.bag[Number(i)] ?? 0 },
  COINS: { kind: "count", index: "none", read: (v) => v.world.coins },
  VISITED: { kind: "count", index: "none", read: (v) => v.world.visited.length },
  PETS: { kind: "count", index: "none", read: (v) => v.pets, source: "PETS_OWNED" },
  LEVEL: { kind: "count", index: "none", read: (v) => v.pet?.level ?? 0, source: "PET_LEVEL_HIGHEST" },
  STAGE: { kind: "count", index: "none", read: (v) => stageRank(v.pet?.stage), source: "PET_LEVELS_TOTAL" },
  TRUST: { kind: "count", index: "resident", read: (v, i) => v.world.trust?.[String(i)] ?? 0, source: "REPUTATION" },
  TRUST_LEVEL: { kind: "count", index: "resident", read: (v, i) => trustLevel(v.world.trust?.[String(i)] ?? 0) },
  NEEDS: { kind: "count", index: "none", read: (v) => v.pet?.needsMin ?? 0 },
  PLACED: { kind: "count", index: "none", read: (v) => v.world.decor?.placed.length ?? 0 },
  BOND: { kind: "count", index: "none", read: (v) => v.bondLevel },
  NOW: { kind: "count", index: "none", read: (v) => v.now, source: "BLOCKTIME" },
  ROOM: { kind: "bool", index: "room", read: (v, i) => v.world.room === Number(i), source: "ROOM" },
  TIME_OF_DAY: { kind: "bool", index: "time", read: (v, i) => TIMES_OF_DAY[v.timeOfDay] === i, source: "PHASE" },
  QUEST: { kind: "bool", index: "quest", read: (v, i) => v.world.quests?.done[String(i)] !== undefined, source: "QUEST" },
  QUEST_DELAY: {
    kind: "bool",
    index: "quest",
    read: (v, i, value) => {
      const at = v.world.quests?.done[String(i)];
      return at !== undefined && v.now - at > (value ?? 0) * 1000;
    },
    source: "QUEST_COMPLETED_DELAY",
  },
  GOAL_DONE: { kind: "bool", index: "word", read: (v, i) => v.goalsDone.includes(String(i)), source: "COMPLETE_COMP" },
  FLAG: { kind: "bool", index: "word", read: (v, i) => (v.world.flags ?? []).includes(String(i)), source: "PET_NAME" },
  ON_CHAIN: { kind: "bool", index: "none", read: (v) => !!v.pet?.onChain },
  // passes when any condition in `of` passes; read by progressOf itself
  ANY: { kind: "bool", index: "none", read: () => false },
} as const satisfies Record<string, TypeSpec>;

export type ConditionType = keyof typeof TYPES;
const spec = (type: string): TypeSpec | undefined => (TYPES as Record<string, TypeSpec>)[type];

/** The source's types we map, and the two left out on purpose (gacha rerolls; a one-off launch flag). */
export const LEFT_OUT = ["PET_GACHA_REROLL", "SHOP_LAUNCH_FLAG"] as const;

const [handlerOf, operatorOf] = [(l: Logic) => l.split("_")[0] as Handler, (l: Logic) => l.split("_")[1] as Operator];

function compare(a: number, op: Operator, b: number): boolean {
  if (op === "MIN") return a >= b;
  if (op === "MAX") return a <= b;
  if (op === "EQUAL") return a === b;
  throw new Error(`${op} is not a comparison`);
}

/** The key a snapshot is kept under: the source keys it by (logic, type, index) per quest (note A §2.1). */
export const snapshotKey = (c: Condition): string => `${c.type}:${c.index ?? 0}`;

/** The value a count condition reads now (used for snapshots and progress bars). */
export function readCount(c: Condition, v: ConditionView): number {
  const s = spec(c.type);
  if (!s || s.kind !== "count") throw new Error(`${c.type} is not a count`);
  return s.read(v, c.index, c.value) as number;
}

/** Snapshots of every INC condition in a list, taken when the quest is accepted. */
export function snapshotOf(list: readonly Condition[], v: ConditionView): Record<string, number> {
  const snap: Record<string, number> = {};
  for (const c of list) {
    if (c.type === "ANY") Object.assign(snap, snapshotOf(c.of ?? [], v));
    else if (handlerOf(c.logic) === "INC") snap[snapshotKey(c)] = readCount(c, v);
  }
  return snap;
}

export interface Progress {
  /** how far along: the count (or the rise since accepting), or 1/0 for a yes/no fact */
  have: number;
  /** the target: `value` for counts, 1 for yes/no */
  need: number;
  met: boolean;
}

/** One condition's progress. `snapshot` holds the values taken when the quest was accepted (INC only). */
export function progressOf(c: Condition, v: ConditionView, snapshot: Readonly<Record<string, number>> = {}): Progress {
  const s = spec(c.type);
  if (!s) throw new Error(`unknown condition type ${c.type}`);
  const h = handlerOf(c.logic);
  const op = operatorOf(c.logic);
  if (c.type === "ANY") {
    const yes = (c.of ?? []).some((x) => progressOf(x, v, snapshot).met);
    const met = op === "NOT" ? !yes : yes;
    return { have: met ? 1 : 0, need: 1, met };
  }
  if (h === "BOOL") {
    const yes = s.read(v, c.index, c.value) as boolean;
    const met = op === "NOT" ? !yes : yes;
    return { have: met ? 1 : 0, need: 1, met };
  }
  const now = s.read(v, c.index, c.value) as number;
  const need = c.value ?? 0;
  if (h === "CURR") return { have: now, need, met: compare(now, op, need) };
  const base = snapshot[snapshotKey(c)];
  // no snapshot: the quest was never accepted with this objective, so nothing counts yet
  if (base === undefined) return { have: 0, need, met: false };
  const rose = Math.max(0, now - base);
  return { have: rose, need, met: now >= base && compare(rose, op, need) };
}

/** Every condition passes (an empty list passes). */
export const checkAll = (list: readonly Condition[], v: ConditionView, snapshot: Readonly<Record<string, number>> = {}): boolean =>
  list.every((c) => progressOf(c, v, snapshot).met);

/* ── validation: a sheet is checked before it ships ─────────────────────────── */

export interface SheetRefs {
  /** quest ids that exist, for QUEST and QUEST_DELAY */
  quests?: ReadonlySet<string>;
  /** community goal ids that exist */
  goals?: ReadonlySet<string>;
}

const RESIDENTS = new Set(CHARACTERS.map((c) => c.id));
const isWhole = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0;

function checkIndex(kind: IndexKind, index: number | string | undefined, refs: SheetRefs): string | null {
  if (kind === "none") return index === undefined || index === 0 ? null : "takes no index";
  if (index === undefined) return "needs an index";
  switch (kind) {
    case "item":
      return typeof index === "number" && ITEM[index] ? null : `no item ${index}`;
    case "room":
      return typeof index === "number" && ROOMS[index] ? null : `no room ${index}`;
    case "resident":
      return typeof index === "string" && RESIDENTS.has(index) ? null : `no resident ${index}`;
    case "quest":
      return typeof index === "string" && (!refs.quests || refs.quests.has(index)) ? null : `no quest ${index}`;
    case "time":
      return (TIMES_OF_DAY as readonly unknown[]).includes(index) ? null : `no time of day ${index}`;
    case "giveTo": {
      if (typeof index !== "string") return "needs resident or resident:item";
      const [who, item] = index.split(":");
      if (!RESIDENTS.has(who ?? "")) return `no resident ${who}`;
      return item === undefined || ITEM[Number(item)] ? null : `no item ${item}`;
    }
    case "word":
      return typeof index === "string" && /^[a-z0-9-]{1,32}$/.test(index) ? null : `index must be a lower-case word`;
    case "event":
      return typeof index === "string" && EVENT_SET.has(index) ? null : `no event ${index}`;
    case "lane":
      return typeof index === "string" && LANE_SET.has(index) ? null : `no Builders' Lane resident ${index}`;
    case "counter":
      return typeof index === "string" && /^[A-Z_]{2,24}(:[a-z0-9-]{1,32})?$/.test(index) ? null : "index must be a counter like FIND or MEET_DAY:tapboy";
  }
}

/** Problems with one condition, or [] when it is sound. */
export function conditionErrors(c: Condition, refs: SheetRefs = {}): string[] {
  const s = spec(c.type);
  if (!s) return [`unknown type ${String(c.type)}`];
  const out: string[] = [];
  if (!LOGICS.includes(c.logic)) return [`unknown logic ${String(c.logic)}`];
  const h = handlerOf(c.logic);
  if (s.kind === "bool" && h !== "BOOL") out.push(`${c.type} is yes/no, so its logic is BOOL_IS or BOOL_NOT`);
  if (s.kind === "count" && h === "BOOL") out.push(`${c.type} is a count, so its logic is CURR_* or INC_*`);
  const idx = s.optional && c.index === undefined ? null : checkIndex(s.index, c.index, refs);
  if (idx) out.push(`${c.type} ${idx}`);
  if (s.kind === "count" && !isWhole(c.value)) out.push(`${c.type} needs a whole value of 0 or more`);
  if (c.type === "QUEST_DELAY" && !isWhole(c.value)) out.push("QUEST_DELAY needs the delay in whole seconds");
  if (c.type === "GOAL_DONE" && refs.goals && !refs.goals.has(String(c.index))) out.push(`no goal ${c.index}`);
  if (c.type === "ANY") {
    if (!c.of?.length) out.push("ANY needs at least one condition in of");
    for (const x of c.of ?? []) for (const p of conditionErrors(x, refs)) out.push(`ANY: ${p}`);
  } else if (c.of) out.push(`${c.type} takes no of`);
  return out;
}

/** Check every row of a sheet; throws one error naming the sheet and each bad row. */
export function assertSheet(sheet: string, rows: ReadonlyArray<{ id: string; conditions: readonly Condition[] }>, refs: SheetRefs = {}): void {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) problems.push(`${sheet} ${row.id}: the id is used twice`);
    seen.add(row.id);
    row.conditions.forEach((c, i) => {
      for (const p of conditionErrors(c, refs)) problems.push(`${sheet} ${row.id} condition ${i + 1}: ${p}`);
    });
  }
  if (problems.length) throw new Error(`bad sheet\n${problems.join("\n")}`);
}
