/**
 * P6: the back stack against a history that behaves as a browser's does: pushState takes effect at once, back() only
 * later, when the browser gets to it, with a popstate. Closing one sheet and opening the next in the same moment (the
 * builder's card handing over to the spar screen) left the history a step behind the stack, and the next close then
 * went back out of the game to a blank page (arena-starts spec, CI and local, 2026-11-24).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A browser's session history: entries, where it stands, back() applied on a later task. */
function fakeHistory() {
  const target = new EventTarget();
  const h = {
    hashes: [""] as string[],
    entries: ["game"],
    at: 0,
    pushState(_s: unknown, _t: string) {
      h.entries = [...h.entries.slice(0, h.at + 1), `entry${h.entries.length}`];
      h.hashes = [...h.hashes.slice(0, h.at + 1), h.hashes[h.at]!];
      h.at = h.entries.length - 1;
    },
    // as Chrome does it (traced 2026-11-24): the entry back() goes to is fixed when back() is called, and the move
    // happens on a later task, after any pushState made meanwhile
    back() {
      const to = h.at - 1;
      setTimeout(() => {
        if (to < 0) {
          h.left = true;
          return;
        }
        h.at = to;
        target.dispatchEvent(new Event("popstate"));
      }, 0);
    },
    /** whether back() was ever taken past the game's own first entry: the page was left */
    left: false,
    /**
     * A link followed in the page (a hash navigation): a new entry at once, and, as Chrome does it, a popstate and
     * then a hashchange for it, though nothing went back.
     */
    follow(hash: string) {
      h.entries = [...h.entries.slice(0, h.at + 1), `link${h.entries.length}`];
      h.hashes = [...h.hashes.slice(0, h.at + 1), hash];
      h.at = h.entries.length - 1;
      target.dispatchEvent(new Event("popstate"));
      target.dispatchEvent(new Event("hashchange"));
    },
  };
  return { h, target };
}

const settle = () => new Promise((done) => setTimeout(done, 5));

let env: ReturnType<typeof fakeHistory>;
let backStack: typeof import("./backStack");

beforeEach(async () => {
  env = fakeHistory();
  vi.stubGlobal("history", env.h);
  vi.stubGlobal("location", {
    get hash() {
      return env.h.hashes[env.h.at] ?? "";
    },
    get href() {
      return `https://lingxi.test/play.html${env.h.hashes[env.h.at] ?? ""}`;
    },
  });
  vi.stubGlobal("window", env.target);
  vi.resetModules();
  backStack = await import("./backStack");
});
afterEach(() => vi.unstubAllGlobals());

/** The player presses the phone's Back. */
async function pressBack() {
  env.h.back();
  await settle();
}

describe("the back stack (P6)", () => {
  it("one entry per open thing; Back closes the top one only", async () => {
    const closed: string[] = [];
    backStack.onBack(() => closed.push("sheet"));
    backStack.onBack(() => closed.push("dialog"));
    expect(env.h.at).toBe(2);
    await pressBack();
    expect(closed).toEqual(["dialog"]);
    await pressBack();
    expect(closed).toEqual(["dialog", "sheet"]);
    expect(env.h.at).toBe(0);
    expect(env.h.left).toBe(false);
  });

  it("something closed in the page takes its entry back quietly", async () => {
    const closed: string[] = [];
    const end = backStack.onBack(() => closed.push("sheet"));
    end();
    await settle();
    expect(env.h.at).toBe(0);
    expect(closed).toEqual([]);
    expect(backStack.openForBack()).toBe(0);
  });

  it("closing one and opening the next in the same moment keeps the history in step (the blank page)", async () => {
    const closed: string[] = [];
    const endCard = backStack.onBack(() => closed.push("card"));
    await settle();
    // the card's button closes the card and opens the spar screen in one go
    endCard();
    const endSpar = backStack.onBack(() => closed.push("spar"));
    await settle();
    expect(env.h.at, "one entry, the spar screen's").toBe(1);
    // the spar screen closed in the page (Escape): its entry goes, and the game stays
    endSpar();
    await settle();
    expect(env.h.at).toBe(0);
    expect(env.h.left, "the game was not left").toBe(false);
    expect(closed).toEqual([]);
  });

  it("many opens and closes in a burst end where they should", async () => {
    const ends = [backStack.onBack(() => {}), backStack.onBack(() => {})];
    ends[1]!();
    ends[0]!();
    const last = backStack.onBack(() => {});
    ends.push(backStack.onBack(() => {}));
    ends[2]!();
    await settle();
    await settle();
    expect(env.h.at).toBe(1);
    expect(backStack.openForBack()).toBe(1);
    last();
    await settle();
    expect(env.h.at).toBe(0);
    expect(env.h.left).toBe(false);
  });

  it("Back after a burst closes the one still open", async () => {
    const closed: string[] = [];
    const a = backStack.onBack(() => closed.push("a"));
    a();
    backStack.onBack(() => closed.push("b"));
    await settle();
    await pressBack();
    expect(closed).toEqual(["b"]);
    expect(env.h.at).toBe(0);
    expect(env.h.left).toBe(false);
  });

  it("names the hash its own back landed on until the next task after that hashchange (P6)", async () => {
    // the game's entry holds a link the player followed (its reader cleared nothing, as a gift's does)
    env.h.hashes = ["#gift=lxg1.x"];
    const end = backStack.onBack(() => {});
    env.h.hashes[1] = "";
    end();
    await settle();
    expect(env.h.at).toBe(0);
    expect(backStack.isOwnLanding("#gift=lxg1.x")).toBe(true);
    expect(backStack.isOwnLanding("#gift=lxg1.x"), "every reader may ask").toBe(true);
    env.target.dispatchEvent(new Event("hashchange"));
    await settle();
    expect(backStack.isOwnLanding("#gift=lxg1.x"), "gone after the hashchange's task").toBe(false);
    // a back that lands on the same hash fires no hashchange, so nothing is named
    const again = backStack.onBack(() => {});
    again();
    await settle();
    expect(backStack.isOwnLanding("#gift=lxg1.x")).toBe(false);
  });

  it("a link followed while a back of ours is on its way is the link, not our back (CI, the duel that never showed)", async () => {
    const closed: string[] = [];
    // a first-run card closes: its entry is taken back, and the back is on its way
    const card = backStack.onBack(() => closed.push("card"));
    card();
    // the player follows a duel link before that back has moved: Chrome fires a popstate for the link
    let namedOurs: boolean | null = null;
    env.target.addEventListener(
      "hashchange",
      () => (namedOurs ??= backStack.isOwnLanding("#duel=s.AAAAAAAAAAAAAAAA")),
      {
        once: true,
      },
    );
    env.h.follow("#duel=s.AAAAAAAAAAAAAAAA");
    expect(namedOurs, "the link is read, not set aside as our own landing").toBe(false);
    await settle();
    // our own back still lands, on the entry below the card's, and nothing was closed by the link
    expect(closed).toEqual([]);
    expect(backStack.openForBack()).toBe(0);
    expect(env.h.left).toBe(false);
  });

  it("a link followed while a sheet is open does not close it, as Back would", async () => {
    const closed: string[] = [];
    backStack.onBack(() => closed.push("sheet"));
    await settle();
    env.h.follow("#gift=lxg1.x");
    await settle();
    expect(closed).toEqual([]);
    expect(backStack.openForBack()).toBe(1);
  });
});
