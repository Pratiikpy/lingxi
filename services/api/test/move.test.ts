import { mkdirSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { PREFIX_SHARE } from "../src/limit";
import { MAX_HELD_CHARS, MAX_MOVE_CHARS, MAX_OWNER_CHARS, MOVE_TTL_MS, createMoveStore } from "../src/move";
import { withMove } from "../src/server";
import { bytesEach } from "./heap";

const save = { "lingxi.pets.v2": JSON.stringify({ active: 0, pets: [{ name: "Mochi" }] }), "lingxi.lang": "zh" };

describe("moving pets between Telegram and a browser", () => {
  it("hands a save over once, then forgets it", () => {
    const store = createMoveStore();
    const r = store.put(save);
    expect(r.ok).toBe(true);
    const code = (r as { code: string }).code;
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(store.take(code)).toEqual(save);
    expect(store.take(code)).toBeNull();
  });

  it("refuses anything that is not a Lingxi save, and expires unclaimed moves", () => {
    let t = 0;
    const store = createMoveStore(() => t);
    expect(store.put({ "other.key": "x" })).toEqual({ ok: false, reason: "invalid" });
    expect(store.put({})).toEqual({ ok: false, reason: "invalid" });
    expect(store.put({ "lingxi.x": 5 })).toEqual({ ok: false, reason: "invalid" });
    const code = (store.put(save) as { code: string }).code;
    t = MOVE_TTL_MS + 1;
    expect(store.take(code)).toBeNull();
  });

  it("works over HTTP and rejects a malformed code", async () => {
    const app = withMove(new Hono(), createMoveStore());
    const put = await app.request("/api/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ save }),
    });
    const { code } = (await put.json()) as { code: string };
    expect((await app.request("/api/move/../claim", { method: "POST" })).status).toBe(404);
    expect((await app.request("/api/move/short/claim", { method: "POST" })).status).toBe(400);
    const got = (await (await app.request(`/api/move/${code}/claim`, { method: "POST" })).json()) as {
      ok: boolean;
      save: unknown;
    };
    expect(got).toEqual({ ok: true, save });
    expect(await (await app.request(`/api/move/${code}/claim`, { method: "POST" })).json()).toEqual({
      ok: false,
      reason: "gone",
    });
  });
});

