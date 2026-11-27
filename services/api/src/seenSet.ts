/**
 * Who has already been counted, in a size that never grows past a few kilobytes: an exact list while it is small,
 * then a Bloom filter. Asked about someone it saw, it always says yes, so no one is counted twice; asked about a
 * newcomer, it can wrongly say yes, rarely at the size a popular lesson reaches (under 1% at 2,000) and more often
 * as it fills, which then counts some newcomers out. A crowd of addresses therefore cannot make it grow.
 * Ids are hex hashes (hashId in library.ts); the filter's bit positions come from their digits.
 */

import { createHash } from "node:crypto";

/** Ids kept exactly before the filter takes over. */
export const EXACT_MAX = 256;
const BLOOM_BYTES = 4096;
const BITS = BLOOM_BYTES * 8;
const PROBES = 3;

export interface SeenSet {
  ids: string[];
  /** the filter, base64; null while the set is exact */
  bloom: string | null;
  /**
   * a filter filled before ids were keyed (P6a): it holds the old ids' bits, which cannot be turned into the new ids',
   * so whoever it saw is looked for by their old id as well (library.ts)
   */
  legacy?: true;
}

export const emptySeen = (): SeenSet => ({ ids: [], bloom: null });

/** The filter positions of an id: three from its first twelve hex digits, a probe from each four. */
function positions(id: string): number[] {
  const hex = id.replace(/[^0-9a-f]/gi, "").padEnd(4 * PROBES, "0");
  return Array.from({ length: PROBES }, (_, i) => parseInt(hex.slice(i * 4, i * 4 + 4), 16) % BITS);
}

function withBit(bits: Uint8Array, id: string): void {
  for (const p of positions(id)) bits[p >> 3]! |= 1 << (p & 7);
}

const decode = (b: string) => new Uint8Array(Buffer.from(b, "base64"));
const encode = (bits: Uint8Array) => Buffer.from(bits).toString("base64");

export function hasSeen(s: SeenSet, id: string): boolean {
  if (!s.bloom) return s.ids.includes(id);
  const bits = decode(s.bloom);
  return positions(id).every((p) => (bits[p >> 3]! & (1 << (p & 7))) !== 0);
}

/** The set with `id` in it (a new value; the old one is left as it was). */
export function addSeen(s: SeenSet, id: string): SeenSet {
  if (hasSeen(s, id)) return s;
  if (!s.bloom && s.ids.length < EXACT_MAX) return { ids: [...s.ids, id], bloom: null };
  const bits = s.bloom ? decode(s.bloom) : new Uint8Array(BLOOM_BYTES);
  // moving to the filter, everyone already listed goes into it
  if (!s.bloom) for (const x of s.ids) withBit(bits, x);
  withBit(bits, id);
  return { ids: [], bloom: encode(bits), ...(s.legacy ? { legacy: true as const } : {}) };
}

/** A set from before this one existed: a plain list of ids. */
export function seenFrom(list: unknown): SeenSet {
  if (list && typeof list === "object" && !Array.isArray(list)) {
    const s = list as Partial<SeenSet>;
    const bloom = typeof s.bloom === "string" ? s.bloom : null;
    return {
      ids: Array.isArray(s.ids) ? s.ids.filter((x): x is string => typeof x === "string") : [],
      bloom,
      ...(bloom && s.legacy === true ? { legacy: true as const } : {}),
    };
  }
  let s = emptySeen();
  for (const x of Array.isArray(list) ? list : []) if (typeof x === "string") s = addSeen(s, x);
  return s;
}

/** An id as 8 bytes: its 16 hex digits, or, for an id that is not 16 hex digits, the start of its SHA-256. */
function packed(id: string): Uint8Array {
  if (/^[0-9a-f]{16}$/i.test(id)) return Uint8Array.from(Buffer.from(id, "hex"));
  return Uint8Array.from(createHash("sha256").update(id).digest().subarray(0, 8));
}
const unpacked = (b: Uint8Array): string => Buffer.from(b.buffer, b.byteOffset, 8).toString("hex");

/**
 * The same set, compact in memory (P10). A store holding thousands of these held each exact id as a 16-character string
 * (42.5 bytes kept, so 10.9 KB for 256) and each filter as its 5,464-character base64 text: the lesson library at its cap
 * of 5,000 held 124 MB of them. Here an id is its 8 bytes and the filter its 4,096, binary, and it answers as the set it is
 * made from, bit for bit: the filter's positions come from the id's hex digits as before, and JSON.stringify writes the
 * same SeenSet text, so the store's file and every set kept in one are unchanged.
 *
 * It changes in place (`add`), where a SeenSet is a new value each time: it is held by one store's record alone.
 */
export class SeenBits {
  /** the exact ids, 8 bytes each, the first `n` in use; null until the first */
  private ids: Uint8Array | null = null;
  private n = 0;
  private bloom: Uint8Array | null = null;
  /** a filter filled before ids were keyed (see SeenSet) */
  readonly legacy: boolean;

  private constructor(legacy: boolean) {
    this.legacy = legacy;
  }

  /** The set as kept on disk, compact. */
  static from(s: SeenSet): SeenBits {
    const b = new SeenBits(s.legacy === true);
    if (s.bloom) b.bloom = Uint8Array.from(Buffer.from(s.bloom, "base64"));
    else for (const x of s.ids) b.add(x);
    return b;
  }

  has(id: string): boolean {
    if (this.bloom) {
      const bits = this.bloom;
      return positions(id).every((p) => ((bits[p >> 3] ?? 0) & (1 << (p & 7))) !== 0);
    }
    if (!this.ids) return false;
    const key = packed(id);
    for (let i = 0; i < this.n; i++) {
      const at = i * 8;
      let same = true;
      for (let j = 0; j < 8 && same; j++) same = this.ids[at + j] === key[j];
      if (same) return true;
    }
    return false;
  }

  /** Adds `id`; false when it was seen already. */
  add(id: string): boolean {
    if (this.has(id)) return false;
    if (!this.bloom && this.n < EXACT_MAX) {
      const ids = this.ids;
      if (!ids || ids.length < (this.n + 1) * 8) {
        // room doubles as the set grows, from 4 ids to EXACT_MAX
        const grown = new Uint8Array(Math.min(EXACT_MAX, Math.max(4, this.n * 2)) * 8);
        if (ids) grown.set(ids.subarray(0, this.n * 8));
        this.ids = grown;
      }
      this.ids?.set(packed(id), this.n * 8);
      this.n++;
      return true;
    }
    if (!this.bloom) {
      // moving to the filter, everyone already listed goes into it, by their hex digits as before
      const bits = new Uint8Array(BLOOM_BYTES);
      for (let i = 0; i < this.n; i++) withBit(bits, this.idAt(i));
      this.bloom = bits;
      this.ids = null;
      this.n = 0;
    }
    withBit(this.bloom, id);
    return true;
  }

  private idAt(i: number): string {
    return this.ids ? unpacked(this.ids.subarray(i * 8, i * 8 + 8)) : "";
  }

  /** The set as it is kept on disk: the same SeenSet a SeenSet value of the same ids would be. */
  toJSON(): SeenSet {
    if (this.bloom) return { ids: [], bloom: encode(this.bloom), ...(this.legacy ? { legacy: true as const } : {}) };
    return { ids: Array.from({ length: this.n }, (_, i) => this.idAt(i)), bloom: null };
  }
}
