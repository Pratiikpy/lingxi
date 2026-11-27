import { createHash, randomBytes } from "node:crypto";

/** the counts a caller's window is kept in: each a sixteenth of it, so it runs 15/16 to 16/16 of its length (P10) */
const SLOTS = 16;
/** a table is never fuller than this, so a search for a caller ends within a few rows */
const LOAD = 0.8;
/** what a row holds: nothing, a caller, an IPv6 /64 caller, or a /48's share */
const EMPTY = 0;
const PLAIN = 1;
const SUB = 2;
const PREFIX = 3;
/** callers are found by a keyed digest of their names, new each start, so no caller can steer where it lands */
const SALT = randomBytes(16);

const digestOf = (text: string): [number, number] => {
  const d = createHash("sha256").update(SALT).update(text).digest();
  return [d.readUInt32LE(0), d.readUInt32LE(4)];
};

/** a /64 caller's /48 (as prefixOf names it) and the /64's place in it; null for any other key */
function sixtyFourOf(key: string): { prefix: string; at: number } | null {
  const m = /^([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4})::\/64$/.exec(key);
  return m ? { prefix: `${m[1]}:${m[2]}:${m[3]}::/48`, at: parseInt(m[4] ?? "0", 16) } : null;
}

/**
 * A per-key sliding-window limiter: at most `max` requests per `windowMs`. It remembers at most `maxKeys` keys, so a
 * crowd of addresses each seen once cannot grow it without end, and no crowd can make it forget a key whose window
 * still runs (A113): a refused caller with nothing in its window is not remembered at all; when full, a key whose window
 * has passed makes room first; then a /64 key of the most crowded /48, whose requests its /48's share still counts
 * (A140); and when neither frees a place, a newcomer is refused until one does, rather than reset someone else's count.
 * One IPv6 /48 cannot fill it: its share (A83) lets it add at most `max x PREFIX_SHARE` keys in a window.
 *
 * P10: each key is a row of a table in typed arrays, found by a keyed digest of its name, and its window is sixteen
 * counts, one a sixteenth of the window: a request counts for 15/16 to 16/16 of the window, so over many windows a key
 * may make up to 16/15 of its limit, and in any 15/16 of a window no more than its limit. A list of request times took
 * 275 bytes a key with one request and 6,958 with 600; a row takes 33 to 49 bytes whatever the key does.
 */
