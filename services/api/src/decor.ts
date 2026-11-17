/**
 * Shared home decorations: what each player has placed at home, kept on the
 * server so friends who visit see the room as its owner left it, even while the
 * owner is away. The first write for a home binds it to a secret key the owner's
 * device holds (only its hash is stored); later writes must carry the same key,
 * so knowing someone's home link is not enough to rearrange their room.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { DECOR_BY_ID, PLACE_AREA, ROOM_MAX } from "@lingxi/world";

export type Placed = Array<{ id: string; x: number; y: number }>;

const MAX_HOMES = 50_000;
const SAVE_DELAY_MS = 2_000;
const OWNER_ID = /^[a-z0-9]{6,32}$/;
const SECRET = /^[a-f0-9]{32}$/;

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
  /** Whether this key is the home's: binds an unbound home to it, as the first save does. */
  authorise: (owner: string, secret: unknown) => boolean;
}

export function createDecorStore(file?: string): DecorStore {
  const homes = new Map<string, { key: string; placed: Placed }>();
  if (file && existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, { key: string; placed: unknown }>;
      for (const [owner, h] of Object.entries(raw)) {
        const placed = cleanPlaced(h.placed);
        if (OWNER_ID.test(owner) && typeof h.key === "string" && placed) homes.set(owner, { key: h.key, placed });
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
        writeFileSync(`${file}.tmp`, JSON.stringify(Object.fromEntries(homes)));
        renameSync(`${file}.tmp`, file);
      } catch (e) {
        process.stderr.write(`decor store not saved: ${(e as Error).message}\n`);
      }
    }, SAVE_DELAY_MS);
    timer.unref?.();
  };
  return {
    get: (owner) => homes.get(owner)?.placed ?? null,
    authorise: (owner, secret) => {
      if (!OWNER_ID.test(owner) || typeof secret !== "string" || !SECRET.test(secret)) return false;
      const key = hash(secret);
      const held = homes.get(owner);
      if (held) return held.key === key;
      if (homes.size >= MAX_HOMES) return false;
      homes.set(owner, { key, placed: [] });
      save();
      return true;
    },
    set: (owner, secret, raw) => {
      if (!OWNER_ID.test(owner) || typeof secret !== "string" || !SECRET.test(secret)) return false;
      const placed = cleanPlaced(raw);
      if (!placed) return false;
      const key = hash(secret);
      const held = homes.get(owner);
      if (held && held.key !== key) return false;
      if (!held && homes.size >= MAX_HOMES) return false;
      homes.set(owner, { key, placed });
      save();
      return placed;
    },
  };
}
