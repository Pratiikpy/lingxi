/**
 * Weekly seasons (PRD F25, A5). Entering takes one tap: the pet's brain (its
 * card) joins this week's season. When standings are read, every entry spars
 * every other entry twice, once from each side, on seeds made from the week and
 * the two entries, so anyone holding the public entry list recomputes exactly
 * the same table. A win is 3 points and a draw 1; level on points, the smaller
 * brain ranks higher (TapeOut's own idea: the same result with fewer gates is
 * the better design). Every pet fights at the same level, so age claimed in an
 * entry gains nothing.
 */

import { compileProgram, gateCount } from "@lingxi/brain";
import { type DuelPet, duelFighter } from "./duel";
import { halvesOf, instinctBrain, mindBrain, parseCard } from "./family";
import { type Fighter, SPAR_VERSION, type SparVersion } from "./spar";
import { SPAR_V3, SPAR_V5, fight } from "./spar2";

export const SEASON_VERSION = "LX-SEASON/1";
export const MAX_ENTRIES = 64;
export const SEASON_LEVEL = 1;
const DAY = 86_400_000;

export interface SeasonEntry {
  /** stable public id of the entry (not the player's device) */
  key: string;
  pet: DuelPet;
  at: number;
  /** the AI agent that raised it, when it came in through the agent API */
  agent?: string;
}

export interface Standing {
  key: string;
  name: string;
  agent?: string;
  line: DuelPet["line"];
  points: number;
  wins: number;
  draws: number;
  losses: number;
  gates: number;
  rank: number;
}

/** ISO week, e.g. "2026-W46"; weeks start on Monday, UTC. */
export function weekOf(ms: number): string {
  const d = new Date(Math.floor(ms / DAY) * DAY);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / DAY - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Start (Monday 00:00 UTC) and end of an ISO week. */
export function weekBounds(week: string): { start: number; end: number } {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) throw new Error("bad week");
  const year = Number(m[1]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const start = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY + (Number(m[2]) - 1) * 7 * DAY;
  return { start, end: start + 7 * DAY };
}

export const previousWeek = (week: string): string => weekOf(weekBounds(week).start - DAY);

/** How many NAND gates the entry's brain needs. */
export function entryGates(pet: DuelPet): number {
  const card = parseCard(pet.card);
  if (!card) throw new Error("damaged card");
  // the pet's own brain, then an owned instinct's gates on top
  const own = mindBrain({ line: pet.line, lessons: card.lessons, family: card.family, instincts: card.instincts });
  const extra = card.outside ? (instinctBrain(card.outside)?.gates ?? 0) : 0;
  if (own.program) return gateCount(compileProgram(own.program)) + extra;
  const [pa, pb] = card.family ? halvesOf(card.family, card.lessons) : [own.halves![0], own.halves![1]];
  return gateCount(compileProgram(pa)) + gateCount(compileProgram(pb)) + extra;
}

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The seed of the bout where `a` is on the near side. */
/**
 * The week the new fight rules start (G2, row B1: LX-SPAR/3; LX-SPAR/2 was never used for a season). A week before it is
 * fought and ranked exactly as it was (LX-SPAR/1, points then the smaller brain), so a past week's standings, and the
 * keepsake its winner was sent, read the same forever; from this week the ranking is by results alone (points, wins).
 */
export const SPAR_V3_FROM_WEEK = "2026-W48";
/** The first week fought in LX-SPAR/5 (rows D8, D20), so a week is fought in one version from its first bout to its last. */
export const SPAR_V5_FROM_WEEK = "2026-W49";
export const seasonSparVersion = (week: string): SparVersion => (week >= SPAR_V5_FROM_WEEK ? SPAR_V5 : week >= SPAR_V3_FROM_WEEK ? SPAR_V3 : SPAR_VERSION);

export const boutSeed = (week: string, a: string, b: string): number => fnv(`${SEASON_VERSION}|${week}|${a}|${b}`);

export function seasonStandings(week: string, entries: readonly SeasonEntry[]): Standing[] {
  const version = seasonSparVersion(week);
  const list = entries.slice(0, MAX_ENTRIES);
  const fighters: Fighter[] = list.map((e) => ({ ...duelFighter(e.pet), level: SEASON_LEVEL }));
  const rows: Standing[] = list.map((e) => ({ key: e.key, name: e.pet.name, ...(e.agent ? { agent: e.agent } : {}), line: e.pet.line, points: 0, wins: 0, draws: 0, losses: 0, gates: entryGates(e.pet), rank: 0 }));
  const score = (i: number, outcome: 0 | 1 | -1) => {
    const r = rows[i]!;
    if (outcome === 1) {
      r.wins++;
      r.points += 3;
    } else if (outcome === 0) {
      r.draws++;
      r.points += 1;
    } else r.losses++;
  };
  for (let i = 0; i < list.length; i++) {
    for (let j = 0; j < list.length; j++) {
      if (i === j) continue;
      const res = fight(version, fighters[i]!, fighters[j]!, boutSeed(week, list[i]!.key, list[j]!.key));
      score(i, res.winner === 0 ? 1 : res.winner === -1 ? 0 : -1);
      score(j, res.winner === 1 ? 1 : res.winner === -1 ? 0 : -1);
    }
  }
  const sorted = rows
    .slice()
    .sort((a, b) => (version !== SPAR_VERSION ? b.points - a.points || b.wins - a.wins : b.points - a.points || a.gates - b.gates || b.wins - a.wins) || (a.key < b.key ? -1 : 1));
  sorted.forEach((r, i) => (r.rank = i + 1));
  return sorted;
}

/** A short fingerprint of a table, to compare a recomputation with the server's. */
export function standingsDigest(rows: readonly Standing[]): string {
  return fnv(rows.map((r) => `${r.key}:${r.points}:${r.gates}`).join(",")).toString(16).padStart(8, "0");
}

/** The badge tier a final place earns: 3 champion, 2 top three, 1 top ten, 0 none. */
export const placeTier = (rank: number): 0 | 1 | 2 | 3 => (rank === 1 ? 3 : rank <= 3 ? 2 : rank <= 10 ? 1 : 0);

export interface ScoreRow {
  week: string;
  humans: { entries: number; meanPoints: number; best: number | null };
  agents: { entries: number; meanPoints: number; best: number | null };
}

/** Agent-raised pets against human-raised pets, week by week (PRD M10). */
export function scoreboard(weeks: ReadonlyArray<{ week: string; standings: readonly Standing[] }>): ScoreRow[] {
  return weeks.map(({ week, standings }) => {
    const side = (agent: boolean) => {
      const rows = standings.filter((r) => !!r.agent === agent);
      return { entries: rows.length, meanPoints: rows.length ? Math.round((rows.reduce((t, r) => t + r.points, 0) / rows.length) * 10) / 10 : 0, best: rows.length ? Math.min(...rows.map((r) => r.rank)) : null };
    };
    return { week, humans: side(false), agents: side(true) };
  });
}