export class RateLimiter {
  private readonly slotMs: number;
  private readonly maxRows: number;
  private rows = 0;
  private mask = 0;
  private h1 = new Uint32Array(0);
  private h2 = new Uint32Array(0);
  /** the newest sixteenth each row has counted in */
  private newest = new Float64Array(0);
  private kind = new Uint8Array(0);
  private counts: Uint8Array | Uint16Array | Uint32Array = new Uint8Array(0);
  private used = 0;
  /** where the search for a row whose window has passed goes on from */
  private cursor = 0;
  /** a sixteenth in which that search found none: none can pass before the next one starts */
  private noneIn = Number.NEGATIVE_INFINITY;
  /** each /48's /64 keys held as keys of their own, by their place in it, oldest first (A140) */
  private readonly subs = new Map<number, number[]>();
  /** the /48s by how many /64 keys they hold, so the most crowded is found at once */
  private readonly crowd: Array<Set<number>> = Array.from({ length: KEYS_PER_PREFIX + 1 }, () => new Set<number>());

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys = 50_000,
  ) {
    this.slotMs = windowMs / SLOTS;
    let rows = 64;
    while (rows * LOAD < maxKeys + 2) rows *= 2;
    this.maxRows = rows;
    this.resize(Math.min(64, rows));
  }

  /**
   * One request from `key`; an IPv6 caller is also held to its /48's share (A83). A /48 holds at most KEYS_PER_PREFIX of
   * its /64s as keys of their own; its other /64s count on the /48's share alone (A140), so a network cannot fill the
   * limiter with keys.
   */
  take(key: string, now = Date.now()): boolean {
    const slot = Math.floor(now / this.slotMs);
    const six = sixtyFourOf(key);
    let k1: number;
    let k2: number;
    let p1 = 0;
    let p2 = 0;
    let net = 0;
    if (six) {
      [p1, p2] = digestOf(six.prefix);
      // a /48's row and its /64s' rows share 48 bits of digest, so a /64's row names its /48
      p2 = (p2 & 0xffff0000) >>> 0;
      net = p1 * 65_536 + (p2 >>> 16);
      k1 = p1;
      k2 = (p2 | six.at) >>> 0;
    } else [k1, k2] = digestOf(key);
    const kind = six ? SUB : PLAIN;
    let own = this.find(k1, k2, kind);
    let shared = six ? this.find(p1, p2, PREFIX) : -1;
    const crowded = six !== null && own < 0 && (this.subs.get(net)?.length ?? 0) >= KEYS_PER_PREFIX;
    const mine = own < 0 ? 0 : this.inWindow(own, slot);
    const theirs = shared < 0 ? 0 : this.inWindow(shared, slot);
    if (!((crowded || mine < this.max) && (six === null || theirs < this.max * PREFIX_SHARE))) return false;
    // a key that would be new needs a free place: one whose window has passed, or one from the most crowded /48
    const adding = (!crowded && own < 0 ? 1 : 0) + (six && shared < 0 ? 1 : 0);
    if (adding) {
      const spare = (i: number) =>
        (this.kind[i] === kind && this.h1[i] === k1 && this.h2[i] === k2) ||
        (six !== null && this.kind[i] === PREFIX && this.h1[i] === p1 && this.h2[i] === p2);
      if (!this.room(adding, slot, spare)) return false;
      // making room moves rows: they are found again
      own = this.find(k1, k2, kind);
      shared = six ? this.find(p1, p2, PREFIX) : -1;
    }
    if (six) {
      if (shared < 0) shared = this.insert(p1, p2, PREFIX, slot);
      this.count(shared, slot);
    }
    if (!crowded) {
      if (own < 0) {
        own = this.insert(k1, k2, kind, slot);
        if (six) this.held(net, six.at, 1);
      }
      this.count(own, slot);
    }
    return true;
  }

  /** How many keys are remembered. */
  size(): number {
    return this.used;
  }

  private resize(rows: number): void {
    const old = {
      rows: this.rows,
      h1: this.h1,
      h2: this.h2,
      newest: this.newest,
      kind: this.kind,
      counts: this.counts,
    };
    this.rows = rows;
    this.mask = rows - 1;
    this.h1 = new Uint32Array(rows);
    this.h2 = new Uint32Array(rows);
    this.newest = new Float64Array(rows);
    this.kind = new Uint8Array(rows);
    const most = this.max * PREFIX_SHARE;
    const n = rows * SLOTS;
    this.counts = most <= 0xff ? new Uint8Array(n) : most <= 0xffff ? new Uint16Array(n) : new Uint32Array(n);
    for (let i = 0; i < old.rows; i++) {
      const k = old.kind[i] ?? EMPTY;
      if (k === EMPTY) continue;
      const a = old.h1[i] ?? 0;
      const b = old.h2[i] ?? 0;
      let j = this.home(a, b);
      while (this.kind[j] !== EMPTY) j = (j + 1) & this.mask;
      this.h1[j] = a;
      this.h2[j] = b;
      this.newest[j] = old.newest[i] ?? 0;
      this.kind[j] = k;
      this.counts.set(old.counts.subarray(i * SLOTS, i * SLOTS + SLOTS), j * SLOTS);
    }
    this.cursor = 0;
  }

  private home(a: number, b: number): number {
    let x = Math.imul(a ^ Math.imul(b, 0x9e3779b1), 0x85ebca6b);
    x ^= x >>> 15;
    return (x >>> 0) & this.mask;
  }

  private find(a: number, b: number, kind: number): number {
    for (let i = this.home(a, b); ; i = (i + 1) & this.mask) {
      const k = this.kind[i] ?? EMPTY;
      if (k === EMPTY) return -1;
      if (k === kind && this.h1[i] === a && this.h2[i] === b) return i;
    }
  }

  private insert(a: number, b: number, kind: number, slot: number): number {
    let i = this.home(a, b);
    while (this.kind[i] !== EMPTY) i = (i + 1) & this.mask;
    this.h1[i] = a;
    this.h2[i] = b;
    this.kind[i] = kind;
    this.newest[i] = slot;
    this.counts.fill(0, i * SLOTS, i * SLOTS + SLOTS);
    this.used++;
    return i;
  }

  /** the requests a row counts in the window ending in sixteenth `slot` */
  private inWindow(i: number, slot: number): number {
    const n = this.newest[i] ?? 0;
    if (slot - n >= SLOTS) return 0;
    let sum = 0;
    for (let s = Math.max(n, slot) - SLOTS + 1; s <= n; s++) sum += this.counts[i * SLOTS + (s % SLOTS)] ?? 0;
    return sum;
  }

  private count(i: number, slot: number): void {
    const n = this.newest[i] ?? 0;
    if (slot > n) {
      // the sixteenths that passed since the row last counted are empty
      if (slot - n >= SLOTS) this.counts.fill(0, i * SLOTS, i * SLOTS + SLOTS);
      else for (let s = n + 1; s <= slot; s++) this.counts[i * SLOTS + (s % SLOTS)] = 0;
      this.newest[i] = slot;
    }
    const at = i * SLOTS + (Math.max(slot, n) % SLOTS);
    this.counts[at] = (this.counts[at] ?? 0) + 1;
  }

  private passed(i: number, slot: number): boolean {
    return slot - (this.newest[i] ?? 0) >= SLOTS;
  }

  /** notes a /64 key of `net` taken (+1) or let go (-1), and where `net` stands among the crowded */
  private held(net: number, at: number, by: 1 | -1): void {
    const list = this.subs.get(net) ?? [];
    this.crowd[list.length]?.delete(net);
    const was = list.indexOf(at);
    if (by > 0) list.push(at);
    else if (was >= 0) list.splice(was, 1);
    if (list.length) {
      this.subs.set(net, list);
      this.crowd[list.length]?.add(net);
    } else this.subs.delete(net);
  }

  /**
   * Whether every key this request would add fits: the table grows while it may; then rows whose window has passed go
   * first; then a /64 key of the /48 holding the most, whose requests its /48's share still counts (A140). Only when
   * neither frees a place is a newcomer turned away, and never by forgetting a count that still holds (A113). A /48's
   * row, and an IPv4 caller's row, go only once their window has passed.
   */
  private room(adding: number, slot: number, spare: (i: number) => boolean): boolean {
    while (this.used + adding > this.rows * LOAD && this.rows < this.maxRows) this.resize(this.rows * 2);
    if (this.used + adding <= this.maxKeys) return true;
    if (slot !== this.noneIn) {
      for (let seen = 0; seen < this.rows && this.used + adding > this.maxKeys; ) {
        const i = this.cursor;
        const k = this.kind[i] ?? EMPTY;
        const lettable =
          k !== EMPTY &&
          !spare(i) &&
          this.passed(i, slot) &&
          !(k === PREFIX && this.subs.has((this.h1[i] ?? 0) * 65_536 + ((this.h2[i] ?? 0) >>> 16)));
        // a row let go may have a row moved back into its place: that one is looked at next
        if (lettable) this.remove(i);
        else {
          this.cursor = (i + 1) & this.mask;
          seen++;
        }
      }
      if (this.used + adding > this.maxKeys) this.noneIn = slot;
    }
    while (this.used + adding > this.maxKeys) {
      const i = this.crowdedSub(spare);
      if (i < 0) break;
      this.remove(i);
    }
    return this.used + adding <= this.maxKeys;
  }

  /** a /64 row of the /48 holding the most /64 keys (more than one), oldest first; -1 when there is none */
  private crowdedSub(spare: (i: number) => boolean): number {
    for (let n = KEYS_PER_PREFIX; n >= 2; n--)
      for (const net of this.crowd[n] ?? []) {
        const a = Math.floor(net / 65_536);
        for (const at of this.subs.get(net) ?? []) {
          const i = this.find(a, ((net % 65_536) * 65_536 + at) >>> 0, SUB);
          if (i >= 0 && !spare(i)) return i;
        }
      }
    return -1;
  }

  /** lets go of a row, and of its place among its /48's /64 keys; the rows after it move back to keep searches whole */
  private remove(i: number): void {
    if (this.kind[i] === SUB) {
      const b = this.h2[i] ?? 0;
      this.held((this.h1[i] ?? 0) * 65_536 + (b >>> 16), b & 0xffff, -1);
    }
    let hole = i;
    for (let j = (i + 1) & this.mask; this.kind[j] !== EMPTY; j = (j + 1) & this.mask) {
      const home = this.home(this.h1[j] ?? 0, this.h2[j] ?? 0);
      // the row at j stays when its home lies after the hole and no later than j, going round the table
      const stays = hole < j ? home > hole && home <= j : home > hole || home <= j;
      if (stays) continue;
      this.h1[hole] = this.h1[j] ?? 0;
      this.h2[hole] = this.h2[j] ?? 0;
      this.newest[hole] = this.newest[j] ?? 0;
      this.kind[hole] = this.kind[j] ?? EMPTY;
      this.counts.copyWithin(hole * SLOTS, j * SLOTS, j * SLOTS + SLOTS);
      hole = j;
    }
    this.kind[hole] = EMPTY;
    this.used--;
  }
}

