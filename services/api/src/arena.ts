/**
 * Arena snapshots (PRD A1, A2, the Super Auto Pets pattern): when a player goes
 * into a battle, the line they fielded is saved under that round. Later players
 * at the same round meet one of these real lines instead of a ghost team. A
 * snapshot is the pet's card (its taught lessons, instincts, family and memory)
 * plus the companions behind it; nothing else about the player is kept, and a
 * player never meets their own line.
 */

import { createHash } from "node:crypto";
import { COMPANION, MAX_COMPANIONS, type DuelPet, duelFighter, canonicalCard, shownName } from "@lingxi/game";
import { openShards } from "./shards";
import { heldOver, prefixOf } from "./limit";
import { BLOCKED_WORDS } from "./words";

export const MAX_ROUND = 30;
const PER_ROUND = 60;
/** lines one sender keeps in a round; an IPv6 /48 four senders' worth (A144) */
const LINES_PER_SENDER = 2;
const LINES = new Set(["gentle", "bold", "curious"]);
const STAGES = new Set(["baby", "child", "teen", "adult", "elder"]);

export interface Snapshot {
  pet: DuelPet;
  team: string[];
  /** a one-way tag of the device that saved it, so it is never served back to that device */
  by: string;
  at: number;
  /** the address that sent it, kept here and never served: what holds a sender to its share of a round (A144) */
  from?: string;
}

export interface ArenaStore {
  save: (round: number, pet: unknown, team: unknown, device: string, from?: string) => { ok: true } | { ok: false; reason: "invalid" | "busy" };
  pick: (round: number, device: string, roll?: number) => Omit<Snapshot, "by"> | null;
  count: (round: number) => number;
  /** writes every round that changed since the last write (A123) */
  flush: () => Promise<void>;
}

const tag = (device: string) => createHash("sha256").update(`lingxi-arena:${device}`).digest("hex").slice(0, 16);

/** Accepts only a line a real run could field: known companions, a pet whose card builds a brain. */
export function validSnapshot(pet: unknown, team: unknown): { pet: DuelPet; team: string[] } | null {
  if (!Array.isArray(team) || team.length > MAX_COMPANIONS || !team.every((id) => typeof id === "string" && COMPANION[id])) return null;
  const p = pet as Partial<DuelPet> | null;
  if (!p || typeof p.name !== "string" || p.name.length < 1 || p.name.length > 24) return null;
  // the name as every player is shown it: no direction overrides or hidden characters, and no blocked words (A144)
  const name = shownName(p.name, 24);
  if (!name) return null;
  if (!LINES.has(p.line as string) || !STAGES.has(p.stage as string) || typeof p.card !== "string") return null;
  // the card in its own shape: nothing a sender adds is kept or served to others (A78)
  const card = canonicalCard(p.card);
  if (!card) return null;
  const clean: DuelPet = { name: BLOCKED_WORDS.test(name) ? "Pet" : name, line: p.line!, stage: p.stage!, card, story: { days: 0, lessons: 0, nature: [] } };
  try {
    duelFighter(clean);
  } catch {
    return null;
  }
  return { pet: clean, team: team as string[] };
}

export function createArenaStore(file?: string, now: () => number = Date.now, opts: { every?: number } = {}): ArenaStore {
  const rounds = new Map<number, Snapshot[]>();
  // one file a round (A123): the timer writes the rounds that changed, never all thirty
  const shards = file ? openShards(file, ".before-rounds", "arena round") : null;
  for (const [r, list] of shards?.all() ?? []) {
    const n = Number(r);
    if (Number.isInteger(n) && n >= 0 && n <= MAX_ROUND && Array.isArray(list)) rounds.set(n, (list as Snapshot[]).slice(-PER_ROUND));
  }
  const dirty = new Set<number>();
  const save = () => {
    if (!shards) return;
    for (const n of dirty) shards.write(String(n), rounds.get(n) ?? []);
    dirty.clear();
  };
  const every = opts.every ?? 30_000;
  if (shards && every > 0) setInterval(save, every).unref();
  return {
    save: (round, pet, team, device, from = "unknown") => {
      if (!Number.isInteger(round) || round < 0 || round > MAX_ROUND || typeof device !== "string" || device.length < 8 || device.length > 64) return { ok: false, reason: "invalid" };
      const v = validSnapshot(pet, team);
      if (!v) return { ok: false, reason: "invalid" };
      const by = tag(device);
      // one line per device per round: a newer run replaces the older line
      const list = (rounds.get(round) ?? []).filter((s) => s.by !== by);
      // a sender holds two lines a round, and its IPv6 /48 eight (A144)
      if (heldOver(list.map((s) => s.from ?? ""), from, LINES_PER_SENDER)) return { ok: false, reason: "busy" };
      // a full round lets go of the oldest line of the sender holding the most, never a quiet sender's (A144)
      if (list.length >= PER_ROUND) {
        const network = (s: Snapshot) => (s.from ? (prefixOf(s.from) ?? s.from) : `line:${s.by}`);
        const held = new Map<string, number>();
        for (const s of list) held.set(network(s), (held.get(network(s)) ?? 0) + 1);
        const most = Math.max(...held.values());
        const out = list.findIndex((s) => held.get(network(s)) === most);
        list.splice(out, 1);
      }
      list.push({ ...v, by, at: now(), from });
      rounds.set(round, list.slice(-PER_ROUND));
      dirty.add(round);
      return { ok: true };
    },
    pick: (round, device, roll = Math.random()) => {
      const by = tag(device);
      const list = (rounds.get(round) ?? []).filter((s) => s.by !== by);
      if (!list.length) return null;
      const s = list[Math.min(list.length - 1, Math.floor(roll * list.length))]!;
      return { pet: s.pet, team: s.team, at: s.at };
    },
    count: (round) => rounds.get(round)?.length ?? 0,
    flush: async () => save(),
  };
}
