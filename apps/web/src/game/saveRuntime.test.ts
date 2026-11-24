// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LockApi } from "./writer";
import { LEASE_MS, RENEW_MS, STAMP_KEY, WATCH_MS } from "./writer";
import { type Storage, leave, reload, show, visit } from "./testGame";
import { memoryStorage } from "./testStorage";

const T0 = Date.UTC(2026, 10, 18, 9, 0, 0);
const PETS = "lingxi.pets.v2";
const WORLD = "lingxi.world.v1";
const PLAY_HERE = "lingxi.playHere";

/** Another tab's lease, as a page without Web Locks leaves it (live until `until`). */
const otherTab = (storage: Storage, until = Date.now() + LEASE_MS) =>
  storage.setItem(STAMP_KEY, JSON.stringify({ id: "the-other-tab", until }));
const stampOwner = (storage: Storage) =>
  (JSON.parse(storage.getItem(STAMP_KEY) ?? "null") as { id: string } | null)?.id ?? null;

/** The page shown again: from the back-forward cache (`persisted`) or freshly. */
const pageshow = (persisted: boolean): Event => Object.assign(new Event("pageshow"), { persisted });

/** The browser's lock manager for this test: free, held by another tab, or taken over later. */
function locksOnNavigator(o: { heldElsewhere?: boolean } = {}) {
  const asked: Array<{ ifAvailable?: boolean; steal?: boolean }> = [];
  let takeOver: (() => void) | null = null;
  const locks: LockApi = {
    request(_name, options, callback) {
      asked.push(options);
      if (o.heldElsewhere && options.ifAvailable) return Promise.resolve(callback(null));
      return new Promise((_resolve, reject) => {
        takeOver = () => reject(new DOMException("The lock request was aborted.", "AbortError"));
        void callback({ name: "lingxi-writer" });
      });
    },
  };
  Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
  return { asked, takeOver: () => takeOver?.() };
}

/** The save screens of the play page, in the language given, showing what the save rules say. */
async function saveScreens(lang: "en" | "zh") {
  const { useLang } = await import("../i18n");
  if (useLang.getState().lang !== lang) useLang.getState().toggle();
  return import("../play/SaveScreens");
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "locks");
  leave();
  sessionStorage.clear();
});