/**
 * What one IPv6 /48 may do, in addresses' worth (A83). A caller is its /64 (clientIp.ts), and one /48 holds 65,536
 * /64s, so a limit per address alone lets anyone with a /48 act as a crowd. Every per-address limit also holds for the
 * /48 at this many addresses' worth: a household or a phone network's /64s still each get their own limit, and one
 * network cannot pose as thousands. IPv4 callers stay per address: addresses are scarce, and a /24 is often many
 * unrelated households behind one provider.
 */
export const PREFIX_SHARE = 4;

/**
 * A sender's share of a shelf that fills (A141): at most `cap`, and at most a sixteenth of what is free plus what the
 * sender already holds. The first sender on an empty shelf gets its full cap; each later one a sixteenth of what is left,
 * so filling the shelf takes many networks (about 146 to bring 256 MB down to 20 KB), not a handful.
 */
export const FREE_SHARE = 16;
export function shareOf(cap: number, free: number, theirs: number, part = FREE_SHARE): number {
  return Math.min(cap, Math.floor((free + theirs) / part));
}

/** The /64s of one /48 a limiter keeps as keys of their own; its other /64s count on the /48's share alone (A140). */
export const KEYS_PER_PREFIX = 16;

/** The /48 a /64 caller (as `callerOf` names it) belongs to; null for any other key. */
export function prefixOf(key: string): string | null {
  const m = /^([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4}):[0-9a-f]{1,4}::\/64$/.exec(key);
  return m ? `${m[1]}:${m[2]}:${m[3]}::/48` : null;
}

