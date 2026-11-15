/**
 * Player-made outfits (PRD S3) on this device and on the fashion market.
 * Designs drawn here are kept locally and can be worn at once ("u:" ids);
 * designs on the market are read from the chain ("c:" ids) and can be worn
 * by a wallet that holds a copy. All of them are registered as wearables so
 * the pet renderer places them like Lingxi's own pieces.
 */

import { create } from "zustand";
import type { Address, Hex } from "viem";
import { type Design, decodeDesign, designWearable, encodeDesign, registerWearables } from "@lingxi/art";
import { type OutfitDesign, type OutfitListing, copiesHeld, readDesigns, readListings } from "@lingxi/chain";
import { deployment, publicClient } from "./chain";

const KEY = "lingxi.designs.v1";
export const marketAvailable = () => !!deployment?.outfitMarket;

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
  /** copies the connected wallet holds, by market id */
  held: Record<string, number>;
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
    const d = safeDecode(m.pixels);
    if (d) ws.push(designWearable(`c:${m.id}`, d, { en: m.name, zh: m.name }));
  }
  registerWearables(ws);
}

export const useDesigns = create<DesignsStore>((set, get) => {
  const initial = load();
  register(initial, []);
  const keep = (local: LocalDesign[]) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(local));
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
    wallet: null,
    loading: false,
    error: null,
    version: 0,
    save: (name, d) => {
      const hex = toHex(encodeDesign(d));
      const id = `u:${Date.now().toString(36)}`;
      keep([{ id, name: name.slice(0, 32), hex, at: Date.now() }, ...get().local].slice(0, 60));
      return id;
    },
    remove: (id) => keep(get().local.filter((l) => l.id !== id)),
    markPublished: (id, chainId) => keep(get().local.map((l) => (l.id === id ? { ...l, chainId } : l))),
    refresh: async (wallet) => {
      if (!deployment?.outfitMarket) return;
      set({ loading: true, error: null });
      try {
        const [market, listings] = await Promise.all([readDesigns(publicClient, deployment), readListings(publicClient, deployment)]);
        const who = wallet ?? get().wallet;
        const counts = who ? await copiesHeld(publicClient, deployment, who as Address, market.map((m) => m.id)) : [];
        const held: Record<string, number> = {};
        market.forEach((m, i) => {
          if ((counts[i] ?? 0n) > 0n) held[m.id.toString()] = Number(counts[i]);
        });
        register(get().local, market);
        set({ market, listings, held, wallet: who ?? null, loading: false, version: get().version + 1 });
      } catch (e) {
        set({ loading: false, error: (e as Error).message.split("\n")[0] ?? "error" });
      }
    },
    canWear: (id) => {
      if (id.startsWith("u:")) return get().local.some((l) => l.id === id);
      if (id.startsWith("c:")) return (get().held[id.slice(2)] ?? 0) > 0;
      return false;
    },
  };
});

export type { Hex };
