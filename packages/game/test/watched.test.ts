/**
 * G1: a living room while you watch. Small events arrive at a gentle pace, fixed by the pet and the beat (the same visit
 * brings the same events on any device), never two within a few minutes, and far more often than while away, so a
 * lesson about a friend, a toy or a fright has something to answer while the player is there to see it.
 */
import { describe, expect, it } from "vitest";
import { EVENT, WATCH_GAP, awayEvent, watchEvent } from "../src";

const SEED = 123_456_789;
const day = Array.from({ length: 24 * 60 }, (_, i) => watchEvent(SEED, 30_000_000 + i));

describe("events while the player watches (G1)", () => {
  it("are fixed by the pet and the beat", () => {
    expect(Array.from({ length: 500 }, (_, i) => watchEvent(SEED, 30_000_000 + i))).toEqual(day.slice(0, 500));
    expect(day.some((e, i) => e !== watchEvent(SEED + 1, 30_000_000 + i))).toBe(true);
  });

  it("come at a gentle pace: about one every few minutes, each kind present, frights the rarest", () => {
    const n = (e: number) => day.filter((x) => x === e).length;
    const all = n(EVENT.friend) + n(EVENT.toy) + n(EVENT.scary);
    expect(all).toBeGreaterThan(24 * 60 / 15);
    expect(all).toBeLessThan(24 * 60 / 4);
    expect(n(EVENT.scary)).toBeGreaterThan(0);
    expect(n(EVENT.scary)).toBeLessThan(Math.min(n(EVENT.friend), n(EVENT.toy)));
  });

  it("never come two within the gap", () => {
    const at = day.flatMap((e, i) => (e ? [i] : []));
    for (let k = 1; k < at.length; k++) expect(at[k]! - at[k - 1]!).toBeGreaterThan(WATCH_GAP);
  });

  it("are far more often than while away", () => {
    const away = Array.from({ length: 24 * 60 }, (_, i) => awayEvent(SEED, 30_000_000 + i)).filter(Boolean).length;
    expect(day.filter(Boolean).length).toBeGreaterThan(away * 3);
  });
});
