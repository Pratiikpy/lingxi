import { describe, expect, it } from "vitest";
import { LEASE_MS, LOCK_NAME, type LockApi, createWriter, heldElsewhere } from "./writer";
import { memoryStorage } from "./testStorage";

/** The browser's lock manager, in memory: one holder; `ifAvailable` gets null when held; `steal` takes it over. */
function memoryLocks(): LockApi {
  let holder: { reject: (e: unknown) => void } | null = null;
  return {
    request(_name, options, callback) {
      if (holder && options.ifAvailable) return Promise.resolve(callback(null));
      return new Promise((resolve, reject) => {
        if (holder && options.steal) {
          holder.reject(new DOMException("The lock request was aborted.", "AbortError"));
          holder = null;
        }
        const me = { reject };
        holder = me;
        Promise.resolve(callback({ name: "lingxi-writer" })).then(
          (v) => {
            if (holder === me) holder = null;
            resolve(v);
          },
          reject,
        );
      });
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("one writer across tabs, with Web Locks", () => {
  it("the first tab writes; a second waits; 'play here' moves the game at once and the first stops", async () => {
    const locks = memoryLocks();
    const storage = memoryStorage();
    const seen: string[] = [];
    const a = createWriter({ locks, storage, now: () => 0, onChange: (w) => seen.push(`a:${w}`) });
    const b = createWriter({ locks, storage, now: () => 0, onChange: (w) => seen.push(`b:${w}`) });
    expect(await a.acquire()).toBe(true);
    expect(await b.acquire()).toBe(false);
    expect([a.isWriter(), b.isWriter()]).toEqual([true, false]);
    expect(await b.acquire({ steal: true })).toBe(true);
    await tick();
    expect([a.isWriter(), b.isWriter()]).toEqual([false, true]);
    expect(seen).toEqual(["a:true", "b:true", "a:false"]);
  });
});

describe("one writer across tabs, without Web Locks (a lease in storage)", () => {
  it("the same rules hold, and a tab closed without a word gives its place up when its lease runs out", async () => {
    const storage = memoryStorage();
    let t = 0;
    const timers: Array<() => void> = [];
    const every = (fn: () => void) => {
      timers.push(fn);
      return () => undefined;
    };
    const renew = () => timers.forEach((f) => f());
    const a = createWriter({ storage, now: () => t, every });
    const b = createWriter({ storage, now: () => t, every });
    expect(await a.acquire()).toBe(true);
    expect(await b.acquire()).toBe(false);
    // b takes over: a notices on its next renewal and stops
    expect(await b.acquire({ steal: true })).toBe(true);
    renew();
    expect([a.isWriter(), b.isWriter()]).toEqual([false, true]);
    // b's tab closes without a word; once its lease has run out a new tab may write
    const c = createWriter({ storage, now: () => t, every: () => () => undefined });
    expect(await c.acquire()).toBe(false);
    t += LEASE_MS + 1;
    expect(await c.acquire()).toBe(true);
  });

  it("a storage that cannot be written at all leaves the tab as the only writer it can be, rather than locking the player out", async () => {
    const storage = memoryStorage(0);
    const a = createWriter({ storage, now: () => 0, every: () => () => undefined });
    expect(await a.acquire()).toBe(true);
  });
});

describe("is the game open in another tab? (A7)", () => {
  const stamp = (until: number) => JSON.stringify({ id: "other", until });
  const store = (v: string | null) => ({ getItem: () => v });

  it("asks the browser which locks are held, where it has Web Locks", async () => {
    const held = { query: async () => ({ held: [{ name: "lingxi-handheld" }, { name: LOCK_NAME }] }) };
    const free = { query: async () => ({ held: [{ name: "lingxi-handheld" }] }) };
    expect(await heldElsewhere({ locks: held, storage: store(null), now: () => 0 })).toBe(true);
    expect(await heldElsewhere({ locks: free, storage: store(stamp(9e15)), now: () => 0 })).toBe(false);
  });

  it("reads the lease stamp where there are no Web Locks: fresh is open, stale is not", async () => {
    expect(await heldElsewhere({ storage: store(stamp(10_000)), now: () => 9_000 })).toBe(true);
    expect(await heldElsewhere({ storage: store(stamp(10_000)), now: () => 11_000 })).toBe(false);
    expect(await heldElsewhere({ storage: store(null), now: () => 0 })).toBe(false);
    expect(await heldElsewhere({ storage: store("not json"), now: () => 0 })).toBe(false);
  });

  it("falls back to the stamp when the browser will not say", async () => {
    const broken = { query: async () => Promise.reject(new Error("SecurityError")) };
    expect(await heldElsewhere({ locks: broken, storage: store(stamp(10_000)), now: () => 9_000 })).toBe(true);
  });

  it("sees a writer that took the game with the lock as open", async () => {
    let held: Array<{ name: string }> = [];
    const locks: LockApi & { query(): Promise<{ held: Array<{ name: string }> }> } = {
      request: (name, _o, cb) => {
        held = [{ name }];
        return Promise.resolve(cb({ name }));
      },
      query: async () => ({ held }),
    };
    const s = memoryStorage();
    expect(await heldElsewhere({ locks, storage: s, now: () => 0 })).toBe(false);
    await createWriter({ storage: s, now: () => 0, locks }).acquire();
    expect(await heldElsewhere({ locks, storage: s, now: () => 0 })).toBe(true);
  });
});