describe("the save runtime: one tab plays", () => {
  it("nothing of the game is written before this tab holds it; once it does, writes are kept with a copy of what they replace", async () => {
    const { runtime, storage } = await visit({ at: T0, claim: false });
    expect(runtime.useSaveState.getState().role).toBe("deciding");
    expect(runtime.saveWrite(WORLD, '{"coins":1}')).toBe(false);
    expect(storage.getItem(WORLD)).toBeNull();

    expect(await runtime.claimTheGame()).toEqual({ playing: true, damaged: [] });
    expect(runtime.useSaveState.getState().role).toBe("writer");
    expect(runtime.saveWrite(WORLD, '{"coins":1}')).toBe(true);
    expect(runtime.saveWrite(WORLD, '{"coins":2}')).toBe(true);
    expect([storage.getItem(WORLD), storage.getItem(`${WORLD}~copy`)]).toEqual(['{"coins":2}', '{"coins":1}']);
    expect(runtime.saveRemove(WORLD)).toBe(true);
    expect(storage.getItem(WORLD)).toBeNull();
    // preferences are not game state: any tab may change them
    expect(runtime.saveWrite("lingxi.lang", "zh")).toBe(true);
  });

  it("a page opened while the game is open in another tab says so, in both languages, and writes nothing", async () => {
    const storage = memoryStorage();
    otherTab(storage);
    const { runtime } = await visit({ at: T0, storage, claim: false });
    const claiming = runtime.claimTheGame();
    // the other tab is alive: it renews its lease while this one watches
    await vi.advanceTimersByTimeAsync(RENEW_MS);
    otherTab(storage);
    await vi.advanceTimersByTimeAsync(WATCH_MS);
    expect(await claiming).toEqual({ playing: false, damaged: [] });
    expect(runtime.useSaveState.getState().role).toBe("elsewhere");
    expect(runtime.saveWrite(PETS, '{"active":0,"pets":[]}')).toBe(false);
    expect(runtime.saveRemove(PETS)).toBe(false);
    expect(storage.getItem(PETS)).toBeNull();

    const en = await show(createElement((await saveScreens("en")).ElsewhereOverlay));
    expect(en.text()).toContain("Lingxi is open in another tab");
    expect(en.text()).toContain("Close the other tab, or move the game here.");
    expect(en.text()).toContain("Play here");
    en.unmount();
    const zh = await show(createElement((await saveScreens("zh")).ElsewhereOverlay));
    expect(zh.text()).toContain("灵犀在另一个标签页里开着");
    expect(zh.text()).toContain("在这里玩");
    zh.unmount();
  });

  it("a lease left by a page that is gone (a crash, a tab the system closed) is taken over after a moment", async () => {
    const storage = memoryStorage();
    otherTab(storage);
    const { runtime } = await visit({ at: T0, storage, claim: false });
    const claiming = runtime.claimTheGame();
    await vi.advanceTimersByTimeAsync(WATCH_MS);
    expect((await claiming).playing).toBe(true);
    expect(stampOwner(storage)).not.toBe("the-other-tab");
    expect(runtime.saveWrite(WORLD, "{}")).toBe(true);
  });

  it("a tab whose game is taken over by another stops before its next write, and shows the game is elsewhere", async () => {
    const { runtime, storage } = await visit({ at: T0 });
    expect(runtime.saveWrite(WORLD, '{"coins":1}')).toBe(true);
    otherTab(storage);
    expect(runtime.saveWrite(WORLD, '{"coins":2}')).toBe(false);
    expect(storage.getItem(WORLD)).toBe('{"coins":1}');
    await vi.advanceTimersByTimeAsync(RENEW_MS);
    expect(runtime.useSaveState.getState().role).toBe("elsewhere");
  });

  it("'Play here' reloads the page, which takes the game over from the other tab at once", async () => {
    const storage = memoryStorage();
    otherTab(storage);
    const first = await visit({ at: T0, storage, claim: false });
    const reloads = vi.spyOn(location, "reload").mockImplementation(() => undefined);
    first.runtime.playHere();
    expect(reloads).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(PLAY_HERE)).toBe("1");

    const again = await reload(storage, { at: T0, claim: false });
    otherTab(storage);
    expect(await again.runtime.claimTheGame()).toEqual({ playing: true, damaged: [] });
    expect(sessionStorage.getItem(PLAY_HERE)).toBeNull();
    expect(stampOwner(storage)).not.toBe("the-other-tab");
  });

  it("a page going away gives its lease up, and takes it back when the browser restores it from the back-forward cache", async () => {
    const { runtime, storage } = await visit({ at: T0 });
    const mine = stampOwner(storage);
    window.dispatchEvent(new Event("pagehide"));
    expect(storage.getItem(STAMP_KEY)).toBeNull();
    // still the writer for its last words
    expect(runtime.saveWrite(WORLD, "{}")).toBe(true);
    window.dispatchEvent(pageshow(false));
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.getItem(STAMP_KEY)).toBeNull();
    window.dispatchEvent(pageshow(true));
    await vi.advanceTimersByTimeAsync(0);
    expect(stampOwner(storage)).toBe(mine);
    expect(runtime.useSaveState.getState().role).toBe("writer");
  });
});

