// @vitest-environment happy-dom
/**
 * P6: a link in the address is read when the player follows it, and put aside, once, when the page's own back (taken
 * because something closed) lands on an entry that still holds it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const landed = { hash: null as string | null };
vi.mock("./backStack", () => ({
  takeOwnLanding: (h: string) => {
    if (landed.hash === null || landed.hash !== h) return false;
    landed.hash = null;
    return true;
  },
}));
const { watchLinks } = await import("./linkWatch");

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  landed.hash = null;
  history.replaceState(null, "", location.pathname);
});

describe("following a link versus our own back landing on one (P6)", () => {
  it("a link followed is read", () => {
    let read = 0;
    stop = watchLinks(() => read++, () => {});
    location.hash = "#duel=s.AAAAAAAAAAAAAAAA";
    window.dispatchEvent(new Event("hashchange"));
    expect(read).toBe(1);
  });

  it("the hash our own back landed on is put aside once, then read again if followed", () => {
    let read = 0;
    let aside = 0;
    stop = watchLinks(() => read++, () => aside++);
    history.replaceState(null, "", "#duel=s.AAAAAAAAAAAAAAAA");
    landed.hash = location.hash;
    window.dispatchEvent(new Event("hashchange"));
    expect([read, aside]).toEqual([0, 1]);
    window.dispatchEvent(new Event("hashchange"));
    expect([read, aside]).toEqual([1, 1]);
  });

  it("a different link followed while a landing waits is read", () => {
    let read = 0;
    stop = watchLinks(() => read++, () => {});
    landed.hash = "#duel=s.BBBBBBBBBBBBBBBB";
    history.replaceState(null, "", "#gift=lxg1.x");
    window.dispatchEvent(new Event("hashchange"));
    expect(read).toBe(1);
  });
});
