/**
 * Moving pets between Telegram and a browser (PRD S11). Telegram's in-app view has
 * no wallet, and each place keeps its own storage, so a player moves their pets:
 * one side hands its save to the server and gets a one-time code, the other side
 * opens with that code and takes it. A code works once and only for a few minutes,
 * and nothing is kept after it is claimed or expires.
 */

import { randomBytes } from "node:crypto";
import { MoveSave } from "@lingxi/api-schema";
import { SEND_LIMITS } from "@lingxi/chain/limits";

/** How long a move waits to be claimed. */
export const MOVE_TTL_MS = 15 * 60_000;
/** The largest save one move may carry (characters across all its entries). */
export const MAX_MOVE_CHARS = SEND_LIMITS.moveChars;
const MAX_HELD = 500;
/** All waiting moves together never hold more than this (characters), whatever their count: well under the memory
 * the server is restarted at (pm2 600 MB), with room for everything else it holds. */
export const MAX_HELD_CHARS = 64_000_000;
/** Moves one address may have waiting at once. */
export const MAX_WAITING_PER_OWNER = 3;

export function createMoveStore(now: () => number = Date.now) {
  const held = new Map<string, { save: MoveSave; until: number; size: number; owner: string }>();
  let heldChars = 0;
  const drop = (k: string) => {
    const v = held.get(k);
    if (v) heldChars -= v.size;
    held.delete(k);
  };
  const sweep = () => {
    const t = now();
    for (const [k, v] of held) if (v.until <= t) drop(k);
  };
  return {
    put(raw: unknown, owner = "unknown"): { ok: true; code: string; expiresAt: number } | { ok: false; reason: "invalid" | "tooBig" | "busy" } {
      const parsed = MoveSave.safeParse(raw);
      if (!parsed.success) return { ok: false, reason: "invalid" };
      const size = Object.entries(parsed.data).reduce((n, [k, v]) => n + k.length + v.length, 0);
      if (size > MAX_MOVE_CHARS) return { ok: false, reason: "tooBig" };
      sweep();
      if (held.size >= MAX_HELD || heldChars + size > MAX_HELD_CHARS) return { ok: false, reason: "busy" };
      if ([...held.values()].filter((v) => v.owner === owner).length >= MAX_WAITING_PER_OWNER) return { ok: false, reason: "busy" };
      const code = randomBytes(16).toString("base64url");
      const until = now() + MOVE_TTL_MS;
      held.set(code, { save: parsed.data, until, size, owner });
      heldChars += size;
      return { ok: true, code, expiresAt: until };
    },
    /** Hands the save over once; a second claim, or a late one, finds nothing. */
    take(code: string): MoveSave | null {
      sweep();
      const v = held.get(code);
      drop(code);
      return v ? v.save : null;
    },
  };
}
export type MoveStore = ReturnType<typeof createMoveStore>;
