/**
 * What visitors see of a home, checked against X Layer (plan 4.9). A home's device may link wallets to it by
 * signing one message with each (no transaction, no cost). The server then shows a home's on-chain pieces only while
 * a linked wallet holds them, lets it show 12 pieces plus 4 for each room pack its linked wallets hold, and gives a
 * pet's name its colour only while a linked wallet owns that pet. A home with no linked wallet shows its game pieces,
 * up to 12, as it always did. Chain readings are cached briefly; when X Layer cannot be read, the last good reading
 * stands, and with none the home shows only what needs no chain.
 *
 * A74: linking costs only a free signature, so the store remembers when each home was last seen (linked, or its owner
 * in a room) and, when full, lets go of the home seen longest ago rather than refusing every new home for good. A home
 * let go keeps nothing the chain does not: its wallets can link it again with the same signature.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { type Address, type Hex, getAddress, isAddress, recoverMessageAddress } from "viem";
import { DECOR_BY_ID, MAX_PACKS, MAX_PLACED, ROOM_PER_PACK, homeLinkMessage } from "@lingxi/world";
import { RateLimiter } from "./limit";
import type { Placed } from "./decor";

export { homeLinkMessage };
export const MAX_LINKED = 4;
/** Homes with linked wallets the server keeps, in all. */
export const MAX_LINKED_HOMES = 50_000;
/** Entries in each of the two chain-read caches. */
const CACHE_ENTRIES = 20_000;
const CACHE_MS = 60_000;
/** Uncached home views a visitor may cause a minute: each is two reads of X Layer (A81). */
const VIEWS_PER_MINUTE = 20;
/** Distinct pets a player may have name colours read for in an hour: each is two reads of X Layer (A52). */
const COLOUR_PETS_PER_HOUR = 12;
/** Remembers `value` under `key`, forgetting the oldest entry once the cache is full. */
const remember = <V>(cache: Map<string, V>, key: string, value: V) => {
  cache.delete(key);
  if (cache.size >= CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
};
/** A fresh colour reading (after the player changed it on chain) is taken at most this often per pet. */
const FRESH_MS = 5_000;
const OWNER_ID = /^[a-z0-9]{6,32}$/;
const SAVE_DELAY_MS = 2_000;

export interface HomeChain {
  /** the most room packs any of these wallets holds */
  roomPacks: (wallets: readonly Address[]) => Promise<number>;
  /** the on-chain decorations any of these wallets holds, by the game's piece id */
  piecesHeld: (wallets: readonly Address[]) => Promise<string[]>;
  ownerOf: (petId: bigint) => Promise<Address>;
  nameColour: (petId: bigint) => Promise<number>;
}

export interface HomeView {
  capacity: number;
  held: string[];
}

const BARE: HomeView = { capacity: MAX_PLACED, held: [] };

/** A home's pieces as visitors see them: on-chain pieces only while held, then at most the home's capacity. */
export function visible(placed: Placed, view: HomeView): Placed {
  return placed.filter((p) => !DECOR_BY_ID[p.id]?.chain || view.held.includes(p.id)).slice(0, view.capacity);
}

export interface Homes {
  wallets: (owner: string) => Address[];
  link: (owner: string, wallet: unknown, signature: unknown) => Promise<{ ok: true; wallets: Address[] } | { ok: false; reason: "invalid" | "signature" | "full" | "serverFull" }>;
  unlink: (owner: string, wallet: unknown) => { ok: true; wallets: Address[] } | { ok: false; reason: "invalid" };
  /** what visitors see of `owner`'s home; `who`, the visitor, may cause only so many uncached reads a minute (A81) */
  view: (owner: string, who?: string) => Promise<HomeView>;
  /** the owner of `owner`'s home is here now (in a room): its links are the last to go when the store is full (A74) */
  seen: (owner: string) => void;
  /** the colour a pet's name shows with in this player's company: 0 unless a linked wallet owns the pet. `fresh`
   * looks at the chain again (after the player changed it), at most once every few seconds per pet. */
  colourOf: (owner: string, petId: unknown, fresh?: boolean) => Promise<number>;
}

export function createHomes(opts: { chain?: HomeChain; file?: string; now?: () => number; freshMs?: number; maxHomes?: number } = {}): Homes {
  const now = opts.now ?? Date.now;
  const freshMs = opts.freshMs ?? FRESH_MS;
  const maxHomes = opts.maxHomes ?? MAX_LINKED_HOMES;
  const links = new Map<string, Address[]>();
  /** when each linked home was last seen, in ms; a home read from the older file shape counts as seen longest ago */
  const lastSeen = new Map<string, number>();
  if (opts.file && existsSync(opts.file)) {
    try {
      const raw = JSON.parse(readFileSync(opts.file, "utf8")) as Record<string, unknown>;
      for (const [owner, entry] of Object.entries(raw)) {
        // the shape since A74: { w: wallets, seen: ms }; before it: wallets alone
        const list = Array.isArray(entry) ? entry : entry && typeof entry === "object" ? (entry as { w?: unknown }).w : null;
        const seenAt = !Array.isArray(entry) && entry && typeof entry === "object" ? Number((entry as { seen?: unknown }).seen) : 0;
        if (!OWNER_ID.test(owner) || !Array.isArray(list)) continue;
        const ok = list.filter((w): w is string => typeof w === "string" && isAddress(w)).map((w) => getAddress(w)).slice(0, MAX_LINKED);
        if (ok.length) {
          links.set(owner, ok);
          lastSeen.set(owner, Number.isFinite(seenAt) ? seenAt : 0);
        }
      }
    } catch {
      // a damaged file starts with no links rather than stopping the server
    }
  }
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (!opts.file || timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        writeFileSync(`${opts.file}.tmp`, JSON.stringify(Object.fromEntries([...links].map(([owner, w]) => [owner, { w, seen: lastSeen.get(owner) ?? 0 }]))));
        renameSync(`${opts.file}.tmp`, opts.file!);
      } catch (e) {
        process.stderr.write(`home links not saved: ${(e as Error).message}\n`);
      }
    }, SAVE_DELAY_MS);
    timer.unref?.();
  };

  const views = new Map<string, { at: number; view: HomeView }>();
  /** uncached home views each visitor may cause a minute (A81) */
  const viewers = new RateLimiter(VIEWS_PER_MINUTE, 60_000);
  const colours = new Map<string, { at: number; colour: number }>();
  /** colour reads under way, and the pets each player has had read this hour (A52) */
  const reading = new Map<string, Promise<number>>();
  const askedBy = new Map<string, { since: number; pets: Set<string> }>();
  const forget = (owner: string) => {
    views.delete(owner);
    for (const k of colours.keys()) if (k.startsWith(`${owner}:`)) colours.delete(k);
  };

  const wallets = (owner: string) => links.get(owner) ?? [];

  return {
    wallets,
    seen: (owner) => {
      if (!links.has(owner)) return;
      lastSeen.set(owner, now());
      save();
    },
    link: async (owner, wallet, signature) => {
      if (!OWNER_ID.test(owner) || typeof wallet !== "string" || !isAddress(wallet) || typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return { ok: false, reason: "invalid" };
      let signer: Address;
      try {
        signer = await recoverMessageAddress({ message: homeLinkMessage(owner), signature: signature as Hex });
      } catch {
        return { ok: false, reason: "signature" };
      }
      const w = getAddress(wallet);
      if (signer !== w) return { ok: false, reason: "signature" };
      const cur = wallets(owner);
      if (cur.includes(w)) return { ok: true, wallets: cur };
      if (cur.length >= MAX_LINKED) return { ok: false, reason: "full" };
      // full: the home seen longest ago is let go, so the store never closes to new players (A74)
      if (!cur.length && links.size >= maxHomes) {
        let oldest: string | null = null;
        for (const [o, t] of lastSeen) if (oldest === null || t < lastSeen.get(oldest)!) oldest = o;
        if (oldest === null) return { ok: false, reason: "serverFull" };
        links.delete(oldest);
        lastSeen.delete(oldest);
        forget(oldest);
      }
      const next = [...cur, w];
      links.set(owner, next);
      lastSeen.set(owner, now());
      forget(owner);
      save();
      return { ok: true, wallets: next };
    },
    unlink: (owner, wallet) => {
      if (!OWNER_ID.test(owner) || typeof wallet !== "string" || !isAddress(wallet)) return { ok: false, reason: "invalid" };
      const w = getAddress(wallet);
      const next = wallets(owner).filter((x) => x !== w);
      if (next.length) links.set(owner, next);
      else {
        links.delete(owner);
        lastSeen.delete(owner);
      }
      forget(owner);
      save();
      return { ok: true, wallets: next };
    },
    view: async (owner, who) => {
      const ws = wallets(owner);
      if (!ws.length || !opts.chain) return BARE;
      const cached = views.get(owner);
      if (cached && now() - cached.at < CACHE_MS) return cached.view;
      // a visitor past their reads this minute sees what is known of the home, or its game pieces (A81)
      if (who !== undefined && !viewers.take(who, now())) return cached?.view ?? BARE;
      try {
        const [packs, held] = await Promise.all([opts.chain.roomPacks(ws), opts.chain.piecesHeld(ws)]);
        const p = Number.isInteger(packs) && packs > 0 ? Math.min(MAX_PACKS, packs) : 0;
        const view = { capacity: MAX_PLACED + ROOM_PER_PACK * p, held: held.filter((id) => !!DECOR_BY_ID[id]?.chain) };
        remember(views, owner, { at: now(), view });
        return view;
      } catch {
        return cached?.view ?? BARE;
      }
    },
    colourOf: async (owner, petId, fresh = false) => {
      if (typeof petId !== "string" || !/^\d{1,20}$/.test(petId) || petId === "0") return 0;
      const ws = wallets(owner);
      if (!ws.length || !opts.chain) return 0;
      const key = `${owner}:${petId}`;
      const cached = colours.get(key);
      if (cached && now() - cached.at < (fresh ? freshMs : CACHE_MS)) return cached.colour;
      // the same pet asked again while it is being read waits for that read (A52)
      const flying = reading.get(key);
      if (flying) return flying;
      // a player is read colours for at most COLOUR_PETS_PER_HOUR distinct pets an hour; the rest from what is known
      const t = now();
      const asked = askedBy.get(owner);
      const window = asked && t - asked.since < 3_600_000 ? asked : { since: t, pets: new Set<string>() };
      if (!window.pets.has(petId) && window.pets.size >= COLOUR_PETS_PER_HOUR) return cached?.colour ?? 0;
      window.pets.add(petId);
      remember(askedBy, owner, window);
      const read = (async () => {
        try {
          const id = BigInt(petId);
          const holder = getAddress(await opts.chain!.ownerOf(id));
          const colour = ws.includes(holder) ? await opts.chain!.nameColour(id) : 0;
          const c = Number.isInteger(colour) && colour > 0 && colour <= 32 ? colour : 0;
          remember(colours, key, { at: now(), colour: c });
          return c;
        } catch {
          return cached?.colour ?? 0;
        } finally {
          reading.delete(key);
        }
      })();
      reading.set(key, read);
      return read;
    },
  };
}
