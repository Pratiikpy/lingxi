/**
 * Arena snapshots (PRD A1, A2, the Super Auto Pets pattern): when a player goes
 * into a battle, the line they fielded is saved under that round. Later players
 * at the same round meet one of these real lines instead of a ghost team. A
 * snapshot is the pet's card (its taught lessons, instincts, family and memory)
 * plus the companions behind it; nothing else about the player is kept, and a
 * player never meets their own line.
 *
 * P10: a line's card is kept on disk, not in memory: see cardShelf below.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { writeFlushed } from "./durable";
import { COMPANION, MAX_COMPANIONS, type DuelPet, duelFighter, canonicalCard, shownName } from "@lingxi/game";
import { openShards } from "./shards";
import { basename, dirname, join } from "node:path";
import { CODE, type Coded, codeOf, heldOverCoded, networkOf, recoded, scrubAsides } from "./pseudonym";
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
  /**
   * the code of the address that sent it (never the address, P6a), kept here and never served: what holds a sender to
   * its share of a round (A144)
   */
  from?: string;
  /** the code of that address's IPv6 /48, when it has one */
  net?: string;
}

export interface ArenaStore {
  save: (
    round: number,
    pet: unknown,
    team: unknown,
    device: string,
    from?: string,
  ) => { ok: true } | { ok: false; reason: "invalid" | "busy" };
  pick: (round: number, device: string, roll?: number) => Omit<Snapshot, "by"> | null;
  count: (round: number) => number;
  /** writes every round that changed since the last write (A123) */
  flush: () => Promise<void>;
}

/** a device's tag: the same 16 hex digits as ever, made on their own rather than cut from the whole digest (P10) */
const tag = (device: string) =>
  createHash("sha256").update(`lingxi-arena:${device}`).digest().subarray(0, 8).toString("hex");

/** Accepts only a line a real run could field: known companions, a pet whose card builds a brain. */
export function validSnapshot(pet: unknown, team: unknown): { pet: DuelPet; team: string[] } | null {
  if (
    !Array.isArray(team) ||
    team.length > MAX_COMPANIONS ||
    !team.every((id) => typeof id === "string" && COMPANION[id])
  )
    return null;
  const p = pet as Partial<DuelPet> | null;
  if (!p || typeof p.name !== "string" || p.name.length < 1 || p.name.length > 24) return null;
  // the name as every player is shown it: no direction overrides or hidden characters, and no blocked words (A144)
  const name = shownName(p.name, 24);
  if (!name) return null;
  if (!LINES.has(p.line as string) || !STAGES.has(p.stage as string) || typeof p.card !== "string") return null;
  // the card in its own shape: nothing a sender adds is kept or served to others (A78)
  const card = canonicalCard(p.card);
  if (!card) return null;
  const clean: DuelPet = {
    name: BLOCKED_WORDS.test(name) ? "Pet" : name,
    line: p.line!,
    stage: p.stage!,
    card,
    story: { days: 0, lessons: 0, nature: [] },
  };
  try {
    duelFighter(clean);
  } catch {
    return null;
  }
  return { pet: clean, team: team as string[] };
}

/** A line as memory keeps it (P10): its pet without the card, which the card shelf keeps under its digest. */
interface Line extends Omit<Snapshot, "pet"> {
  pet: Omit<DuelPet, "card">;
  /** the card's digest on the shelf */
  card: string;
}

/** Cards a shelf with a folder keeps in memory: the ones picked or saved most recently. */
const CARDS_HELD = 16;

/**
 * The arena's cards (P10). Each round held its 60 lines' whole cards in memory, up to 34,000 characters each: 49 MB at
 * the cap of 31 rounds. With a folder, each card is a file of its own named by its digest (so lines with one card share
 * it), read when a pick serves it, with the most recent few held; a card's file goes once no line holds it. The rounds'
 * own files keep their lines whole, cards and all, as before: the card files are made from them again at a start.
 * Without a folder (tests), every card is held in memory as before.
 */
