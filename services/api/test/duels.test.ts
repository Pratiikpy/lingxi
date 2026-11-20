/**
 * A32: short duel links. The server keeps a duel code under the start of its SHA-256, so the link carries only that
 * id; it keeps only real challenges and results, and refuses everything else without keeping it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { duelLinkId, encodeChallenge, encodeResult, decodeChallenge, petCard, type DuelPet } from "@lingxi/game";
import { RateLimiter } from "../src/limit";
import { MAKER_SHARE, createDuelStore, withDuels } from "../src/duels";

const pet = (name: string): DuelPet => ({ name, line: "gentle", stage: "adult", card: petCard({ lessons: [] }), story: { days: 9, lessons: 0, nature: [] } });
const challenge = encodeChallenge({ id: "abcdef0123456789", from: pet("Mochi"), at: 1 });

function server(limit = 30) {
  const store = createDuelStore();
  const app = withDuels(new Hono(), store, new RateLimiter(limit, 60_000));
  const post = (code: unknown) => app.request("/api/duels", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" }, body: JSON.stringify({ code }) });
  return { app, store, post };
}

describe("short duel links on the server (A32)", () => {
  it("keeps a challenge under the start of its own hash, and gives it back", async () => {
    const s = server();
    const r = await s.post(challenge);
    expect(r.status).toBe(200);
    const { id } = (await r.json()) as { id: string };
    expect(id).toBe(await duelLinkId(challenge));
    const back = await s.app.request(`/api/duels/${id}`);
    expect(await back.json()).toEqual({ ok: true, code: challenge });
    expect(back.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("keeps a result too, and the same code twice is one entry", async () => {
    const s = server();
    const result = encodeResult({ challenge: decodeChallenge(challenge), reply: pet("Tofu") });
    const a = (await (await s.post(result)).json()) as { id: string };
    const b = (await (await s.post(result)).json()) as { id: string };
    expect(a.id).toBe(b.id);
    expect(s.store.size()).toBe(1);
  });

  it("refuses what is not a duel, and keeps nothing of it", async () => {
    const s = server();
    for (const bad of ["hello", `${challenge.slice(0, -8)}AAAAAAAA`, "lxc1.!!!", 42, null, `lxx1.${challenge.slice(5)}`]) {
      const r = await s.post(bad);
      expect(r.status, String(bad).slice(0, 20)).toBe(400);
    }
    expect(s.store.size()).toBe(0);
  });

  it("answers an id it does not keep with ok: false (not an error a browser would log), and refuses a malformed one", async () => {
    const s = server();
    const r = await s.app.request("/api/duels/AAAAAAAAAAAAAAAA");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: false, reason: "unknown" });
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect((await s.app.request("/api/duels/not-an-id")).status).toBe(400);
  });

  it("limits how fast one address may make links, and says so as an answer (the game keeps its long link)", async () => {
    const s = server(2);
    expect((await s.post(challenge)).status).toBe(200);
    expect((await s.post(challenge)).status).toBe(200);
    const r = await s.post(challenge);
    expect([r.status, await r.json()]).toEqual([200, { ok: false, reason: "busy" }]);
  });

  it("keeps each code in its own file, reads them back after a restart, and lets the oldest go past its limits", () => {
    const dir = mkdtempSync(join(tmpdir(), "lingxi-duels-"));
    try {
      const a = createDuelStore(dir, { count: 2, chars: 1_000_000 });
      a.put("AAAAAAAAAAAAAAAA", "lxc1.one", 1);
      a.put("BBBBBBBBBBBBBBBB", "lxc1.two", 2);
      const b = createDuelStore(dir, { count: 2, chars: 1_000_000 });
      expect(b.get("AAAAAAAAAAAAAAAA")).toBe("lxc1.one");
      b.put("CCCCCCCCCCCCCCCC", "lxc1.three", 3);
      expect(b.size()).toBe(2);
      expect(b.get("CCCCCCCCCCCCCCCC")).toBe("lxc1.three");
      expect([b.get("AAAAAAAAAAAAAAAA"), b.get("BBBBBBBBBBBBBBBB")].filter(Boolean)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("one address cannot push out the duel links people share (A51)", () => {
  const code = (n: number) => encodeChallenge({ id: `abcdef01234567${String(n).padStart(2, "0")}`, from: pet("Mochi"), at: n });
  const at = (ip: string, app: Hono, c: string) => app.request("/api/duels", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ code: c }) });

  it("an address past its day's characters is refused as an answer, another is not, and a new day lets it post again", async () => {
    let t = Date.UTC(2026, 10, 20, 9);
    const app = withDuels(new Hono(), createDuelStore(), new RateLimiter(1000, 60_000), () => t, code(1).length * 2);
    expect(((await (await at("203.0.113.5", app, code(1))).json()) as { ok: boolean }).ok).toBe(true);
    expect(((await (await at("203.0.113.5", app, code(2))).json()) as { ok: boolean }).ok).toBe(true);
    const r = await at("203.0.113.5", app, code(3));
    expect([r.status, await r.json()]).toEqual([200, { ok: false, reason: "busy" }]);
    // a code already kept costs nothing again
    expect(((await (await at("203.0.113.5", app, code(1))).json()) as { ok: boolean }).ok).toBe(true);
    expect(((await (await at("198.51.100.5", app, code(3))).json()) as { ok: boolean }).ok, "another address is not held up").toBe(true);
    t += 86_400_000;
    expect(((await (await at("203.0.113.5", app, code(4))).json()) as { ok: boolean }).ok, "a new day").toBe(true);
  });

  it("when full, the link nobody has opened for longest goes first, so links people still open are kept", () => {
    // minutes apart: an opening is noted at most once a minute
    let t = Date.UTC(2026, 10, 20, 9);
    const store = createDuelStore(undefined, { count: 2, chars: 1_000_000 }, () => t);
    store.put("AAAAAAAAAAAAAAAA", "lxc1.one", t);
    t += 120_000;
    store.put("BBBBBBBBBBBBBBBB", "lxc1.two", t);
    t += 120_000;
    expect(store.get("AAAAAAAAAAAAAAAA")).toBe("lxc1.one");
    t += 120_000;
    store.put("CCCCCCCCCCCCCCCC", "lxc1.three", t);
    expect([store.get("AAAAAAAAAAAAAAAA"), store.get("BBBBBBBBBBBBBBBB"), store.get("CCCCCCCCCCCCCCCC")]).toEqual(["lxc1.one", null, "lxc1.three"]);
  });

  it("the order links were kept and opened in survives a restart, whatever the real date (A96)", () => {
    for (const base of [Date.UTC(2001, 0, 1), Date.UTC(2099, 0, 1)]) {
      const dir = mkdtempSync(join(tmpdir(), "lingxi-duels-"));
      try {
        let t = base;
        const a = createDuelStore(dir, { count: 2, chars: 1_000_000 }, () => t);
        a.put("AAAAAAAAAAAAAAAA", "lxc1.one", t);
        t += 60_000;
        a.put("BBBBBBBBBBBBBBBB", "lxc1.two", t);
        t += 3_600_000;
        expect(a.get("AAAAAAAAAAAAAAAA")).toBe("lxc1.one");
        t += 60_000;
        const b = createDuelStore(dir, { count: 2, chars: 1_000_000 }, () => t);
        b.put("CCCCCCCCCCCCCCCC", "lxc1.three", t);
        expect([b.get("AAAAAAAAAAAAAAAA"), b.get("BBBBBBBBBBBBBBBB")], new Date(base).toISOString()).toEqual(["lxc1.one", null]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("a link's last opening survives a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "lingxi-duels-"));
    try {
      let t = Date.UTC(2026, 10, 20, 9);
      const a = createDuelStore(dir, { count: 2, chars: 1_000_000 }, () => t);
      a.put("AAAAAAAAAAAAAAAA", "lxc1.one", t);
      t += 60_000;
      a.put("BBBBBBBBBBBBBBBB", "lxc1.two", t);
      t += 3_600_000;
      expect(a.get("AAAAAAAAAAAAAAAA")).toBe("lxc1.one");
      t += 60_000;
      const b = createDuelStore(dir, { count: 2, chars: 1_000_000 }, () => t);
      b.put("CCCCCCCCCCCCCCCC", "lxc1.three", t);
      expect([b.get("AAAAAAAAAAAAAAAA"), b.get("BBBBBBBBBBBBBBBB")]).toEqual(["lxc1.one", null]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});


describe("no few makers hold the duel shelf, however often they open their links (A83)", () => {
  const ids = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${String(i).padStart(16 - tag.length, "0")}`);

  it("one maker holds at most its share, its own least opened going first; others are not touched; a restart keeps it", () => {
    const dir = mkdtempSync(join(tmpdir(), "lingxi-duels-"));
    try {
      let t = 1_000;
      const limits = { count: 200 * 2, chars: 1_000_000_000 };
      const a = createDuelStore(dir, limits, () => t);
      expect(Math.floor(limits.count * MAKER_SHARE)).toBe(2);
      const [x1, x2, x3, x4] = ids(4, "X");
      const [y1] = ids(1, "Y");
      a.put(y1!, "lxc1.y", t++, "198.51.100.1");
      a.put(x1!, "lxc1.x1", t++, "203.0.113.9");
      a.put(x2!, "lxc1.x2", t++, "203.0.113.9");
      // the maker keeps opening its first link, so it is the second that is least opened
      t += 120_000;
      expect(a.get(x1!)).toBe("lxc1.x1");
      a.put(x3!, "lxc1.x3", t++, "203.0.113.9");
      expect([a.has(x1!), a.has(x2!), a.has(x3!), a.has(y1!)]).toEqual([true, false, true, true]);
      // after a restart, the shelf still knows who made what
      t += 120_000;
      const b = createDuelStore(dir, limits, () => t);
      b.put(x4!, "lxc1.x4", t++, "203.0.113.9");
      expect([b.has(x1!), b.has(x3!), b.has(x4!), b.has(y1!)]).toEqual([false, true, true, true]);
      expect(b.get(x4!)).toBe("lxc1.x4");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an IPv6 /48 holds four makers' worth across its /64s", () => {
    let t = 1_000;
    const store = createDuelStore(undefined, { count: 200 * 2, chars: 1_000_000_000 }, () => t);
    const all = ids(40, "N");
    all.forEach((id, i) => store.put(id, `lxc1.${i}`, t++, `2001:db8:7:${i.toString(16)}::/64`));
    expect(all.filter((id) => store.has(id))).toHaveLength(2 * 4);
  });
});