describe("the save runtime: one tab plays, with Web Locks", () => {
  it("a free lock makes this tab the writer", async () => {
    const locks = locksOnNavigator();
    const { runtime, claimed } = await visit({ at: T0 });
    expect(claimed).toEqual({ playing: true, damaged: [] });
    expect(locks.asked).toEqual([{ ifAvailable: true }]);
    expect(runtime.useSaveState.getState().role).toBe("writer");
  });

  it("a lock another tab holds leaves this one showing the game is elsewhere", async () => {
    const locks = locksOnNavigator({ heldElsewhere: true });
    const { runtime, claimed, storage } = await visit({ at: T0 });
    expect(claimed?.playing).toBe(false);
    expect(locks.asked).toEqual([{ ifAvailable: true }]);
    expect(runtime.useSaveState.getState().role).toBe("elsewhere");
    expect(runtime.saveWrite(WORLD, "{}")).toBe(false);
    expect(storage.getItem(WORLD)).toBeNull();
  });

  it("'Play here' steals the lock; a lock taken over by another tab stops this one", async () => {
    sessionStorage.setItem(PLAY_HERE, "1");
    const locks = locksOnNavigator({ heldElsewhere: true });
    const { runtime } = await visit({ at: T0 });
    expect(locks.asked).toEqual([{ steal: true }]);
    expect(runtime.useSaveState.getState().role).toBe("writer");
    // a page with Web Locks needs no lease: the browser frees the lock itself when the page goes
    window.dispatchEvent(new Event("pagehide"));
    expect(runtime.saveWrite(WORLD, "{}")).toBe(true);
    locks.takeOver();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.useSaveState.getState().role).toBe("elsewhere");
    expect(runtime.saveWrite(WORLD, "[]")).toBe(false);
  });
});

describe("the save runtime: storage that fails", () => {
  it("a full storage is reported, never thrown, and the player is told to download a save file", async () => {
    const { runtime } = await visit({ at: T0, limit: 400 });
    expect(runtime.saveWrite(WORLD, JSON.stringify({ notes: "x".repeat(500) }))).toBe(false);
    expect(runtime.useSaveState.getState().failed).toEqual({ key: WORLD, reason: "full", at: T0 });
    const en = await show(createElement((await saveScreens("en")).SaveBanner));
    expect(en.text()).toContain(
      "Lingxi couldn't save: this browser's storage is full. Download your save file to keep everything safe.",
    );
    en.unmount();
    const zh = await show(createElement((await saveScreens("zh")).SaveBanner));
    expect(zh.text()).toContain("灵犀没能保存：这个浏览器的存储空间满了。请下载存档文件，把一切保存好。");
    zh.unmount();
  });

  it("a storage the browser refuses to write is reported as blocked", async () => {
    const storage = memoryStorage();
    const refusing: Storage = Object.assign(Object.create(storage) as Storage, {
      setItem: (k: string, v: string) => {
        if (k === WORLD) throw new DOMException("The operation is insecure.", "SecurityError");
        storage.setItem(k, v);
      },
    });
    const { runtime } = await visit({ at: T0, storage: refusing });
    expect(runtime.saveWrite(WORLD, "{}")).toBe(false);
    expect(runtime.useSaveState.getState().failed).toMatchObject({ key: WORLD, reason: "blocked" });
    const en = await show(createElement((await saveScreens("en")).SaveBanner));
    expect(en.text()).toContain("this browser is not letting it store anything");
    en.unmount();
  });

  it("storage close to full is noticed on the first write, before anything is lost", async () => {
    const storage = memoryStorage();
    storage.setItem("lingxi.mail.v1", JSON.stringify({ letters: "x".repeat(3_500_000) }));
    const { runtime } = await visit({ at: T0, storage });
    expect(runtime.saveWrite(WORLD, "{}")).toBe(true);
    expect(runtime.useSaveState.getState()).toMatchObject({ nearlyFull: true, failed: null });
    const en = await show(createElement((await saveScreens("en")).SaveBanner));
    expect(en.text()).toContain(
      "This browser's storage for Lingxi is nearly full. Download your save file to keep a copy.",
    );
    en.unmount();
  });

  it("with storage blocked entirely, the game still plays this visit, kept in memory", async () => {
    const blocked = {
      getItem: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    };
    const { runtime, claimed } = await visit({ at: T0, localStorage: blocked });
    expect(claimed).toEqual({ playing: true, damaged: [] });
    expect(runtime.saveWrite(WORLD, '{"coins":3}')).toBe(true);
    expect(runtime.saves.read(WORLD)).toBe('{"coins":3}');
    expect(runtime.saves.usedChars()).toBeGreaterThan(0);
    expect(runtime.saveRemove(WORLD)).toBe(true);
    expect(runtime.saves.read(WORLD)).toBeNull();
  });

  it("with no storage at all, and no session storage, the game still plays and 'Play here' still reloads", async () => {
    const refuse = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    vi.stubGlobal("sessionStorage", { getItem: refuse, setItem: refuse, removeItem: refuse });
    const { runtime, claimed } = await visit({ at: T0, localStorage: undefined });
    expect(claimed?.playing).toBe(true);
    expect(runtime.saveWrite(WORLD, "{}")).toBe(true);
    const reloads = vi.spyOn(location, "reload").mockImplementation(() => undefined);
    runtime.playHere();
    expect(reloads).toHaveBeenCalledTimes(1);
  });
});