function cardShelf(want: string | null) {
  const refs = new Map<string, number>();
  /** cards held whole: every card with no folder, and with one, any card its file could not be written for */
  const all = new Map<string, string>();
  const recent = new Map<string, string>();
  /** a folder that cannot be made leaves every card in memory, as with none: the arena still starts (P10) */
  const dir = ((): string | null => {
    if (!want) return null;
    try {
      mkdirSync(want, { recursive: true });
      return want;
    } catch (e) {
      process.stderr.write(`arena cards held in memory: ${(e as Error).message}
`);
      return null;
    }
  })();
  const path = (id: string) => join(dir ?? "", `${id}.card`);
  const idOf = (text: string) => createHash("sha256").update(text).digest().subarray(0, 16).toString("hex");
  const hold = (id: string, text: string) => {
    recent.delete(id);
    recent.set(id, text);
    for (const old of recent.keys()) {
      if (recent.size <= CARDS_HELD) break;
      recent.delete(old);
    }
  };
  /** writes a card's file; one that cannot be written is held in memory instead, and said so */
  const write = (id: string, text: string) => {
    try {
      writeFlushed(`${path(id)}.tmp`, text);
      renameSync(`${path(id)}.tmp`, path(id));
    } catch (e) {
      rmSync(`${path(id)}.tmp`, { force: true });
      process.stderr.write(`arena card ${id} held in memory: ${(e as Error).message}
`);
      all.set(id, text);
    }
  };
  return {
    /** keeps `text` for one more line, and says its digest */
    put(text: string): string {
      const id = idOf(text);
      const n = refs.get(id) ?? 0;
      if (n === 0) {
        if (!dir) all.set(id, text);
        // a file of another size than its card (cut short) is written again
        else if (statSync(path(id), { throwIfNoEntry: false })?.size !== Buffer.byteLength(text)) write(id, text);
      }
      refs.set(id, n + 1);
      if (dir) hold(id, text);
      return id;
    },
    /** the card under `id`, or null when it is not kept: its file gone, or not the card it is named for */
    get(id: string): string | null {
      const kept = all.get(id) ?? recent.get(id);
      if (kept !== undefined) {
        if (dir) hold(id, kept);
        return kept;
      }
      if (!dir || !refs.has(id)) return null;
      try {
        const text = readFileSync(path(id), "utf8");
        if (idOf(text) !== id) throw new Error("not the card it is named for");
        hold(id, text);
        return text;
      } catch (e) {
        process.stderr.write(`arena card ${id} not read: ${(e as Error).message}
`);
        return null;
      }
    },
    /** writes again the file of a card a line still holds, from a copy found elsewhere (its round's file) */
    mend(id: string, text: string): boolean {
      if (!refs.has(id) || idOf(text) !== id) return false;
      if (dir) {
        write(id, text);
        hold(id, text);
      } else all.set(id, text);
      return true;
    },
    /** one line less holds `id`; the card goes once none does */
    release(id: string): void {
      const n = refs.get(id) ?? 0;
      if (n > 1) {
        refs.set(id, n - 1);
        return;
      }
      refs.delete(id);
      all.delete(id);
      recent.delete(id);
      if (dir) rmSync(path(id), { force: true });
    },
    /** at a start, every card file no line holds goes: each is a copy of a card its round's file keeps whole */
    sweep(): void {
      if (!dir) return;
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        if (!d.isFile()) continue;
        const id = d.name.replace(/.card(.tmp)?$/, "");
        if (d.name.endsWith(".tmp") || !refs.has(id)) rmSync(join(dir, d.name), { force: true });
      }
    },
  };
}

