import type { KeyValueStore } from "./save";

/** A storage like the browser's, in memory; `limit` makes it fill up the way a real one does. */
export function memoryStorage(limit = Infinity): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  const used = () => [...map].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      const before = map.get(k);
      if (used() - (before ? k.length + before.length : 0) + k.length + v.length > limit) throw new DOMException("full", "QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k) => void map.delete(k),
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
  };
}