/** Whether `who` already holds `cap` of `owners` (one owner per thing held), or its /48 holds `cap` x PREFIX_SHARE. */
export function heldOver(owners: Iterable<string>, who: string, cap: number): boolean {
  const prefix = prefixOf(who);
  let mine = 0;
  let network = 0;
  for (const o of owners) {
    if (o === who) mine++;
    if (prefix !== null && prefixOf(o) === prefix) network++;
  }
  return mine >= cap || (prefix !== null && network >= cap * PREFIX_SHARE);
}

/**
 * A ceiling for everyone together, shared fairly (A83): at most `max` in any `windowMs`, and while several callers ask,
 * one past its share (the ceiling over the callers active in the window) is refused even when there is room, so the
 * room that opens as old calls age goes to those under their share. A caller alone may use the whole ceiling; three
 * callers running hot cannot shut out a fourth for longer than it takes their calls to age past their share. An IPv6
 * caller shares as its /48 (A116): a network asking from thousands of /64s is one asker, never thousands.
 */
export class FairCeiling {
  /** every call in the window, oldest first, from `head` */
  private calls: Array<{ at: number; key: string }> = [];
  private head = 0;
  private readonly counts = new Map<string, number>();
  /** who asked in the window, refused or not, by when they last asked (oldest first): the callers sharing the ceiling */
  private readonly askers = new Map<string, number>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys = 50_000,
  ) {}

  take(caller: string, now = Date.now()): boolean {
    const key = prefixOf(caller) ?? caller;
    this.age(now);
    this.askers.delete(key);
    while (this.askers.size >= this.maxKeys) this.askers.delete(this.askers.keys().next().value!);
    this.askers.set(key, now);
    const mine = this.counts.get(key) ?? 0;
    const share = Math.max(1, Math.floor(this.max / this.askers.size));
    if (this.calls.length - this.head >= this.max || mine >= share) return false;
    this.calls.push({ at: now, key });
    this.counts.set(key, mine + 1);
    return true;
  }

  /** Calls in the window now, for everyone. */
  inWindow(now = Date.now()): number {
    this.age(now);
    return this.calls.length - this.head;
  }

  private age(now: number): void {
    for (const [key, at] of this.askers) {
      if (now - at < this.windowMs) break;
      this.askers.delete(key);
    }
    while (this.head < this.calls.length && now - this.calls[this.head]!.at >= this.windowMs) {
      const { key } = this.calls[this.head++]!;
      const n = (this.counts.get(key) ?? 1) - 1;
      if (n > 0) this.counts.set(key, n);
      else this.counts.delete(key);
    }
    if (this.head > 1_024 && this.head * 2 > this.calls.length) {
      this.calls = this.calls.slice(this.head);
      this.head = 0;
    }
  }
}
