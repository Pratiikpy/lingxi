/**
 * Weekly seasons on the server (PRD F25, A5): the public list of this week's
 * entries, one per device, open until the week ends. The server keeps the list
 * and serves the standings it computes from it; the standings are a pure
 * function of the list (see @lingxi/game season.ts), so any browser can fetch
 * the list and recompute them.
 *
 * Every player may enter, pets kept only in a browser included, but one address may hold only a few entries a week,
 * so no one fills the season. The keepsake is only for an entry proven to be a pet on X Layer: signed by a keeper of
 * that pet, and thinking exactly as its brain on chain does (checked before the entry is stored, see seasonProof.ts).
 * It goes to the best-placed proven pet, sent to whoever owns that pet when the week is settled.
 */

import { createHash } from "node:crypto";
import {
  MAX_ENTRIES,
  type SeasonEntry,
  type Standing,
  seasonStandings,
  standingsDigest,
  weekBounds,
  weekOf,
} from "@lingxi/game";
import { validSnapshot } from "./arena";
import { type StandingsAnswer, entriesKey } from "./standings";
import { readFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { loadJson, saveJson } from "./durable";
import { CODE, type Coded, codeOf, heldOverCoded, networkOf, recoded, scrubAsides } from "./pseudonym";
import { openShards } from "./shards";

const KEEP_WEEKS = 12;
const WEEK = /^\d{4}-W\d{2}$/;

interface Week {
  entries: SeasonEntry[];
  /** device tag → entry key, so a device updates its own entry */
  by: Record<string, string>;
  /** entry key → the on-chain pet it was proven to be; only these can win the keepsake. Never served. */
  pets?: Record<string, string>;
  /** entry key → the code of the address that entered it (never the address, P6a), for the per-address cap. Never served. */
  from?: Record<string, string>;
  /** entry key → the code of that address's IPv6 /48, when it has one. Never served. */
  net?: Record<string, string>;
  award?: Award;
}

/** Entries one address may hold in a week. */
export const MAX_ENTRIES_PER_ADDRESS = 3;
/** A week's places that may go to pets raised by agents: a quarter, so they can never crowd players out (A41). */
export const MAX_AGENT_ENTRIES = MAX_ENTRIES / 4;

/** The champion's keepsake (PRD F26): its brain taped out on X Layer and sent to its owner. */
export interface Award {
  key: string;
  name: string;
  brainId?: string;
  to?: string;
  tapeTx?: string;
  sendTx?: string;
  /** why nothing was sent: no pet kept on X Layer was placed, or the tape-out failed */
  none?: "noWallet" | "failed";
  tries: number;
}

export interface PendingAward {
  week: string;
  entry: SeasonEntry;
  /** the best-placed proven pet; null when none was proven */
  petId: string | null;
  tries: number;
}

const MAX_TRIES = 3;
const PET = /^\d{1,20}$/;

export interface SeasonView {
  week: string;
  closed: boolean;
  ends: number;
  entries: SeasonEntry[];
  standings: Standing[];
  digest: string;
  /** the standings are not yet those of these entries: they are being fought (A38) */
  pending?: true;
  award?: Award;
}

export interface EnterOptions {
  /** the address that sent it (as clientIp names it), for the per-address cap; the store keeps only its code */
  from?: string;
  /** the on-chain pet this entry was proven to be */
  petId?: string;
  /** an agent's pet (agent API) */
  agent?: string;
}

export interface SeasonStore {
  enter: (
    pet: unknown,
    device: string,
    opts?: EnterOptions,
  ) => { ok: true; week: string; key: string } | { ok: false; reason: "invalid" | "full" | "tooMany" | "agentsFull" };
  view: (week: string) => SeasonView | null;
  /** finished weeks whose champion has no keepsake yet */
  pending: () => PendingAward[];
  award: (week: string, award: Award) => void;
  /** every week kept, oldest first */
  weeks: () => string[];
  /** a finished week's whole answer as the route wrote it once (P10), or null: an open week, or one not written yet */
  finishedAnswer: (week: string) => string | null;
  /** keeps `text`, the route's answer for `week`, when the week is finished; otherwise nothing */
  keepAnswer: (week: string, text: string) => void;
}

const tag = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * The entry that makes way for a proven pet in a full week (A141): the newest unproven entry of the network (an IPv6
 * /48, else the address) holding the most entries; null when every entry is proven.
 */
function makeWay(
  entries: readonly SeasonEntry[],
  pets: Record<string, string>,
  from: Record<string, string>,
  net: Record<string, string>,
): string | null {
  const network = (k: string) => {
    const c = senderOf(k, from, net);
    return c ? networkOf(c) : `entry:${k}`;
  };
  const held = new Map<string, number>();
  for (const e of entries) held.set(network(e.key), (held.get(network(e.key)) ?? 0) + 1);
  const open = entries.filter((e) => !pets[e.key]);
  if (!open.length) return null;
  const most = Math.max(...open.map((e) => held.get(network(e.key))!));
  return open.filter((e) => held.get(network(e.key)) === most).reduce((a, b) => (b.at >= a.at ? b : a)).key;
}

/** Who entered `key`, as the week keeps it; undefined for an entry kept before senders were. */
function senderOf(key: string, from: Record<string, string>, net: Record<string, string>): Coded | undefined {
  const by = from[key];
  if (by === undefined) return undefined;
  const n = net[key];
  return n === undefined ? { by } : { by, net: n };
}

/** A week kept before addresses were coded, its senders coded as they would be today (P6a); null when it held none. */
function recodedWeek(w: Week): Week | null {
  if (!w.from || Object.values(w.from).every((v) => CODE.test(v))) return null;
  const from: Record<string, string> = {};
  const net: Record<string, string> = {};
  for (const [k, v] of Object.entries(w.from)) {
    const c = recoded(v, w.net?.[k]);
    from[k] = c.by;
    if (c.net !== undefined) net[k] = c.net;
  }
  return { ...w, from, net };
}

/** Where standings come from: fought on the spot (tests), or by the server's runner off the request thread (A38). */
export interface StandingsSource {
  get: (week: string, entries: readonly SeasonEntry[]) => StandingsAnswer;
}

/** Standings fought where they are asked for, kept until the week's entries change. */
function foughtHere(): StandingsSource {
  const kept = new Map<string, { key: string; answer: StandingsAnswer }>();
  return {
    get(week, entries) {
      const key = entriesKey(week, entries);
      const have = kept.get(week);
      if (have?.key === key) return have.answer;
      const standings = seasonStandings(week, entries);
      const answer = { standings, digest: standingsDigest(standings), pending: false };
      kept.set(week, { key, answer });
      return answer;
    },
  };
}

/** A week's keepsake that will not change again: sent, or none to send, or given up after its tries. */
const awardFinal = (a: Award | undefined): boolean =>
  !!a && (!!a.brainId || a.none === "noWallet" || a.tries >= MAX_TRIES);

/**
 * What memory keeps of a week that has closed, where the store has a file (P10): what is asked of it often, while its
 * entries (each with its pet's whole card: 34 MB at the cap of twelve weeks of 64) stay in its file, read when the week
 * itself is asked for.
 */
interface ClosedWeek {
  count: number;
  /** its standings once fought, and their digest */
  fought?: { standings: Standing[]; digest: string };
  award?: Award;
}

export function createSeasonStore(
  file?: string,
  now: () => number = Date.now,
  source: StandingsSource = foughtHere(),
): SeasonStore {
  /** the weeks held whole: the open week, and with no file (tests) every week */
  const weeks = new Map<string, Week>();
  // one file a week (A123): an entry rewrites its own week, never every week kept
  const shards = file ? openShards(file, ".before-weeks", "season week") : null;
  for (const [w, raw] of shards?.all() ?? []) {
    const v = raw as Week;
    if (!WEEK.test(w) || !v || !Array.isArray(v.entries)) continue;
    const coded = recodedWeek(v);
    const week = { ...(coded ?? v), entries: v.entries.slice(0, MAX_ENTRIES), by: v.by ?? {} };
    // a keepsake given while the week's file could not be read was kept beside it, and is the week's (P10)
    const beside = file ? loadJson(join(`${file}.d`, `${w}.award`)) : null;
    if (beside?.state === "ok" && !awardFinal(week.award)) week.award = beside.value as Award;
    weeks.set(w, week);
    // written twice, so the .bak each write keeps holds no address either
    if (coded && shards) for (let i = 0; i < 2; i++) shards.write(w, week);
  }
  if (file) {
    scrubAsides(dirname(file), basename(file));
    scrubAsides(`${file}.d`, "");
  }
  /** the weeks that have closed, held as their summary alone (only with a file to read them back from) */
  const closed = new Map<string, ClosedWeek>();
  const answerFile = (week: string) => join(`${file}.d`, `${week}.answer`);
  const awardFile = (week: string) => join(`${file}.d`, `${week}.award`);
  /**
   * a week whole: from memory, or for a closed week read from its file; an empty week for one never entered; null for
   * a closed week whose file cannot be read, which is never answered or written over as though it were empty
   */
  const whole = (week: string): Week | null => {
    const held = weeks.get(week);
    if (held) return held;
    if (!closed.has(week)) return { entries: [], by: {} };
    const v = shards?.read(week) as Week | null;
    if (v && Array.isArray(v.entries)) return { ...v, entries: v.entries.slice(0, MAX_ENTRIES), by: v.by ?? {} };
    process.stderr.write(`season week ${week}: its file cannot be read, so it is not answered
`);
    return null;
  };
  /** the standings of a week's entries, noted in its summary once fought */
  const standingsOf = (week: string, w: Week): StandingsAnswer => {
    const c = closed.get(week);
    if (c?.fought) return { ...c.fought, pending: false };
    const s = source.get(week, w.entries);
    if (c && !s.pending) c.fought = { standings: s.standings, digest: s.digest };
    return s;
  };
  /** every week that has ended leaves memory for its summary, its entries kept in its file (P10) */
  const settle = () => {
    if (!shards) return;
    const t = now();
    for (const [week, w] of weeks) {
      if (t < weekBounds(week).end) continue;
      const c: ClosedWeek = { count: w.entries.length, ...(w.award ? { award: w.award } : {}) };
      closed.set(week, c);
      standingsOf(week, w);
      weeks.delete(week);
    }
  };
  settle();
  const save = (week: string) => {
    const w = weeks.get(week);
    if (shards && w) shards.write(week, w);
  };
  const all = () => [...new Set([...weeks.keys(), ...closed.keys()])].sort();
  const prune = () => {
    const keep = all().slice(-KEEP_WEEKS);
    for (const w of all())
      if (!keep.includes(w)) {
        weeks.delete(w);
        closed.delete(w);
        shards?.remove(w);
        if (file) for (const f of [answerFile(w), awardFile(w), `${awardFile(w)}.bak`]) rmSync(f, { force: true });
      }
  };
  /** a closed week whose answer will not change again: nothing entered, or fought and its keepsake settled */
  const finished = (week: string): boolean => {
    const c = closed.get(week);
    return !!c && (c.count === 0 || (!!c.fought && awardFinal(c.award)));
  };
  return {
    enter: (pet, device, opts = {}) => {
      if (typeof device !== "string" || device.length < 8 || device.length > 64)
        return { ok: false, reason: "invalid" };
      if (opts.petId !== undefined && !PET.test(opts.petId)) return { ok: false, reason: "invalid" };
      const v = validSnapshot(pet, []);
      if (!v) return { ok: false, reason: "invalid" };
      settle();
      const t = now();
      const week = weekOf(t);
      const w = weeks.get(week) ?? { entries: [], by: {} };
      const who = tag(`lingxi-season-device:${device}`);
      const pets = { ...(w.pets ?? {}) };
      const from = { ...(w.from ?? {}) };
      const net = { ...(w.net ?? {}) };
      const sender = opts.from !== undefined ? codeOf(opts.from) : undefined;
      // a proven pet has one entry: entering it again from another device moves its entry there
      let entries = w.entries;
      if (opts.petId) {
        const before = Object.keys(pets).find((k) => pets[k] === opts.petId && k !== w.by[who]);
        if (before) {
          entries = entries.filter((e) => e.key !== before);
          delete pets[before];
          delete from[before];
          delete net[before];
        }
      }
      const key = w.by[who] ?? tag(`lingxi-season:${week}:${who}`).slice(0, 12);
      let at = entries.findIndex((e) => e.key === key);
      if (at < 0 && entries.length >= MAX_ENTRIES) {
        // a full week takes a proven pet in place of the newest unproven entry from the most crowded network (A141)
        const out = opts.petId ? makeWay(entries, pets, from, net) : null;
        if (!out) return { ok: false, reason: "full" };
        entries = entries.filter((e) => e.key !== out);
        delete from[out];
        delete net[out];
        at = entries.findIndex((e) => e.key === key);
      }
      if (at < 0 && opts.agent && entries.filter((e) => e.agent).length >= MAX_AGENT_ENTRIES)
        return { ok: false, reason: "agentsFull" };
      // an address holds a few entries, and its IPv6 /48 four addresses' worth, so one network cannot fill the week (A117)
      const senders = Object.keys(from).flatMap((k) => senderOf(k, from, net) ?? []);
      if (at < 0 && sender && heldOverCoded(senders, sender, MAX_ENTRIES_PER_ADDRESS))
        return { ok: false, reason: "tooMany" };
      const entry: SeasonEntry = { key, pet: v.pet, at: t, ...(opts.agent ? { agent: opts.agent } : {}) };
      entries = at < 0 ? [...entries, entry] : entries.map((e, i) => (i === at ? entry : e));
      if (opts.petId) pets[key] = opts.petId;
      else delete pets[key];
      if (sender && !from[key]) {
        from[key] = sender.by;
        if (sender.net !== undefined) net[key] = sender.net;
      }
      weeks.set(week, { ...w, entries, by: { ...w.by, [who]: key }, pets, from, net });
      prune();
      save(week);
      return { ok: true, week, key };
    },
    view: (week) => {
      if (!WEEK.test(week)) return null;
      let bounds;
      try {
        bounds = weekBounds(week);
      } catch {
        return null;
      }
      settle();
      const w = whole(week);
      if (!w) return null;
      const kept = closed.get(week)?.award ?? w.award;
      const award = awardFinal(kept) ? { award: kept } : {};
      const s = standingsOf(week, w);
      return {
        week,
        closed: now() >= bounds.end,
        ends: bounds.end,
        entries: w.entries,
        standings: s.standings,
        digest: s.digest,
        ...(s.pending ? { pending: true as const } : {}),
        ...award,
      };
    },
    pending: () => {
      settle();
      const out: PendingAward[] = [];
      for (const week of all()) {
        const c = closed.get(week);
        // a closed week whose keepsake is settled, or that had no entries, is not read from its file at all
        if (c && (c.count === 0 || awardFinal(c.award))) continue;
        const w = whole(week);
        if (!w || !w.entries.length || now() < weekBounds(week).end) continue;
        if (awardFinal(w.award)) continue;
        // the keepsake goes to the best-placed pet proven to be on X Layer, from standings fought for these entries
        const s = standingsOf(week, w);
        if (s.pending) continue;
        const standings = s.standings;
        const best = standings.find((row) => w.pets?.[row.key]) ?? standings[0]!;
        const entry = w.entries.find((e) => e.key === best.key)!;
        out.push({ week, entry, petId: w.pets?.[best.key] ?? null, tries: w.award?.tries ?? 0 });
      }
      return out;
    },
    weeks: () => all(),
    award: (week, award) => {
      const c = closed.get(week);
      if (c && shards) {
        // a closed week's keepsake is written into its file, and noted in its summary
        c.award = award;
        const w = whole(week);
        if (w) shards.write(week, { ...w, award });
        else {
          // never written over a file it cannot read: kept beside it, so it is never given twice once the week is back
          try {
            saveJson(awardFile(week), award);
          } catch (e) {
            process.stderr.write(`season keepsake ${week} not kept: ${(e as Error).message}
`);
          }
        }
        return;
      }
      const w = weeks.get(week);
      if (!w) return;
      weeks.set(week, { ...w, award });
      save(week);
    },
    finishedAnswer: (week) => {
      if (!file || !WEEK.test(week) || !finished(week)) return null;
      try {
        return readFileSync(answerFile(week), "utf8");
      } catch {
        // not written yet: the route answers from the week's file and writes it
        return null;
      }
    },
    keepAnswer: (week, text) => {
      if (!file || !WEEK.test(week) || !finished(week)) return;
      try {
        saveJson(answerFile(week), undefined, text);
      } catch (e) {
        process.stderr.write(`season answer ${week} not kept: ${(e as Error).message}\n`);
      }
    },
  };
}

/**
 * Gives every finished week's keepsake to its best-placed proven pet, retrying a failed tape-out a few times.
 * `give` tapes out the pet's brain and sends it to whoever owns the pet now; it says where it went.
 */
export async function settleAwards(
  store: SeasonStore,
  give: (
    entry: SeasonEntry,
    petId: string,
  ) => Promise<
    { ok: true; brainId: string; to: string; tapeTx: string; sendTx: string } | { ok: false; detail?: string }
  >,
): Promise<void> {
  for (const p of store.pending()) {
    const base = { key: p.entry.key, name: p.entry.pet.name, tries: p.tries + 1 };
    if (!p.petId) {
      store.award(p.week, { ...base, none: "noWallet" });
      continue;
    }
    const r = await give(p.entry, p.petId);
    store.award(
      p.week,
      r.ok
        ? { ...base, brainId: r.brainId, to: r.to, tapeTx: r.tapeTx, sendTx: r.sendTx }
        : { ...base, none: "failed" },
    );
  }
}
