/**
 * What visitors see of a home, checked against X Layer (plan 4.9). A home's device may link wallets to it by
 * signing one message with each (no transaction, no cost). The server then shows a home's on-chain pieces only while
 * a linked wallet holds them, lets it show 12 pieces plus 4 for each room pack its linked wallets hold, and gives a
 * pet's name its colour only while a linked wallet owns that pet. A home with no linked wallet shows its game pieces,
 * up to 12, as it always did. Chain readings are cached briefly; when X Layer cannot be read, the last good reading
 * stands, and with none the home shows only what needs no chain.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { type Address, type Hex, getAddress, isAddress, recoverMessageAddress } from "viem";
import { DECOR_BY_ID, MAX_PACKS, MAX_PLACED, ROOM_PER_PACK, homeLinkMessage } from "@lingxi/world";
import type { Placed } from "./decor";

export { homeLinkMessage };
export const MAX_LINKED = 4;
/** Homes with linked wallets the server keeps, in all. */
export const MAX_LINKED_HOMES = 50_000;
/** Entries in each of the two chain-read caches. */
const CACHE_ENTRIES = 20_000;
const CACHE_MS = 60_000;
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
  view: (owner: string) => Promise<HomeView>;
  /** the colour a pet's name shows with in this player's company: 0 unless a linked wallet owns the pet. `fresh`
   * looks at the chain again (after the player changed it), at most once every few seconds per pet. */
  colourOf: (owner: string, petId: unknown, fresh?: boolean) => Promise<number>;
}

export function createHomes(opts: { chain?: HomeChain; file?: string; now?: () => number; freshMs?: number } = {}): Homes {
  const now = opts.now ?? Date.now;
  const freshMs = opts.freshMs ?? FRESH_MS;
  const links = new Map<string, Address[]>();
  if (opts.file && existsSync(opts.file)) {
    try {
      const raw = JSON.parse(readFileSync(opts.file, "utf8")) as Record<string, unknown>;
      for (const [owner, list] of Object.entries(raw)) {
        if (!OWNER_ID.test(owner) || !Array.isArray(list)) continue;
        const ok = list.filter((w): w is string => typeof w === "string" && isAddress(w)).map((w) => getAddress(w)).slice(0, MAX_LINKED);
        if (ok.length) links.set(owner, ok);
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
        writeFileSync(`${opts.file}.tmp`, JSON.stringify(Object.fromEntries(links)));
        renameSync(`${opts.file}.tmp`, opts.file!);
      } catch (e) {
        process.stderr.write(`home links not saved: ${(e as Error).message}\n`);
      }
    }, SAVE_DELAY_MS);
    timer.unref?.();
  };

  const views = new Map<string, { at: number; view: HomeView }>();
  const colours = new Map<string, { at: number; colour: number }>();
  const forget = (owner: string) => {
    views.delete(owner);
    for (const k of colours.keys()) if (k.startsWith(`${owner}:`)) colours.delete(k);
  };

  const wallets = (owner: string) => links.get(owner) ?? [];

  return {
    wallets,
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
      if (!cur.length && links.size >= MAX_LINKED_HOMES) return { ok: false, reason: "serverFull" };
      const next = [...cur, w];
      links.set(owner, next);
      forget(owner);
      save();
      return { ok: true, wallets: next };
    },
    unlink: (owner, wallet) => {
      if (!OWNER_ID.test(owner) || typeof wallet !== "string" || !isAddress(wallet)) return { ok: false, reason: "invalid" };
      const w = getAddress(wallet);
      const next = wallets(owner).filter((x) => x !== w);
      if (next.length) links.set(owner, next);
      else links.delete(owner);
      forget(owner);
      save();
      return { ok: true, wallets: next };
    },
    view: async (owner) => {
      const ws = wallets(owner);
      if (!ws.length || !opts.chain) return BARE;
      const cached = views.get(owner);
      if (cached && now() - cached.at < CACHE_MS) return cached.view;
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
      try {
        const id = BigInt(petId);
        const holder = getAddress(await opts.chain.ownerOf(id));
        const colour = ws.includes(holder) ? await opts.chain.nameColour(id) : 0;
        const c = Number.isInteger(colour) && colour > 0 && colour <= 32 ? colour : 0;
        remember(colours, key, { at: now(), colour: c });
        return c;
      } catch {
        return cached?.colour ?? 0;
      }
    },
  };
}
