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

  take(key: string, now = Date.now()): boolean {
    const held = this.hits.get(key);
    const recent = held ? held.filter((t) => now - t < this.windowMs) : [];
    // moved to the most-recent end on every request
    if (held) this.hits.delete(key);
    else while (this.hits.size >= this.maxKeys) this.hits.delete(this.hits.keys().next().value!);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** How many keys are remembered. */
  size(): number {
    return this.hits.size;
  }
}
