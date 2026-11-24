/**
 * What a store writes in place of a player's network address (P6a): a keyed one-way code. A store that holds a caller
 * to a share (so many pets, entries, packs or tokens an address) needs to know which records came from the same
 * address, and from the same IPv6 /48; it never needs the address itself. So it keeps the HMAC-SHA256 of the address,
 * and of its /48, under a key only this server holds, cut to 16 hex characters (64 bits: no two callers a store will
 * ever hold meet by chance). Without the key a code cannot be turned back into an address, nor checked against a
 * guessed one, as a plain hash of an IPv4 address could be by trying all four billion.
 *
 * The key is 32 random bytes in a file outside the repository, made on first use: `data/ip-key` beside the stores
 * (data/ is never committed), or the file `LINGXI_IP_KEY_FILE` names. It must stay with the stores: a new key gives
 * every caller a new code, so the shares already counted would start again from nothing.
 *
 * The rate limiters in memory (limit.ts) keep addresses as they are: nothing of theirs reaches the disk.
 */

import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PREFIX_SHARE, prefixOf } from "./limit";
import { writeFlushed } from "./durable";

/** A code: the first 16 hex characters of an HMAC-SHA256. */
export const CODE = /^[0-9a-f]{16}$/;
const KEY_TEXT = /^[0-9a-f]{64}$/;

/** Where the key is kept: `LINGXI_IP_KEY_FILE`, else `data/ip-key` beside the server's stores. */
export function keyFile(): string {
  return process.env.LINGXI_IP_KEY_FILE ?? resolve(dirname(fileURLToPath(import.meta.url)), "../data/ip-key");
}

const keys = new Map<string, Buffer>();

/**
 * The key in `file`, made there (32 random bytes, readable by this user alone where the system allows it) when there
 * is none. A file that holds anything but a key stops the server rather than be replaced: a new key would reset every
 * share counted.
 */
export function pseudonymKey(file = keyFile()): Buffer {
  const have = keys.get(file);
  if (have) return have;
  mkdirSync(dirname(file), { recursive: true });
  try {
    // `wx`: made only when there is none, so two processes starting together cannot each make their own
    writeFileSync(file, `${randomBytes(32).toString("hex")}\n`, { flag: "wx", mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  const text = readFileSync(file, "utf8").trim();
  if (!KEY_TEXT.test(text)) throw new Error(`${file} does not hold an address key (64 hex characters); it was left as it is`);
  const key = Buffer.from(text, "hex");
  keys.set(file, key);
  return key;
}

/** The code of `value` in `domain`: the same value always has the same code under one key, and another under another. */
export function pseudonym(domain: string, value: string, key: Buffer = pseudonymKey()): string {
  return createHmac("sha256", key).update(`${domain}\0${value}`).digest("hex").slice(0, 16);
}

/** The code of a caller (as clientIp names it: an IPv4 address, or an IPv6 /64). */
export const addressCode = (address: string, key?: Buffer) => pseudonym("address", address, key);
/** The code of an IPv6 /48 (as prefixOf names it). */
export const prefixCode = (prefix: string, key?: Buffer) => pseudonym("network", prefix, key);
/** The code of a caller's /48; null for an IPv4 caller, which has none. */
export function networkCode(address: string, key?: Buffer): string | null {
  const prefix = prefixOf(address);
  return prefix === null ? null : prefixCode(prefix, key);
}

/** A caller as a store keeps it: its code, and its /48's code when it has one. */
export interface Coded {
  by: string;
  net?: string;
}

export function codeOf(address: string): Coded {
  const net = networkCode(address);
  return { by: addressCode(address), ...(net !== null ? { net } : {}) };
}

/**
 * A caller as read from a store, coded if it was kept before codes (P6a): a code stays as it is with the /48 code kept
 * beside it; anything else is the raw caller a store wrote then, and is coded now as it would be today, so the shares
 * it counted keep counting.
 */
export function recoded(by: string, net?: string): Coded {
  if (CODE.test(by)) return { by, ...(net !== undefined && CODE.test(net) ? { net } : {}) };
  return codeOf(by);
}

/** The network a share counts against: a caller's /48, else the caller itself. */
export const networkOf = (c: Coded) => c.net ?? c.by;

/**
 * Whether `who` already holds `cap` of `owners` (one owner per thing held), or its /48 holds `cap` x PREFIX_SHARE: the
 * rule of `heldOver` (limit.ts), read from codes.
 */
export function heldOverCoded(owners: Iterable<Coded>, who: Coded, cap: number): boolean {
  let mine = 0;
  let network = 0;
  for (const o of owners) {
    if (o.by === who.by) mine++;
    if (who.net !== undefined && o.net === who.net) network++;
  }
  return mine >= cap || (who.net !== undefined && network >= cap * PREFIX_SHARE);
}

/** A raw caller written as a JSON string: an IPv4 address, an IPv6 /64 or /48 as callerOf and prefixOf name them. */
const RAW_IN_JSON = /"((?:\d{1,3}\.){3}\d{1,3}|[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){3}::\/64|[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){2}::\/48)"/g;

/** `text` with every raw caller written in it as a JSON string replaced by its code. */
export function scrubText(text: string): string {
  return text.replace(RAW_IN_JSON, (all, raw: string) => {
    if (raw.endsWith("::/48")) return `"${prefixCode(raw)}"`;
    if (raw.endsWith("::/64") || isIP(raw) === 4) return `"${addressCode(raw)}"`;
    return all;
  });
}

/**
 * Files a store set aside and never reads again (a copy it could not parse, `<name>.damaged-…`, or the file it moved
 * out of, `<name>.before-…`), with every raw caller in them replaced by its code, so no address outlives the change
 * in a file kept for a person to look at. Only files in `dir` whose names start with `name` are touched.
 */
export function scrubAsides(dir: string, name: string): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) {
    if (!n.startsWith(name) || !/\.(damaged-|before-)/.test(n)) continue;
    const path = join(dir, n);
    try {
      const text = readFileSync(path, "utf8");
      const clean = scrubText(text);
      if (clean === text) continue;
      writeFlushed(`${path}.tmp`, clean);
      renameSync(`${path}.tmp`, path);
    } catch (e) {
      process.stderr.write(`${path}: addresses not scrubbed: ${(e as Error).message}\n`);
    }
  }
}
