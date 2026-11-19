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
import { createDuelStore, withDuels } from "../src/duels";

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

  it("limits how fast one address may make links", async () => {
    const s = server(2);
    expect((await s.post(challenge)).status).toBe(200);
    expect((await s.post(challenge)).status).toBe(200);
    expect((await s.post(challenge)).status).toBe(429);
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

