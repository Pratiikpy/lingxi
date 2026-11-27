/**
 * P10: what the duel shelf keeps in memory. A link's id is the start of its code's SHA-256 in base64url (A32), cut from
 * the whole 43-character digest; kept as cut, each id held its whole digest alive. The shelf now keeps each id as a
 * string of its own. And the day's map of what each address stored was bounded only by how many addresses came that day:
 * it now holds 20,000 callers, past which newcomers share one allowance, "(others)", so a crowd of addresses cannot grow
 * it, and no newcomer gets an allowance of its own back by coming after the map is full.
 */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { duelLinkId, encodeChallenge, petCard, type DuelPet } from "@lingxi/game";
import { RateLimiter } from "../src/limit";
import { MAX_SPENDERS, createDuelStore, withDuels } from "../src/duels";
import { bytesEach } from "./heap";

const pet = (name: string): DuelPet => ({
  name,
  line: "gentle",
  stage: "adult",
  card: petCard({ lessons: [] }),
  story: { days: 9, lessons: 0, nature: [] },
});
const code = (n: number) => encodeChallenge({ id: `abcdef${String(n).padStart(10, "0")}`, from: pet("Mochi"), at: n });
const post = (app: Hono, ip: string, c: string) =>
  app.request("/api/duels", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ code: c }),
  });
const ok = async (r: Response | Promise<Response>) => ((await (await r).json()) as { ok: boolean }).ok;

describe("the duel shelf in memory (P10)", () => {
  it("keeps a link's id as a string of its own, not a cut of its digest", async () => {
    const n = 10_000;
    const [each, store] = await bytesEach(
      n,
      () => createDuelStore(undefined, { count: 100_000, chars: 1e12 }),
      async (s) => {
        // each id made here, inside the reading, as the route makes it from a code
        const ids = await Promise.all(Array.from({ length: n }, (_, i) => duelLinkId(`lxc1.code-${i}`)));
        for (let i = 0; i < n; i++) s.put(ids[i] as string, "c", 1, `10.1.${(i / 25) >> 8}.${(i / 25) & 255}`);
      },
    );
    expect(store.size()).toBe(n);
    // 300 bytes a link before (an id, its maker's codes, a 1-character code): the digest an id was cut from is no longer
    // kept with it
    expect(each).toBeLessThan(260);
  });

  it("holds MAX_SPENDERS callers a day; past them newcomers share one allowance", async () => {
    expect(MAX_SPENDERS).toBe(20_000);
    const t = Date.UTC(2026, 10, 20, 9);
    const day = code(1).length * 2;
    const app = withDuels(new Hono(), createDuelStore(), new RateLimiter(1000, 60_000), () => t, day, 2);
    expect(await ok(post(app, "203.0.113.1", code(1)))).toBe(true);
    expect(await ok(post(app, "203.0.113.2", code(2)))).toBe(true);
    // the map is full: the next two addresses share one day's allowance, two codes between them
    expect(await ok(post(app, "203.0.113.3", code(3)))).toBe(true);
    expect(await ok(post(app, "203.0.113.4", code(4)))).toBe(true);
    expect(await ok(post(app, "203.0.113.4", code(5)))).toBe(false);
    expect(await ok(post(app, "203.0.113.5", code(6)))).toBe(false);
    // the callers the map holds keep their own allowance
    expect(await ok(post(app, "203.0.113.1", code(7)))).toBe(true);
  });

  it("past the cap an IPv6 network is not given a share of its own either", async () => {
    const t = Date.UTC(2026, 10, 20, 9);
    const day = code(1).length * 2;
    const app = withDuels(new Hono(), createDuelStore(), new RateLimiter(1000, 60_000), () => t, day, 1);
    expect(await ok(post(app, "203.0.113.1", code(1)))).toBe(true);
    expect(await ok(post(app, "2001:db8:5:1::1", code(2)))).toBe(true);
    expect(await ok(post(app, "2001:db8:5:2::1", code(3)))).toBe(true);
    expect(await ok(post(app, "2001:db8:6:1::1", code(4)))).toBe(false);
  });
});
