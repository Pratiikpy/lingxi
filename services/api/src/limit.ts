/**
 * A per-key sliding-window limiter: at most `max` requests per `windowMs`. It remembers at most `maxKeys` keys, so a
 * crowd of addresses each seen once cannot grow it without end: when full, the key seen least recently is forgotten
 * (a forgotten key starts afresh, which a crowd of rotating addresses already does; the limits that guard spending
 * are shared ceilings, not per-address ones).
 */
export class RateLimiter {
  /** key → its recent request times, ordered from the key seen least recently to the one seen most recently */
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys = 50_000,
  ) {}

  /** One request from `key`; an IPv6 caller is also held to its /48's share (A83). */
  take(key: string, now = Date.now()): boolean {
    const prefix = prefixOf(key);
    const own = this.recent(key, now);
    const shared = prefix === null ? null : this.recent(prefix, now);
    const ok = own.length < this.max && (shared === null || shared.length < this.max * PREFIX_SHARE);
    if (ok) {
      own.push(now);
      shared?.push(now);
    }
    this.keep(key, own);
    if (prefix !== null) this.keep(prefix, shared!);
    return ok;
  }

  private recent(key: string, now: number): number[] {
    const held = this.hits.get(key);
    return held ? held.filter((t) => now - t < this.windowMs) : [];
  }

  /** remembered at the most-recent end; when full, the key seen least recently is forgotten */
  private keep(key: string, times: number[]): void {
    if (this.hits.has(key)) this.hits.delete(key);
    else while (this.hits.size >= this.maxKeys) this.hits.delete(this.hits.keys().next().value!);
    this.hits.set(key, times);
  }

  /** How many keys are remembered. */
  size(): number {
    return this.hits.size;
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
 * callers running hot cannot shut out a fourth for longer than it takes their calls to age past their share.
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

  take(key: string, now = Date.now()): boolean {
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
