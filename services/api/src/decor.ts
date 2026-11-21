/**
 * Shared home decorations: what each player has placed at home, kept on the
 * server so friends who visit see the room as its owner left it, even while the
 * owner is away. A home belongs to the secret key its owner's device holds: a
 * player id is derived from that key (@lingxi/chain player.ts), so only the key
 * behind an id can claim it, and seeing someone's id or home link gives no way
 * to take their home, even before they first use it. A keyed id is checked from
 * its key alone, so nothing is stored for a player until their home holds
 * something, and a full store never keeps a new player out of the rooms. Homes
 * bound before ids came from keys keep the key they were bound to. Only the key's
 * hash is stored.
 *
 * What a keyed home holds is a copy of what its owner's own game holds, sent again
 * on every connection; so when the store is full, the keyed home active least
 * recently makes room, and its owner's next visit puts it back. A home from before
 * keyed ids is never dropped, since its key binding exists only here.
 */

import { createHash } from "node:crypto";
import { PLAYER_SECRET, playerIdFor } from "@lingxi/chain";
import { DECOR_BY_ID, PLACE_AREA, ROOM_MAX } from "@lingxi/world";
import { hasStore, readStore, saveJson } from "./durable";

export type Placed = Array<{ id: string; x: number; y: number }>;

const MAX_HOMES = 50_000;
const SAVE_DELAY_MS = 2_000;
const OWNER_ID = /^[a-z0-9]{6,32}$/;
/** A keyed player id (@lingxi/chain playerIdFor): its home can be dropped and restored by its owner. */
const KEYED_ID = /^[0-9a-f]{24}$/;

const hash = (secret: string): string => createHash("sha256").update(`lingxi-decor:${secret}`).digest("hex");

/**
 * Known pieces only, each once, inside the room, at most a full room (ROOM_MAX); null when the shape is wrong. What
 * visitors see is cut down further to what the home's linked wallets allow (see homes.ts).
 */
export function cleanPlaced(v: unknown): Placed | null {
  if (!Array.isArray(v) || v.length > ROOM_MAX) return null;
  const out: Placed = [];
  for (const p of v) {
    if (!p || typeof p !== "object") return null;
    const { id, x, y } = p as Record<string, unknown>;
    if (typeof id !== "string" || !(id in DECOR_BY_ID) || out.some((o) => o.id === id)) return null;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    out.push({ id, x: Math.max(PLACE_AREA.x0, Math.min(PLACE_AREA.x1, Math.round(x))), y: Math.max(PLACE_AREA.y0, Math.min(PLACE_AREA.y1, Math.round(y))) });
  }
  return out;
}

export interface DecorStore {
  get: (owner: string) => Placed | null;
  /** Saves an owner's decorations; false when the key does not match or the input is bad. */
  set: (owner: string, secret: unknown, placed: unknown) => Placed | false;
  /** Whether this key is the home's: the key a home was bound to, or for a new home the key its id comes from. Stores nothing. */
  authorise: (owner: string, secret: unknown) => boolean;
  /** Whether a home is kept for this owner. */
  holds: (owner: string) => boolean;
  /** How many homes are kept. */
  size: () => number;
}

export function createDecorStore(file?: string, maxHomes = MAX_HOMES, now: () => number = Date.now): DecorStore {
  /** owner → home, ordered from the home active least recently to the one active most recently */
  const homes = new Map<string, { key: string; placed: Placed; at: number }>();
  if (file && hasStore(file)) {
    try {
      const raw = readStore(file) as Record<string, { key: string; placed: unknown; at?: number }>;
      const loaded = Object.entries(raw).sort(([, a], [, b]) => (a.at ?? 0) - (b.at ?? 0));
      for (const [owner, h] of loaded) {
        const placed = cleanPlaced(h.placed);
        if (OWNER_ID.test(owner) && typeof h.key === "string" && placed) homes.set(owner, { key: h.key, placed, at: typeof h.at === "number" ? h.at : 0 });
      }
    } catch {
      // a damaged file starts an empty store rather than stopping the server
    }
  }
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (!file || timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        saveJson(file, undefined, JSON.stringify(Object.fromEntries(homes)));
      } catch (e) {
        process.stderr.write(`decor store not saved: ${(e as Error).message}\n`);
      }
    }, SAVE_DELAY_MS);
    timer.unref?.();
  };
  return {
    get: (owner) => homes.get(owner)?.placed ?? null,
    authorise: (owner, secret) => {
      if (!OWNER_ID.test(owner) || typeof secret !== "string" || !PLAYER_SECRET.test(secret)) return false;
      const key = hash(secret);
      const held = homes.get(owner);
      if (!held) return owner === playerIdFor(secret);
      if (held.key !== key) return false;
      // the owner arrived: their home is the most recently active
      homes.delete(owner);
      homes.set(owner, { ...held, at: now() });
      return true;
    },
    holds: (owner) => homes.has(owner),
    size: () => homes.size,
    set: (owner, secret, raw) => {
      if (!OWNER_ID.test(owner) || typeof secret !== "string" || !PLAYER_SECRET.test(secret)) return false;
      const placed = cleanPlaced(raw);
      if (!placed) return false;
      const key = hash(secret);
      const held = homes.get(owner);
      if (held && held.key !== key) return false;
      if (!held && owner !== playerIdFor(secret)) return false;
      // a new home is kept only once it holds something, and only while there is room
      if (!held && placed.length === 0) return placed;
      if (!held && homes.size >= maxHomes) {
        // the keyed home active least recently makes room; its owner's game sends it again on their next visit
        let idle: string | null = null;
        for (const o of homes.keys())
          if (KEYED_ID.test(o)) {
            idle = o;
            break;
          }
        if (!idle) return false;
        homes.delete(idle);
      }
      homes.delete(owner);
      homes.set(owner, { key, placed, at: now() });
      save();
      return placed;
    },
  };
}
