import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { MOVE_TTL_MS, createMoveStore } from "../src/move";
import { withMove } from "../src/server";

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
    const put = await app.request("/api/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ save }) });
    const { code } = (await put.json()) as { code: string };
    expect((await app.request("/api/move/../claim", { method: "POST" })).status).toBe(404);
    expect((await app.request("/api/move/short/claim", { method: "POST" })).status).toBe(400);
    const got = (await (await app.request(`/api/move/${code}/claim`, { method: "POST" })).json()) as { ok: boolean; save: unknown };
    expect(got).toEqual({ ok: true, save });
    expect(await (await app.request(`/api/move/${code}/claim`, { method: "POST" })).json()).toEqual({ ok: false, reason: "gone" });
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
