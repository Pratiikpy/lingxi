import { describe, expect, it } from "vitest";
import { LEASE_MS, LOCK_NAME, type LockApi, RENEW_MS, STAMP_KEY, WATCH_MS, createWriter, heldElsewhere } from "./writer";
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
  /** Tabs sharing one storage and one clock; `wait` lets time pass while a tab watches a lease, renewing the live ones. */
  function tabs() {
    const storage = memoryStorage();
    let t = 0;
    const renewers = new Map<string, () => void>();
    const alive = new Set<string>();
    const renew = () => alive.forEach((id) => renewers.get(id)?.());
    const wait = async (ms: number) => {
      for (let passed = 0; passed < ms; passed += 1_000) {
        t += 1_000;
        if (t % 2_000 === 0) renew();
      }
    };
    const open = (id: string) => {
      alive.add(id);
      const every = (fn: () => void) => {
        renewers.set(id, fn);
        return () => void renewers.delete(id);
      };
      return createWriter({ storage, now: () => t, every, wait, id });
    };
    return { storage, open, renew, wait, die: (id: string) => alive.delete(id), later: (ms: number) => (t += ms) };
  }

  it("the same rules hold: one writer, 'play here' moves the game, the first stops on its next renewal", async () => {
    const { open, renew } = tabs();
    const a = open("a");
    const b = open("b");
    expect(await a.acquire()).toBe(true);
    expect(await b.acquire()).toBe(false);
    expect(await b.acquire({ steal: true })).toBe(true);
    renew();
    expect([a.isWriter(), b.isWriter()]).toEqual([false, true]);
  });

  it("a page gives its lease up as it goes, so its own reload plays at once (A8)", async () => {
    const { open, storage } = tabs();
    const before = open("before-reload");
    expect(await before.acquire()).toBe(true);
    before.leave();
    expect(storage.getItem(STAMP_KEY)).toBeNull();
    // its last words still save (a later pagehide handler), until the next page stamps
    expect(before.isWriter()).toBe(true);
    const after = open("after-reload");
    expect(await after.acquire()).toBe(true);
    expect([before.isWriter(), after.isWriter()]).toEqual([false, true]);
  });

  it("a lease that is not renewed within the watch is a page that died without a word: it is taken over (A8)", async () => {
    const { open, die } = tabs();
    const crashed = open("crashed");
    expect(await crashed.acquire()).toBe(true);
    die("crashed");
    expect(await open("next").acquire()).toBe(true);
    expect(WATCH_MS).toBeGreaterThan(RENEW_MS);
    expect(WATCH_MS).toBeLessThan(LEASE_MS);
  });

  it("a lease renewed in time is a tab that is really open: the new one does not take it", async () => {
    const { open } = tabs();
    const live = open("live");
    expect(await live.acquire()).toBe(true);
    const second = open("second");
    expect(await second.acquire()).toBe(false);
    expect([live.isWriter(), second.isWriter()]).toEqual([true, false]);
  });

  it("a page restored from the back-forward cache takes its lease back, or yields to a tab that took the game", async () => {
    const { open, renew } = tabs();
    const a = open("a");
    expect(await a.acquire()).toBe(true);
    a.leave();
    expect(await a.rejoin()).toBe(true);
    expect(a.isWriter()).toBe(true);
    a.leave();
    const b = open("b");
    expect(await b.acquire()).toBe(true);
    expect(await a.rejoin()).toBe(false);
    renew();
    expect([a.isWriter(), b.isWriter()]).toEqual([false, true]);
  });

  it("a page that never held the game has nothing to give up or take back", async () => {
    const { open } = tabs();
    const a = open("a");
    expect(await a.acquire()).toBe(true);
    const b = open("b");
    expect(await b.acquire()).toBe(false);
    b.leave();
    expect(a.isWriter()).toBe(true);
    expect(await b.rejoin()).toBe(false);
    expect(a.isWriter()).toBe(true);
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