describe("the save runtime: a damaged save", () => {
  it("is kept aside at start, reported, and never written over until the player chooses", async () => {
    const storage = memoryStorage();
    storage.setItem(PETS, '{"active":0,"pets":[{"na');
    storage.setItem(`${PETS}~copy`, '{"active":0,"pets":[]}');
    const { runtime, claimed } = await visit({ at: T0, storage });
    expect(claimed?.damaged).toEqual([{ key: PETS, why: "unreadable" }]);
    expect(runtime.useSaveState.getState().damaged).toEqual([{ key: PETS, why: "unreadable" }]);
    expect(storage.getItem(`${PETS}~damaged`)).toBe('{"active":0,"pets":[{"na');
    expect(runtime.saveWrite(PETS, '{"active":0,"pets":[]}')).toBe(false);
    expect(storage.getItem(PETS)).toBe('{"active":0,"pets":[{"na');
    // the last good copy can be read by this build, so it is offered; choosing it puts it back
    expect(runtime.copyUsable(PETS)).toBe(true);
    expect(runtime.saves.useCopy(PETS)).toBe(true);
    expect(runtime.saveWrite(PETS, '{"active":0,"pets":[]}')).toBe(true);
  });

  it("the last good copy is offered only when this build can read it", async () => {
    const storage = memoryStorage();
    storage.setItem(`${PETS}~copy`, '{"active":0}');
    storage.setItem(`${WORLD}~copy`, '{"version":1');
    storage.setItem("lingxi.device.v1~copy", "0123456789abcdef");
    storage.setItem("lingxi.garden.v1~copy", '{"plots":[]}');
    const { runtime } = await visit({ at: T0, storage });
    expect(runtime.copyUsable(PETS)).toBe(false);
    expect(runtime.copyUsable(WORLD)).toBe(false);
    expect(runtime.copyUsable("lingxi.badges.v1")).toBe(false);
    expect(runtime.copyUsable("lingxi.device.v1")).toBe(true);
    expect(runtime.copyUsable("lingxi.garden.v1")).toBe(true);
  });

  it("a save from a newer Lingxi is held as newer, with every reader this build has", async () => {
    const storage = memoryStorage();
    storage.setItem(WORLD, JSON.stringify({ version: 2 }));
    storage.setItem("lingxi.badges.v1", "[]");
    const { claimed, runtime } = await visit({ at: T0, storage });
    expect(claimed?.damaged).toEqual(
      expect.arrayContaining([
        { key: WORLD, why: "newer" },
        { key: "lingxi.badges.v1", why: "unreadable" },
      ]),
    );
    expect(Object.keys(runtime.READERS)).toEqual(expect.arrayContaining([PETS, WORLD, "lingxi.chain.v2"]));
  });
});
