import { describe, expect, it } from "vitest";
import { FairCeiling, KEYS_PER_PREFIX, PREFIX_SHARE, RateLimiter, heldOver, prefixOf } from "../src/limit";

describe("the per-address limiter", () => {
  it("limits one address and leaves another alone", () => {
    const l = new RateLimiter(2, 60_000);
    expect([l.take("a", 0), l.take("a", 1), l.take("a", 2), l.take("b", 3)]).toEqual([true, true, false, true]);
    expect(l.take("a", 60_001)).toBe(true);
  });

  it("holds at most so many addresses, so a crowd of new ones cannot grow it without end", () => {
    const l = new RateLimiter(5, 3_600_000, 1_000);
    for (let i = 0; i < 4; i++) l.take("busy", i);
    for (let i = 0; i < 25_000; i++) l.take(`10.0.${i >> 8}.${i & 255}`, 10 + i);
    expect(l.size()).toBeLessThanOrEqual(1_000);
    // an address that came before the crowd is still remembered, and still limited (A113)
    expect(l.take("busy", 30_010)).toBe(true);
    expect(l.take("busy", 30_011)).toBe(false);
  });
});

describe("no flood of callers resets a limit while its window runs (A113)", () => {
  const HOUR = 3_600_000;
  const net = (i: number) => `2001:db8:9:${i.toString(16)}::/64`;

  it("a refused caller with nothing in its window is not remembered", () => {
    const l = new RateLimiter(2, HOUR, 1_000);
    // the /48's share is spent by its first eight /64s; every later /64 is refused and leaves nothing behind
    for (let i = 0; i < 500; i++) l.take(net(i), i);
    expect(l.size(), "eight /64s with hits and the /48 itself").toBe(2 * PREFIX_SHARE + 1);
  });

  it("when full, keys whose window has passed go first, and a caller still in its window keeps its count", () => {
    const l = new RateLimiter(2, 1_000, 10);
    for (let i = 0; i < 9; i++) l.take(`10.1.0.${i}`, 0);
    expect([l.take("victim", 500), l.take("victim", 501), l.take("victim", 502)]).toEqual([true, true, false]);
    // the nine early callers' windows have passed; nine newcomers take their places
    for (let i = 0; i < 9; i++) expect(l.take(`10.2.0.${i}`, 1_200)).toBe(true);
    expect(l.take("victim", 1_201), "still refused: its window runs to 1,500").toBe(false);
  });

  it("when every key is still in its window, a newcomer waits rather than reset anyone", () => {
    const l = new RateLimiter(2, 1_000, 10);
    expect([l.take("victim", 0), l.take("victim", 1), l.take("victim", 2)]).toEqual([true, true, false]);
    for (let i = 0; i < 9; i++) l.take(`10.3.0.${i}`, 10);
    for (let i = 0; i < 5_000; i++) expect(l.take(`10.4.${i >> 8}.${i & 255}`, 20)).toBe(false);
    expect(l.take("victim", 30), "the flood did not reset it").toBe(false);
    expect(l.size()).toBe(10);
    // once windows pass, newcomers are let in again
    expect(l.take("10.5.0.1", 1_011)).toBe(true);
  });

  it("one /48 cannot fill the limiter: it adds at most its share of callers in a window", () => {
    const l = new RateLimiter(5, HOUR, 50_000);
    for (let i = 0; i < 50_000; i++) l.take(net(i), i);
    expect(l.size()).toBeLessThanOrEqual(5 * PREFIX_SHARE + 1);
    l.take("198.51.100.9", 60_000);
    for (let i = 0; i < 4; i++) l.take("198.51.100.9", 60_001 + i);
    expect(l.take("198.51.100.9", 60_010), "an IPv4 caller's count holds").toBe(false);
  });
});

describe("a few dozen networks cannot fill a limiter (A140)", () => {
  const HOUR = 3_600_000;
  const sub = (net: number, i: number) => `2001:db8:${(0x1400 + net).toString(16)}:${i.toString(16)}::/64`;

  it("one /48 holds at most KEYS_PER_PREFIX of its /64s; the rest count on the /48 alone", () => {
    const l = new RateLimiter(240, HOUR);
    for (let i = 0; i < 960; i++) l.take(sub(1, i), i);
    expect(l.size(), "16 /64s and the /48").toBeLessThanOrEqual(KEYS_PER_PREFIX + 1);
  });

  it("53 /48s against a 240-an-hour limiter leave room for newcomers, IPv4 and IPv6", () => {
    const l = new RateLimiter(240, HOUR, 50_000);
    let t = 0;
    for (let net = 0; net < 53; net++) for (let i = 0; i < 960; i++) l.take(sub(net, i), t++);
    expect(l.take("198.51.100.140", t++), "a new IPv4 caller").toBe(true);
    expect(l.take("2001:db8:ffff:1::/64", t++), "a new IPv6 caller").toBe(true);
  });

  it("a full limiter makes room from the most crowded /48 before it turns a newcomer away", () => {
    const l = new RateLimiter(5, HOUR, 40);
    let t = 0;
    // one /48 with 16 /64s, and 23 IPv4 callers: 16 + 1 + 23 = 40 keys, all inside their window
    for (let i = 0; i < KEYS_PER_PREFIX; i++) l.take(sub(7, i), t++);
    for (let i = 0; i < 23; i++) l.take(`10.140.0.${i}`, t++);
    expect(l.size()).toBe(40);
    expect(l.take("10.140.1.1", t++), "room was made from the crowded /48").toBe(true);
    // an IPv4 caller still inside its window keeps its count
    for (let i = 0; i < 4; i++) l.take("10.140.0.0", t++);
    expect(l.take("10.140.0.0", t++)).toBe(false);
  });
});

