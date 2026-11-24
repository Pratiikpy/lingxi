// @vitest-environment happy-dom
/**
 * P6: a link in the address is read when the player follows it, and put aside, once, when the page's own back (taken
 * because something closed) lands on an entry that still holds it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const landed = { hash: null as string | null };
vi.mock("./backStack", () => ({ isOwnLanding: (h: string) => landed.hash !== null && landed.hash === h }));
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
    stop = watchLinks(
      () => read++,
      () => {},
    );
    location.hash = "#duel=s.AAAAAAAAAAAAAAAA";
    window.dispatchEvent(new Event("hashchange"));
    expect(read).toBe(1);
  });

  it("every reader puts aside the hash our own back landed on, not only the first to ask", () => {
    let read = 0;
    let aside = 0;
    const stops = [
      watchLinks(
        () => read++,
        () => aside++,
      ),
      watchLinks(
        () => read++,
        () => aside++,
      ),
      watchLinks(
        () => read++,
        () => aside++,
      ),
    ];
    stop = () => stops.forEach((s) => s());
    history.replaceState(null, "", "#duel=s.AAAAAAAAAAAAAAAA");
    landed.hash = location.hash;
    window.dispatchEvent(new Event("hashchange"));
    expect([read, aside]).toEqual([0, 3]);
    landed.hash = null;
    window.dispatchEvent(new Event("hashchange"));
    expect([read, aside]).toEqual([3, 3]);
  });

  it("a different link followed while a landing waits is read", () => {
    let read = 0;
    stop = watchLinks(
      () => read++,
      () => {},
    );
    landed.hash = "#duel=s.BBBBBBBBBBBBBBBB";
    history.replaceState(null, "", "#gift=lxg1.x");
    window.dispatchEvent(new Event("hashchange"));
    expect(read).toBe(1);
  });
});
