/**
 * Who has already been counted, in a size that never grows past a few kilobytes: an exact list while it is small,
 * then a Bloom filter. Asked about someone it saw, it always says yes, so no one is counted twice; asked about a
 * newcomer, it can wrongly say yes, rarely at the size a popular lesson reaches (under 1% at 2,000) and more often
 * as it fills, which then counts some newcomers out. A crowd of addresses therefore cannot make it grow.
 * Ids are hex hashes (hashId in library.ts); the filter's bit positions come from their digits.
 */

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
