import { describe, expect, it } from "vitest";
import { CLOCK_KEY, createClock } from "./clock";
import { dayAtLeast } from "./days";

const H = 3_600_000;
const DAY = 24 * H;
const REAL = Date.UTC(2026, 10, 18, 9, 0, 0);

/** A device: its clock (which the player can set), real time passing, storage, and a server that may answer. */
function device(o: { deviceAhead?: number; online?: boolean; saved?: unknown } = {}) {
  let real = REAL;
  let skew = o.deviceAhead ?? 0;
  let mono = 1_000;
  let online = o.online ?? true;
  const store = new Map<string, string>();
  if (o.saved) store.set(CLOCK_KEY, JSON.stringify(o.saved));
  const clock = createClock({
    wall: () => real + skew,
    mono: () => mono,
    storage: { getItem: (k) => store.get(k) ?? null },
    write: (k, v) => void store.set(k, v),
    serverTime: async () => {
      if (!online) throw new Error("offline");
      return real;
    },
  });
  return {
    clock,
    store,
    /** real time passes, the page awake */
    pass: (ms: number) => ((real += ms), (mono += ms)),
    /** real time passes with the device asleep: the monotonic timer stands still, as some systems do */
    sleep: (ms: number) => (real += ms),
    setDevice: (ahead: number) => (skew = ahead),
    setOnline: (on: boolean) => (online = on),
    real: () => real,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("the game's clock (P1 S6)", () => {
  it("is real time once the server answers, whatever the device clock says", async () => {
    const d = device({ deviceAhead: -DAY });
    expect(await d.clock.sync()).toBe(true);
    expect(Math.abs(d.clock.now() - d.real())).toBeLessThan(10);
    d.pass(H);
    expect(Math.abs(d.clock.now() - d.real())).toBeLessThan(10);
  });

  it("cancels a device clock set back during a visit: the game neither freezes nor goes back", () => {
    const d = device({ online: false });
    const t0 = d.clock.now();
    d.pass(10 * 60_000);
    d.setDevice(-DAY);
    const t1 = d.clock.now();
    expect(t1).toBe(t0 + 10 * 60_000);
    d.pass(5 * 60_000);
    expect(d.clock.now()).toBe(t0 + 15 * 60_000);
  });

  it("offline, never starts a visit earlier than the last moment it saw, and runs on from there", () => {
    const first = device({ online: false });
    first.clock.now();
    first.pass(2 * H);
    const lastSeen = first.clock.now();
    // a later visit, the device clock now a day behind, no server
    const again = device({ online: false, deviceAhead: -DAY, saved: JSON.parse(first.store.get(CLOCK_KEY)!) });
    const start = again.clock.now();
    expect(start).toBeGreaterThanOrEqual(lastSeen);
    again.pass(30 * 60_000);
    expect(again.clock.now()).toBe(start + 30 * 60_000);
  });

  it("counts time the device slept, when the server confirms it and when the server cannot be reached", async () => {
    for (const online of [true, false]) {
      const d = device({ online });
      const t0 = d.clock.now();
      d.sleep(8 * H);
      const held = d.clock.now();
      expect(held).toBeLessThan(t0 + H);
      await settle();
      expect(Math.abs(d.clock.now() - (t0 + 8 * H))).toBeLessThan(10);
    }
  });

  it("does not believe a device clock set ahead once the server answers", async () => {
    const d = device();
    await d.clock.sync();
    const t0 = d.clock.now();
    d.pass(60_000);
    d.setDevice(7 * DAY);
    const held = d.clock.now();
    expect(held).toBeLessThan(t0 + 2 * 60_000);
    await settle();
    expect(Math.abs(d.clock.now() - d.real())).toBeLessThan(10);
  });

  it("comes back to real time after a clock that ran ahead offline, once the server answers", async () => {
    const d = device({ online: false, deviceAhead: 3 * DAY });
    const ahead = d.clock.now();
    expect(ahead - d.real()).toBeGreaterThan(2 * DAY);
    d.setOnline(true);
    await d.clock.sync();
    expect(Math.abs(d.clock.now() - d.real())).toBeLessThan(10);
  });

  it("absorbs small corrections backwards instead of running time backwards", async () => {
    const d = device({ deviceAhead: 3_000 });
    const before = d.clock.now();
    await d.clock.sync();
    expect(d.clock.now()).toBeGreaterThanOrEqual(before);
  });

  it("gives whole milliseconds, as the device clock does, whatever its correction", async () => {
    const d = device({ deviceAhead: -DAY });
    await d.clock.sync();
    for (let i = 0; i < 50; i++) {
      d.pass(37.37);
      expect(Number.isInteger(d.clock.now())).toBe(true);
    }
  });

  it("keeps what it learned for the next visit", async () => {
    const d = device({ deviceAhead: -DAY });
    await d.clock.sync();
    const saved = JSON.parse(d.store.get(CLOCK_KEY)!) as { offset: number; seen: number };
    expect(Math.abs(saved.offset - DAY)).toBeLessThan(10);
    const next = device({ online: false, deviceAhead: -DAY, saved });
    expect(Math.abs(next.clock.now() - next.real())).toBeLessThan(10);
  });
});

describe("a day only moves forward (P1 S6)", () => {
  it("keeps the latest day already used when the clock goes back, so its allowance is not handed out again", () => {
    expect(dayAtLeast("Wed Nov 18 2026", "Thu Nov 19 2026")).toBe("Thu Nov 19 2026");
    expect(dayAtLeast("Fri Nov 20 2026", "Thu Nov 19 2026")).toBe("Fri Nov 20 2026");
    // compared by the moment each day begins, not as text, where this Thursday would sort after the Monday that follows it
    expect(dayAtLeast("Mon Nov 30 2026", "Thu Nov 26 2026")).toBe("Mon Nov 30 2026");
    expect(dayAtLeast("Wed Nov 18 2026", null)).toBe("Wed Nov 18 2026");
  });
});
