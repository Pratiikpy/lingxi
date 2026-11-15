/**
 * Weekly seasons on the server (PRD F25, A5): the public list of this week's
 * entries, one per device, open until the week ends. The server keeps the list
 * and serves the standings it computes from it; the standings are a pure
 * function of the list (see @lingxi/game season.ts), so any browser can fetch
 * the list and recompute them.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { MAX_ENTRIES, type SeasonEntry, type Standing, seasonStandings, standingsDigest, weekBounds, weekOf } from "@lingxi/game";
import { validSnapshot } from "./arena";

const KEEP_WEEKS = 12;
const WEEK = /^\d{4}-W\d{2}$/;

interface Week {
  entries: SeasonEntry[];
  /** device tag → entry key, so a device updates its own entry */
  by: Record<string, string>;
  /** entry key → the owner's wallet, for the champion's keepsake; never served */
  wallets?: Record<string, string>;
  award?: Award;
}

/** The champion's keepsake (PRD F26): its brain taped out on X Layer and sent to its owner. */
export interface Award {
  key: string;
  name: string;
  brainId?: string;
  to?: string;
  tapeTx?: string;
  sendTx?: string;
  /** why nothing was sent */
  none?: "noWallet" | "failed";
  tries: number;
}

export interface PendingAward {
  week: string;
  entry: SeasonEntry;
  wallet: string | null;
  tries: number;
}

const MAX_TRIES = 3;
const WALLET = /^0x[0-9a-fA-F]{40}$/;

export interface SeasonView {
  week: string;
  closed: boolean;
  ends: number;
  entries: SeasonEntry[];
  standings: Standing[];
  digest: string;
  award?: Award;
}

export interface SeasonStore {
  enter: (pet: unknown, device: string, wallet?: string) => { ok: true; week: string; key: string } | { ok: false; reason: "invalid" | "full" };
  view: (week: string) => SeasonView | null;
  /** finished weeks whose champion has no keepsake yet */
  pending: () => PendingAward[];
  award: (week: string, award: Award) => void;
}

const tag = (s: string) => createHash("sha256").update(s).digest("hex");

export function createSeasonStore(file?: string, now: () => number = Date.now): SeasonStore {
  const weeks = new Map<string, Week>();
  const cache = new Map<string, { n: number; at: number; view: SeasonView }>();
  if (file && existsSync(file)) {
    try {
      for (const [w, v] of Object.entries(JSON.parse(readFileSync(file, "utf8")) as Record<string, Week>)) if (WEEK.test(w) && Array.isArray(v.entries)) weeks.set(w, { ...v, entries: v.entries.slice(0, MAX_ENTRIES), by: v.by ?? {} });
    } catch {
      // a damaged file starts empty rather than stopping the server
    }
  }
  const save = () => {
    if (!file) return;
    try {
      writeFileSync(`${file}.tmp`, JSON.stringify(Object.fromEntries(weeks)));
      renameSync(`${file}.tmp`, file);
    } catch (e) {
      process.stderr.write(`season store not saved: ${(e as Error).message}\n`);
    }
  };
  const prune = () => {
    const keep = [...weeks.keys()].sort().slice(-KEEP_WEEKS);
    for (const w of weeks.keys()) if (!keep.includes(w)) weeks.delete(w);
  };
  return {
    enter: (pet, device, wallet) => {
      if (typeof device !== "string" || device.length < 8 || device.length > 64) return { ok: false, reason: "invalid" };
      if (wallet !== undefined && (typeof wallet !== "string" || !WALLET.test(wallet))) return { ok: false, reason: "invalid" };
      const v = validSnapshot(pet, []);
      if (!v) return { ok: false, reason: "invalid" };
      const t = now();
      const week = weekOf(t);
      const w = weeks.get(week) ?? { entries: [], by: {} };
      const who = tag(`lingxi-season-device:${device}`);
      const key = w.by[who] ?? tag(`lingxi-season:${week}:${who}`).slice(0, 12);
      const at = w.entries.findIndex((e) => e.key === key);
      if (at < 0 && w.entries.length >= MAX_ENTRIES) return { ok: false, reason: "full" };
      const entry: SeasonEntry = { key, pet: v.pet, at: t };
      const entries = at < 0 ? [...w.entries, entry] : w.entries.map((e, i) => (i === at ? entry : e));
      const wallets = { ...(w.wallets ?? {}) };
      if (wallet) wallets[key] = wallet;
      else delete wallets[key];
      weeks.set(week, { ...w, entries, by: { ...w.by, [who]: key }, wallets });
      cache.delete(week);
      prune();
      save();
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
      const w = weeks.get(week) ?? { entries: [], by: {} };
      const hit = cache.get(week);
      const award = w.award && (w.award.brainId || w.award.none === "noWallet" || w.award.tries >= MAX_TRIES) ? { award: w.award } : {};
      if (hit && hit.n === w.entries.length && hit.at === Math.max(0, ...w.entries.map((e) => e.at))) return { ...hit.view, closed: now() >= bounds.end, ...award };
      const standings = seasonStandings(week, w.entries);
      const view: SeasonView = { week, closed: now() >= bounds.end, ends: bounds.end, entries: w.entries, standings, digest: standingsDigest(standings), ...award };
      cache.set(week, { n: w.entries.length, at: Math.max(0, ...w.entries.map((e) => e.at)), view });
      return view;
    },
    pending: () => {
      const out: PendingAward[] = [];
      for (const [week, w] of weeks) {
        if (!w.entries.length || now() < weekBounds(week).end) continue;
        if (w.award && (w.award.brainId || w.award.none === "noWallet" || w.award.tries >= MAX_TRIES)) continue;
        const top = seasonStandings(week, w.entries)[0]!;
        const entry = w.entries.find((e) => e.key === top.key)!;
        out.push({ week, entry, wallet: w.wallets?.[top.key] ?? null, tries: w.award?.tries ?? 0 });
      }
      return out;
    },
    award: (week, award) => {
      const w = weeks.get(week);
      if (!w) return;
      weeks.set(week, { ...w, award });
      cache.delete(week);
      save();
    },
  };
}

/** Gives every finished week's champion its keepsake, retrying a failed tape-out a few times. */
export async function settleAwards(
  store: SeasonStore,
  give: (entry: SeasonEntry, wallet: string) => Promise<{ ok: true; brainId: string; tapeTx: string; sendTx: string } | { ok: false; detail?: string }>,
): Promise<void> {
  for (const p of store.pending()) {
    const base = { key: p.entry.key, name: p.entry.pet.name, tries: p.tries + 1 };
    if (!p.wallet) {
      store.award(p.week, { ...base, none: "noWallet" });
      continue;
    }
    const r = await give(p.entry, p.wallet);
    store.award(p.week, r.ok ? { ...base, brainId: r.brainId, to: p.wallet, tapeTx: r.tapeTx, sendTx: r.sendTx } : { ...base, none: "failed" });
  }
}
