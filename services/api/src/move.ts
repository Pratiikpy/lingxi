/**
 * Moving pets between Telegram and a browser (PRD S11). Telegram's in-app view has
 * no wallet, and each place keeps its own storage, so a player moves their pets:
 * one side hands its save to the server and gets a one-time code, the other side
 * opens with that code and takes it. A code works once and only for a few minutes,
 * and nothing is kept after it is claimed or expires.
 *
 * P10: a waiting save is kept in a file of its own, its place alone in memory: saves held in memory took 64 MB at the
 * shelf's cap. The folder is a temporary one outside the server's data folder, so no save is ever in its daily backup;
 * it is emptied when the server starts (a move never outlived the server before either), and a save's file is removed
 * the moment it is claimed or expires.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MoveSave } from "@lingxi/api-schema";
import { SEND_LIMITS } from "@lingxi/chain/limits";
import { PREFIX_SHARE, heldOver, prefixOf, shareOf } from "./limit";

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
/**
 * Characters one address may have waiting (A83): one largest save and room for a small one, so filling the shelf
 * takes 16 addresses rather than 7, and an IPv6 /48 holds four addresses' worth (limit.ts).
 */
export const MAX_OWNER_CHARS = 4_000_000;

/**
 * The moves waiting, in memory or (with `dir`) each save in its own file there. `dir` is a temporary folder of the
 * server's own, outside its data folder (see above).
 */
export function createMoveStore(now: () => number = Date.now, dir?: string) {
  /** each waiting move: its save (in memory when there is no folder), when it expires, its size and its sender */
  const held = new Map<string, { save?: MoveSave; until: number; size: number; owner: string }>();
  let heldChars = 0;
  const file = (code: string) => join(dir ?? "", `${code}.json`);
  if (dir) {
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir)) rmSync(join(dir, name), { force: true });
  }
  const drop = (k: string) => {
    const v = held.get(k);
    if (v) heldChars -= v.size;
    held.delete(k);
    if (v && dir) rmSync(file(k), { force: true });
  };
  const sweep = () => {
    const t = now();
    for (const [k, v] of held) if (v.until <= t) drop(k);
  };
  return {
    put(
      raw: unknown,
      owner = "unknown",
    ): { ok: true; code: string; expiresAt: number } | { ok: false; reason: "invalid" | "tooBig" | "busy" } {
      const parsed = MoveSave.safeParse(raw);
      if (!parsed.success) return { ok: false, reason: "invalid" };
      const size = Object.entries(parsed.data).reduce((n, [k, v]) => n + k.length + v.length, 0);
      if (size > MAX_MOVE_CHARS) return { ok: false, reason: "tooBig" };
      sweep();
      if (held.size >= MAX_HELD || heldChars + size > MAX_HELD_CHARS) return { ok: false, reason: "busy" };
      if (
        heldOver(
          [...held.values()].map((v) => v.owner),
          owner,
          MAX_WAITING_PER_OWNER,
        )
      )
        return { ok: false, reason: "busy" };
      const prefix = prefixOf(owner);
      let mine = 0;
      let network = 0;
      let places = 0;
      for (const v of held.values()) {
        if (v.owner === owner) mine += v.size;
        if (prefix !== null && prefixOf(v.owner) === prefix) network += v.size;
        if ((prefixOf(v.owner) ?? v.owner) === (prefix ?? owner)) places++;
      }
      // a sender's share shrinks as the shelf fills, in characters and in places, so a few networks cannot fill it (A141)
      const free = MAX_HELD_CHARS - heldChars;
      if (mine + size > shareOf(MAX_OWNER_CHARS, free, mine)) return { ok: false, reason: "busy" };
      if (prefix !== null && network + size > shareOf(MAX_OWNER_CHARS * PREFIX_SHARE, free, network))
        return { ok: false, reason: "busy" };
      if (places + 1 > Math.max(1, shareOf(MAX_WAITING_PER_OWNER * PREFIX_SHARE, MAX_HELD - held.size, places)))
        return { ok: false, reason: "busy" };
      const code = randomBytes(16).toString("base64url");
      const until = now() + MOVE_TTL_MS;
      if (dir) {
        try {
          writeFileSync(file(code), JSON.stringify(parsed.data));
        } catch (e) {
          rmSync(file(code), { force: true });
          process.stderr.write(`move not kept: ${(e as Error).message}\n`);
          return { ok: false, reason: "busy" };
        }
        held.set(code, { until, size, owner });
      } else held.set(code, { save: parsed.data, until, size, owner });
      heldChars += size;
      return { ok: true, code, expiresAt: until };
    },
    /** Hands the save over once; a second claim, or a late one, finds nothing. */
    take(code: string): MoveSave | null {
      sweep();
      const v = held.get(code);
      if (!v) return null;
      let save: MoveSave | null = v.save ?? null;
      if (dir) {
        try {
          save = JSON.parse(readFileSync(file(code), "utf8")) as MoveSave;
        } catch (e) {
          // a file gone or cut short is no save to hand over: the code finds nothing, as an expired one does
          process.stderr.write(`move not read: ${(e as Error).message}\n`);
          save = null;
        }
      }
      drop(code);
      return save;
    },
  };
}
export type MoveStore = ReturnType<typeof createMoveStore>;
