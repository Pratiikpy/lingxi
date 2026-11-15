/**
 * Pet-sitting packs (PRD C10, M2): the owner leaves the pet here for a friend to
 * collect, and the friend leaves it here to come home. A pack is reached only by
 * its random code; sending the pet home also needs the return key from the
 * owner's link, of which only a hash is kept. The server never judges the pet:
 * the owner's game checks every returned thought against its own log before it
 * accepts anything (see @lingxi/game sitting.ts).
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const MAX_PACK = 600_000;
const MAX_PACKS = 5_000;
const KEEP_AFTER_MS = 7 * 86_400_000;
const MAX_SITTING_MS = 31 * 86_400_000;
const CODE = /^[a-f0-9]{24}$/;
const KEY = /^[a-f0-9]{32}$/;

interface Entry {
  pack: string;
  keyHash: string;
  until: number;
  created: number;
  back?: string;
  backAt?: number;
}

const hash = (k: string) => createHash("sha256").update(`lingxi-sit:${k}`).digest("hex");

export interface SittingStore {
  leave: (pack: string, keyHash: string, until: number) => { ok: true; code: string } | { ok: false; reason: string };
  collect: (code: string) => { pack: string; back?: string; backAt?: number } | null;
  sendHome: (code: string, key: string, pet: string) => boolean;
}

export function createSittingStore(file?: string, now: () => number = Date.now): SittingStore {
  const packs = new Map<string, Entry>();
  if (file && existsSync(file)) {
    try {
      for (const [code, e] of Object.entries(JSON.parse(readFileSync(file, "utf8")) as Record<string, Entry>)) if (CODE.test(code)) packs.set(code, e);
    } catch {
      // a damaged file starts empty rather than stopping the server
    }
  }
  const save = () => {
    if (!file) return;
    try {
      writeFileSync(`${file}.tmp`, JSON.stringify(Object.fromEntries(packs)));
      renameSync(`${file}.tmp`, file);
    } catch (e) {
      process.stderr.write(`sitting store not saved: ${(e as Error).message}\n`);
    }
  };
  const sweep = () => {
    const t = now();
    for (const [code, e] of packs) if (t > e.until + KEEP_AFTER_MS) packs.delete(code);
  };
  return {
    leave: (pack, keyHash, until) => {
      sweep();
      if (typeof pack !== "string" || pack.length > MAX_PACK) return { ok: false, reason: "tooBig" };
      if (!/^[a-f0-9]{64}$/.test(keyHash)) return { ok: false, reason: "invalid" };
      if (!Number.isFinite(until) || until < now() || until > now() + MAX_SITTING_MS) return { ok: false, reason: "invalid" };
      try {
        const p = JSON.parse(pack) as { v?: unknown; pet?: { bornAt?: unknown } };
        if (p.v !== 1 || typeof p.pet?.bornAt !== "number") return { ok: false, reason: "invalid" };
      } catch {
        return { ok: false, reason: "invalid" };
      }
      if (packs.size >= MAX_PACKS) return { ok: false, reason: "full" };
      const code = randomBytes(12).toString("hex");
      packs.set(code, { pack, keyHash, until, created: now() });
      save();
      return { ok: true, code };
    },
    collect: (code) => {
      if (!CODE.test(code)) return null;
      const e = packs.get(code);
      return e ? { pack: e.pack, ...(e.back ? { back: e.back, backAt: e.backAt } : {}) } : null;
    },
    sendHome: (code, key, pet) => {
      if (!CODE.test(code) || typeof key !== "string" || !KEY.test(key) || typeof pet !== "string" || pet.length > MAX_PACK) return false;
      const e = packs.get(code);
      if (!e || e.keyHash !== hash(key)) return false;
      try {
        JSON.parse(pet);
      } catch {
        return false;
      }
      packs.set(code, { ...e, back: pet, backAt: now() });
      save();
      return true;
    },
  };
}

/** The hash the owner's game sends for its return key (computed the same way in the browser). */
export const keyHashOf = hash;
