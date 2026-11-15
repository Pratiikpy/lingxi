/**
 * Arena runs (PRD A2, Super Auto Pets' format): win 10 trophies before losing
 * 5 hearts. Between battles you get coins to buy companions from a shop of
 * three, roll the shop for 1 coin, freeze an offer you want to keep, or sell a
 * companion back. Your pet always leads the line; up to four companions stand
 * behind it. Each battle is a team spar (team.ts) against a saved team from the
 * same round: a real player's snapshot when one is known, otherwise a ghost team
 * built from the run's seed, so a run can always be played offline.
 *
 * The run is plain data and every step is a pure function, so a run replays
 * from its seed and its list of choices.
 */

import { COMPANIONS, COMPANION } from "./companions";

export const RUN_VERSION = "LX-RUN/1";
export const TROPHIES_TO_WIN = 10;
export const START_HEARTS = 5;
export const ROUND_COINS = 10;
export const ROLL_COST = 1;
export const SHOP_SIZE = 3;
export const MAX_COMPANIONS = 4;
/** a companion sells back for 1 coin */
export const SELL_BACK = 1;

export interface RunState {
  version: typeof RUN_VERSION;
  seed: number;
  round: number;
  trophies: number;
  hearts: number;
  coins: number;
  /** companion ids standing behind the pet, front first */
  team: string[];
  /** current shop offers (companion ids); null is an empty slot */
  shop: Array<string | null>;
  /** frozen shop slots stay through a roll and into the next round */
  frozen: boolean[];
  /** shop rolls taken so far, which keeps every roll derivable from the seed */
  rolls: number;
  /** battle outcomes so far: 1 win, 0 draw, -1 loss */
  history: Array<1 | 0 | -1>;
}

export type RunOutcome = "playing" | "won" | "lost";

function mix(seed: number, a: number, b: number): number {
  let h = (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca77)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** companions offered in a round: cheaper ones early, the whole roster from round 4 */
export function pool(round: number): string[] {
  const cap = round < 2 ? 3 : round < 4 ? 4 : 5;
  return COMPANIONS.filter((c) => c.cost <= cap).map((c) => c.id);
}

function rollShop(s: RunState): Array<string | null> {
  const ids = pool(s.round);
  return s.shop.map((cur, i) => (s.frozen[i] && cur ? cur : ids[mix(s.seed, s.round * 1000 + s.rolls, i) % ids.length]!));
}

export function startRun(seed: number): RunState {
  const s: RunState = {
    version: RUN_VERSION,
    seed: seed >>> 0,
    round: 0,
    trophies: 0,
    hearts: START_HEARTS,
    coins: ROUND_COINS,
    team: [],
    shop: new Array(SHOP_SIZE).fill(null),
    frozen: new Array(SHOP_SIZE).fill(false),
    rolls: 0,
    history: [],
  };
  return { ...s, shop: rollShop(s) };
}

export function outcome(s: RunState): RunOutcome {
  if (s.trophies >= TROPHIES_TO_WIN) return "won";
  if (s.hearts <= 0) return "lost";
  return "playing";
}

export type RunRefusal = "over" | "coins" | "full" | "empty" | "slot";

export type RunStep = { ok: true; state: RunState } | { ok: false; why: RunRefusal };

const refuse = (why: RunRefusal): RunStep => ({ ok: false, why });

export function buy(s: RunState, slot: number): RunStep {
  if (outcome(s) !== "playing") return refuse("over");
  const id = s.shop[slot];
  if (slot < 0 || slot >= SHOP_SIZE || id === undefined) return refuse("slot");
  if (!id) return refuse("empty");
  const cost = COMPANION[id]!.cost;
  if (s.coins < cost) return refuse("coins");
  if (s.team.length >= MAX_COMPANIONS) return refuse("full");
  const shop = s.shop.map((x, i) => (i === slot ? null : x));
  const frozen = s.frozen.map((f, i) => (i === slot ? false : f));
  return { ok: true, state: { ...s, coins: s.coins - cost, team: [...s.team, id], shop, frozen } };
}

export function roll(s: RunState): RunStep {
  if (outcome(s) !== "playing") return refuse("over");
  if (s.coins < ROLL_COST) return refuse("coins");
  const next = { ...s, coins: s.coins - ROLL_COST, rolls: s.rolls + 1 };
  return { ok: true, state: { ...next, shop: rollShop(next) } };
}

export function toggleFreeze(s: RunState, slot: number): RunStep {
  if (outcome(s) !== "playing") return refuse("over");
  if (slot < 0 || slot >= SHOP_SIZE) return refuse("slot");
  if (!s.shop[slot]) return refuse("empty");
  return { ok: true, state: { ...s, frozen: s.frozen.map((f, i) => (i === slot ? !f : f)) } };
}

export function sell(s: RunState, index: number): RunStep {
  if (outcome(s) !== "playing") return refuse("over");
  if (index < 0 || index >= s.team.length) return refuse("slot");
  return { ok: true, state: { ...s, coins: s.coins + SELL_BACK, team: s.team.filter((_, i) => i !== index) } };
}

/** move a companion one place towards the front (-1) or back (+1) */
export function shift(s: RunState, index: number, dir: -1 | 1): RunStep {
  const to = index + dir;
  if (index < 0 || index >= s.team.length || to < 0 || to >= s.team.length) return refuse("slot");
  const team = s.team.slice();
  [team[index], team[to]] = [team[to]!, team[index]!];
  return { ok: true, state: { ...s, team } };
}

/**
 * The ghost team met in a round when no real player's snapshot is available:
 * it grows towards a full line of five, and from round 3 its members are
 * veterans with a level edge that rises every three rounds, so late rounds are
 * hard to win with a careless line.
 */
export function ghostTeam(seed: number, round: number): string[] {
  const ids = pool(round);
  const size = Math.min(MAX_COMPANIONS + 1, 1 + Math.floor((round * 2) / 3) + (round > 0 ? 1 : 0));
  return Array.from({ length: size }, (_, i) => ids[mix(seed ^ 0x5bd1e995, round, i + 7) % ids.length]!);
}

/** level edge of every ghost unit in a round (added to its own balance-table level, capped at 3) */
export const ghostLevel = (round: number): number => Math.min(3, Math.floor(round / 3));

/** the seed a round's battle is fought on */
export const battleSeed = (s: RunState): number => mix(s.seed, s.round, 0xbeef);

/** record a battle result and open the next round's shop */
export function settle(s: RunState, result: 1 | 0 | -1): RunState {
  const trophies = s.trophies + (result === 1 ? 1 : 0);
  const hearts = s.hearts - (result === -1 ? 1 : 0);
  const next: RunState = { ...s, round: s.round + 1, trophies, hearts, coins: ROUND_COINS, rolls: 0, history: [...s.history, result] };
  return outcome(next) === "playing" ? { ...next, shop: rollShop(next) } : next;
}

/** one line for a share card: 🏆 wins, 🤝 draws, 💔 losses in order */
export function runGrid(s: RunState): string {
  return s.history.map((r) => (r === 1 ? "🏆" : r === 0 ? "🤝" : "💔")).join("");
}