describe("one IPv6 /48 counts as four addresses, not 65,536 (A83)", () => {
  const net = (i: number) => `2001:db8:7:${i.toString(16)}::/64`;

  it("names a /64 caller's /48, and nothing for an IPv4 caller or another key", () => {
    expect(prefixOf("2001:db8:7:1a::/64")).toBe("2001:db8:7::/48");
    expect([prefixOf("198.51.100.4"), prefixOf("local"), prefixOf("all")]).toEqual([null, null, null]);
  });

  it("a limit per address holds for the /48 at four addresses' worth, and leaves another /48 alone", () => {
    const l = new RateLimiter(3, 60_000);
    let passed = 0;
    for (let i = 0; i < 100; i++) for (let k = 0; k < 3; k++) if (l.take(net(i), i)) passed++;
    expect(passed, "the /48 had four addresses' worth").toBe(3 * PREFIX_SHARE);
    expect(l.take("2001:db8:8:1::/64", 200), "another /48").toBe(true);
    expect(l.take("198.51.100.9", 201), "an IPv4 caller").toBe(true);
  });

  it("what an address holds is limited for the address and for its /48", () => {
    const owners = [net(1), net(1), net(2), net(3), net(4), net(5), net(6), net(7)];
    expect(heldOver(owners, net(1), 2), "net 1 holds its two").toBe(true);
    expect(heldOver(owners, net(9), 2), "the /48 holds 8 = 2 x 4").toBe(true);
    expect(heldOver(owners, "2001:db8:8:1::/64", 2), "another /48 holds none").toBe(false);
    expect(heldOver(["198.51.100.1"], "198.51.100.2", 1), "IPv4 addresses are their own").toBe(false);
  });
});

describe("a ceiling for everyone is shared fairly (A83)", () => {
  it("three callers running hot cannot shut out a fourth, and the ceiling holds", () => {
    const c = new FairCeiling(30, 60_000);
    let t = 0;
    // three heavy callers ask without pause for two minutes, as a steady load
    for (let i = 0; i < 800; i++) {
      t += 150;
      for (const k of ["a", "b", "c"]) c.take(k, t);
    }
    expect(c.inWindow(t), "they fill the ceiling, and never pass it").toBe(30);
    // a fourth arrives while they keep asking; within the minute it gets its share
    let fourth = 0;
    for (let i = 0; i < 400; i++) {
      t += 150;
      for (const k of ["a", "b", "c"]) c.take(k, t);
      if (c.take("d", t)) fourth++;
    }
    // 400 steps of 150 ms is one minute: a fair quarter of 30 is 7.5
    expect(fourth, "the newcomer is served about a fair quarter of the minute").toBeGreaterThanOrEqual(6);
    expect(c.inWindow(t), "and the ceiling still holds").toBeLessThanOrEqual(30);
  });

  it("one caller alone may use the whole ceiling", () => {
    const c = new FairCeiling(10, 60_000);
    const got = Array.from({ length: 12 }, (_, i) => c.take("solo", i)).filter(Boolean).length;
    expect(got).toBe(10);
  });

  it("one /48 asking from thousands of /64s is one asker, so two players still get their share (A116)", () => {
    const c = new FairCeiling(1_800, 60_000);
    let served = 0;
    for (let i = 0; i < 2_400; i++) if (c.take(`2001:db8:48:${i.toString(16)}::/64`, i / 10)) served++;
    expect(served, "the /48 alone may use the whole ceiling while no one else asks").toBe(1_800);
    // two honest players arrive within the minute; the /48 keeps asking
    let honest = 0;
    for (let i = 0; i < 30; i++) {
      c.take(`2001:db8:48:${(3_000 + i).toString(16)}::/64`, 300 + i);
      if (c.take("198.51.100.1", 300 + i)) honest++;
      if (c.take("2001:db8:99:1::/64", 300 + i)) honest++;
    }
    expect(c.inWindow(330)).toBeLessThanOrEqual(1_800);
    // while the ceiling is full nobody is served; as the /48's calls age, the two players are served first
    let later = 0;
    for (let i = 0; i < 600; i++) {
      const t = 60_000 + i * 10;
      c.take(`2001:db8:48:${(5_000 + i).toString(16)}::/64`, t);
      if (c.take("198.51.100.1", t)) later++;
      if (c.take("2001:db8:99:1::/64", t)) later++;
    }
    expect(honest + later, "the two players were served").toBeGreaterThan(400);
  });
});