export function createArenaStore(
  file?: string,
  now: () => number = Date.now,
  opts: { every?: number } = {},
): ArenaStore {
  const rounds = new Map<number, Line[]>();
  // one file a round (A123): the timer writes the rounds that changed, never all thirty
  const shards = file ? openShards(file, ".before-rounds", "arena round") : null;
  const cards = cardShelf(file ? join(`${file}.d`, "cards") : null);
  const toLine = (s: Snapshot): Line => {
    const { card, ...pet } = s.pet;
    return { ...s, pet, card: cards.put(card) };
  };
  /** a line whole, its card read from the shelf; null when its card is not kept */
  const toSnapshot = (l: Line): Snapshot | null => {
    const card = cards.get(l.card);
    if (card === null) return null;
    const { card: _card, ...rest } = l;
    return { ...rest, pet: { ...l.pet, card } };
  };
  /**
   * a round whole, each card read from the shelf; a card not there is mended from the round's own file, and when it
   * cannot be, null: a round is never written short of a line (P10)
   */
  const whole = (n: number): Snapshot[] | null => {
    let kept: Snapshot[] | null = null;
    const out: Snapshot[] = [];
    for (const l of rounds.get(n) ?? []) {
      let s = toSnapshot(l);
      if (!s) {
        kept ??= ((shards?.read(String(n)) as Snapshot[] | null) ?? []).filter((k) => typeof k?.pet?.card === "string");
        const was = kept.find((k) => k.by === l.by && k.at === l.at);
        if (was && cards.mend(l.card, was.pet.card)) s = toSnapshot(l);
      }
      if (!s) return null;
      out.push(s);
    }
    return out;
  };
  const writeRound = (n: number) => {
    if (!shards) return;
    const list = whole(n);
    if (list) shards.write(String(n), list);
    else
      process.stderr.write(`arena round ${n}: a card cannot be read, so its file is kept as it was
`);
  };
  /** rounds kept before addresses were coded, whose senders' addresses are coded on load (P6a) */
  const raw = new Set<number>();
  for (const [r, list] of shards?.all() ?? []) {
    const n = Number(r);
    if (!Number.isInteger(n) || n < 0 || n > MAX_ROUND || !Array.isArray(list)) continue;
    rounds.set(
      n,
      (list as Snapshot[]).slice(-PER_ROUND).map((s) => {
        if (s.from === undefined || CODE.test(s.from)) return toLine(s);
        raw.add(n);
        const c = recoded(s.from);
        return toLine({ ...s, from: c.by, ...(c.net !== undefined ? { net: c.net } : {}) });
      }),
    );
  }
  cards.sweep();
  if (shards && file) {
    // written twice, so the .bak each write keeps holds no address either
    for (const n of raw) for (let i = 0; i < 2; i++) writeRound(n);
    scrubAsides(dirname(file), basename(file));
    scrubAsides(`${file}.d`, "");
  }
  const dirty = new Set<number>();
  const save = () => {
    if (!shards) return;
    for (const n of dirty) writeRound(n);
    dirty.clear();
  };
  const every = opts.every ?? 30_000;
  if (shards && every > 0) setInterval(save, every).unref();
  return {
    save: (round, pet, team, device, address = "unknown") => {
      if (
        !Number.isInteger(round) ||
        round < 0 ||
        round > MAX_ROUND ||
        typeof device !== "string" ||
        device.length < 8 ||
        device.length > 64
      )
        return { ok: false, reason: "invalid" };
      const v = validSnapshot(pet, team);
      if (!v) return { ok: false, reason: "invalid" };
      const by = tag(device);
      const from = codeOf(address);
      const sender = (s: Line): Coded => ({ by: s.from ?? "", ...(s.net !== undefined ? { net: s.net } : {}) });
      const before = rounds.get(round) ?? [];
      // one line per device per round: a newer run replaces the older line
      const list = before.filter((s) => s.by !== by);
      // a sender holds two lines a round, and its IPv6 /48 eight (A144)
      if (heldOverCoded(list.map(sender), from, LINES_PER_SENDER)) return { ok: false, reason: "busy" };
      // a full round lets go of the oldest line of the sender holding the most, never a quiet sender's (A144)
      if (list.length >= PER_ROUND) {
        const network = (s: Line) => (s.from ? networkOf(sender(s)) : `line:${s.by}`);
        const held = new Map<string, number>();
        for (const s of list) held.set(network(s), (held.get(network(s)) ?? 0) + 1);
        const most = Math.max(...held.values());
        const out = list.findIndex((s) => held.get(network(s)) === most);
        list.splice(out, 1);
      }
      const added = toLine({
        ...v,
        by,
        at: now(),
        from: from.by,
        ...(from.net !== undefined ? { net: from.net } : {}),
      });
      list.push(added);
      const kept = list.slice(-PER_ROUND);
      // each line let go takes its card with it, once
      for (const l of before) if (!kept.includes(l)) cards.release(l.card);
      if (!kept.includes(added)) cards.release(added.card);
      rounds.set(round, kept);
      dirty.add(round);
      return { ok: true };
    },
    pick: (round, device, roll = Math.random()) => {
      const by = tag(device);
      const list = (rounds.get(round) ?? []).filter((s) => s.by !== by);
      if (!list.length) return null;
      const first = Math.min(list.length - 1, Math.floor(roll * list.length));
      // the line rolled, or the next whose card is kept
      for (let k = 0; k < list.length; k++) {
        const l = list[(first + k) % list.length];
        const s = l ? toSnapshot(l) : null;
        if (s) return { pet: s.pet, team: s.team, at: s.at };
      }
      return null;
    },
    count: (round) => rounds.get(round)?.length ?? 0,
    flush: async () => save(),
  };
}