import { withSite } from "../src/server";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
describe("framing", () => {
  it("lets Telegram Web frame the game and nobody frame the other pages", async () => {
    const root = mkdtempSync(join(tmpdir(), "site-"));
    writeFileSync(join(root, "play.html"), "<p>game</p>");
    writeFileSync(join(root, "index.html"), "<p>home</p>");
    const app = withSite(new Hono(), root);
    const play = await app.request("/play.html");
    expect(play.headers.get("content-security-policy")).toContain("https://web.telegram.org");
    expect(play.headers.get("x-frame-options")).toBeNull();
    const home = await app.request("/");
    expect(home.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });
});

describe("moves waiting at once", () => {
  it("one address may have only a few, and the rest of the world is not blocked by it", () => {
    const store = createMoveStore();
    const save = { "lingxi.pets.v2": "{}" };
    for (let i = 0; i < 3; i++) expect(store.put(save, "203.0.113.9").ok).toBe(true);
    expect(store.put(save, "203.0.113.9")).toEqual({ ok: false, reason: "busy" });
    expect(store.put(save, "198.51.100.1").ok).toBe(true);
  });

  it("no few addresses fill the shelf: one holds at most a largest save and room, and a /48 four of those (A83)", () => {
    const store = createMoveStore();
    const big = { "lingxi.pets.v2": "x".repeat(MAX_MOVE_CHARS - 20) };
    expect(store.put(big, "203.0.113.9").ok).toBe(true);
    expect(store.put(big, "203.0.113.9"), "a second largest save is past one address's share").toEqual({
      ok: false,
      reason: "busy",
    });
    expect(store.put(save, "203.0.113.9").ok, "a small one still fits beside it").toBe(true);
    // a /48 holds four addresses' worth across its /64s, then the rest of them wait
    let fromNetwork = 0;
    for (let i = 0; i < 100; i++) if (store.put(big, `2001:db8:7:${i.toString(16)}::/64`).ok) fromNetwork++;
    const size = big["lingxi.pets.v2"].length + "lingxi.pets.v2".length;
    // at most four addresses' worth, and less as the shelf fills (A141)
    expect(fromNetwork).toBeGreaterThanOrEqual(1);
    expect(fromNetwork).toBeLessThanOrEqual(Math.floor((MAX_OWNER_CHARS * PREFIX_SHARE) / size));
    // so filling the whole shelf takes many networks, not seven addresses
    expect(MAX_HELD_CHARS / MAX_OWNER_CHARS).toBeGreaterThanOrEqual(16);
    expect(store.put(big, "198.51.100.1").ok, "and others still move their pets").toBe(true);
  });

  it("sixty networks posting largest saves still leave room for an honest move (A141)", () => {
    const store = createMoveStore();
    const big = { "lingxi.pets.v2": "x".repeat(MAX_MOVE_CHARS - 20) };
    // each network posts largest saves, then small ones, from many /64s, as one filling the shelf would
    const small = { "lingxi.pets.v2": "z".repeat(2_000) };
    for (let net = 0; net < 60; net++)
      for (const save of [big, small])
        for (let i = 0; i < 16; i++) store.put(save, `2001:db8:${(0x1410 + net).toString(16)}:${i.toString(16)}::/64`);
    const honest = { "lingxi.pets.v2": "y".repeat(20_000) };
    expect(store.put(honest, "203.0.113.141").ok, "a 20 KB move from someone new").toBe(true);
  });
});

describe("a waiting move's save kept in a file, not in memory (P10)", () => {
  const folder = () => mkdtempSync(join(tmpdir(), "moves-p10-"));
  const files = (dir: string) => readdirSync(dir).filter((n) => !n.endsWith(".tmp"));

  it("hands a save over once from its file, and removes the file when it is taken or expires", () => {
    let t = 0;
    const dir = folder();
    const store = createMoveStore(() => t, dir);
    const a = store.put(save) as { code: string };
    const b = store.put({ "lingxi.lang": "en" }) as { code: string };
    expect(files(dir)).toHaveLength(2);
    expect(store.take(a.code)).toEqual(save);
    expect(store.take(a.code)).toBeNull();
    expect(files(dir)).toHaveLength(1);
    t = MOVE_TTL_MS + 1;
    expect(store.take(b.code)).toBeNull();
    expect(files(dir)).toEqual([]);
  });

  it("starts when something not its own, a folder, sits in its folder, and leaves that alone", () => {
    const dir = folder();
    mkdirSync(join(dir, "kept"));
    const store = createMoveStore(Date.now, dir);
    expect(store.put(save).ok).toBe(true);
    expect(readdirSync(dir)).toContain("kept");
  });

  it("starts with an empty folder: a move never outlives the server, as before", () => {
    const dir = folder();
    const code = (createMoveStore(Date.now, dir).put(save) as { code: string }).code;
    const again = createMoveStore(Date.now, dir);
    expect(files(dir)).toEqual([]);
    expect(again.take(code)).toBeNull();
  });

  it("holds only each move's place in memory: 30 saves of a million characters in under 200 KB", async () => {
    const dir = folder();
    const [each, store] = await bytesEach(
      30,
      () => createMoveStore(Date.now, dir),
      (s) => {
        // each save parsed here from its text, as a request's body is (a repeated string would be a few shared pieces),
        // and let go once put
        for (let i = 0; i < 30; i++) {
          const body = JSON.parse(JSON.stringify({ "lingxi.save": String(i).padEnd(1_000_000, "x") })) as Record<
            string,
            string
          >;
          expect(s.put(body, `198.51.100.${i}`).ok).toBe(true);
        }
      },
    );
    expect(each * 30).toBeLessThan(200_000);
    expect(files(dir)).toHaveLength(30);
    expect(store.take("x".repeat(22))).toBeNull();
  });
});
