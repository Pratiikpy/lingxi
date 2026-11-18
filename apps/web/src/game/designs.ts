/**
 * Player-made outfits (PRD S3) on this device and on the fashion market.
 * Designs drawn here are kept locally and can be worn at once ("u:" ids);
 * designs on the markets are read from the chain and can be worn by a wallet
 * that holds a copy ("c:" ids on the first market, paid in OKB; "c2:" ids on
 * the BEM market). All of them are registered as wearables so
 * the pet renderer places them like Lingxi's own pieces.
 */

import { create } from "zustand";
import type { Address, Hex } from "viem";
import { type Design, decodeDesign, designWearable, encodeDesign, registerWearables } from "@lingxi/art";
import { type Market, type OutfitDesign, type OutfitListing, copiesHeld, marketsOf, parseWearKey, readDesigns, readListings, wearKey } from "@lingxi/chain";
import { deployment, publicClient } from "./chain";
import { saveWrite } from "./saveRuntime";
import { now } from "./gameClock";

const KEY = "lingxi.designs.v1";
export const marketAvailable = () => !!deployment && marketsOf(deployment).length > 0;
/** The market a design or wear key belongs to, in this deployment. */
export const marketOf = (v: 1 | 2): Market | null => (deployment ? (marketsOf(deployment).find((m) => m.v === v) ?? null) : null);

export interface LocalDesign {
  id: string;
  name: string;
  hex: string;
  /** the market id once published from this device */
  chainId?: string;
  at: number;
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const bytesOf = (hex: string) => Uint8Array.from((hex.replace(/^0x/, "").match(/../g) ?? []).map((x) => parseInt(x, 16)));

function load(): LocalDesign[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as LocalDesign[];
    return Array.isArray(v) ? v.filter((d) => typeof d.id === "string" && typeof d.hex === "string") : [];
  } catch {
    return [];
  }
}

/** A design from bytes, or null when the bytes do not read as one. */
export function safeDecode(hex: string): Design | null {
  try {
    return decodeDesign(bytesOf(hex));
  } catch {
    return null;
  }
}

interface DesignsStore {
  local: LocalDesign[];
  market: OutfitDesign[];
  listings: OutfitListing[];
  /** copies the connected wallet holds, by wear key ("c:5", "c2:3") */
  held: Record<string, number>;
  /** copies kept in the active pet's home (its TapeOut container), by wear key; still wearable */
  atHome: Record<string, number>;
  /** that home's container, once it is open */
  home: string | null;
  setHome: (container: string | null) => void;
  wallet: string | null;
  loading: boolean;
  error: string | null;
  /** bumps whenever wearables are (re)registered, so pictures redraw */
  version: number;
  save: (name: string, d: Design) => string;
  remove: (id: string) => void;
  markPublished: (id: string, chainId: string) => void;
  refresh: (wallet?: string | null) => Promise<void>;
  /** may this device's player wear the piece? */
  canWear: (id: string) => boolean;
}

function register(local: LocalDesign[], market: OutfitDesign[]) {
  const ws = [];
  for (const l of local) {
    const d = safeDecode(l.hex);
    if (d) ws.push(designWearable(l.id, d, { en: l.name, zh: l.name }));
  }
  for (const m of market) {
    if (m.item) continue;
    const d = safeDecode(m.pixels);
    if (d) ws.push(designWearable(wearKey(m.market, m.id), d, { en: m.name, zh: m.name }));
  }
  registerWearables(ws);
}

export const useDesigns = create<DesignsStore>((set, get) => {
  const initial = load();
  register(initial, []);
  const keep = (local: LocalDesign[]) => {
    try {
      saveWrite(KEY, JSON.stringify(local));
    } catch {
      // private mode: lasts for this visit
    }
    register(local, get().market);
    set({ local, version: get().version + 1 });
  };
  return {
    local: initial,
    market: [],
    listings: [],
    held: {},
    atHome: {},
    home: null,
    setHome: (container) => {
      if (container === get().home) return;
      set({ home: container, atHome: {} });
      void get().refresh();
    },
    wallet: null,
    loading: false,
    error: null,
    version: 0,
    save: (name, d) => {
      const hex = toHex(encodeDesign(d));
      const id = `u:${now().toString(36)}`;
      keep([{ id, name: name.slice(0, 32), hex, at: now() }, ...get().local].slice(0, 60));
      return id;
    },
    remove: (id) => keep(get().local.filter((l) => l.id !== id)),
    markPublished: (id, chainId) => keep(get().local.map((l) => (l.id === id ? { ...l, chainId } : l))),
    refresh: async (wallet) => {
      const markets = deployment ? marketsOf(deployment) : [];
      if (!markets.length) return;
      set({ loading: true, error: null });
      try {
        const who = wallet ?? get().wallet;
        const home = get().home;
        const held: Record<string, number> = {};
        const atHome: Record<string, number> = {};
        const parts = await Promise.all(
          markets.map(async (mk) => {
            const [designs, open] = await Promise.all([readDesigns(publicClient, mk), readListings(publicClient, mk)]);
            const ids = designs.map((m) => m.id);
            const [counts, homeCounts] = await Promise.all([who ? copiesHeld(publicClient, mk, who as Address, ids) : [], home ? copiesHeld(publicClient, mk, home as Address, ids) : []]);
            designs.forEach((m, i) => {
              const k = wearKey(m.market, m.id);
              if ((counts[i] ?? 0n) > 0n) held[k] = Number(counts[i]);
              if ((homeCounts[i] ?? 0n) > 0n) atHome[k] = Number(homeCounts[i]);
            });
            return { designs, open };
          }),
        );
        const market = parts.flatMap((p) => p.designs);
        const listings = parts.flatMap((p) => p.open);
        register(get().local, market);
        set({ market, listings, held, atHome, wallet: who ?? null, loading: false, version: get().version + 1 });
      } catch (e) {
        set({ loading: false, error: (e as Error).message.split("\n")[0] ?? "error" });
      }
    },
    canWear: (id) => {
      if (id.startsWith("u:")) return get().local.some((l) => l.id === id);
      if (parseWearKey(id)) return (get().held[id] ?? 0) + (get().atHome[id] ?? 0) > 0;
      return false;
    },
  };
});

export type { Hex };
