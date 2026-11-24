import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { limitFor, withBodyLimits } from "../src/bodyLimits";
import { createApp, withArena, withSeason } from "../src/server";
import { createArenaStore } from "../src/arena";
import { createSeasonStore } from "../src/season";

/** A request whose body arrives in chunks with no content-length, as a caller trying to slip past a header check would send it. */
const chunked = (bytes: number) =>
  new ReadableStream({
    start(ctl) {
      const piece = new Uint8Array(16 * 1024).fill(97);
      for (let sent = 0; sent < bytes; sent += piece.length)
        ctl.enqueue(piece.subarray(0, Math.min(piece.length, bytes - sent)));
      ctl.close();
    },
  });

const app = () => {
  const a = withBodyLimits(new Hono());
  a.post("/api/teach", async (c) => c.json({ read: (await c.req.text()).length }));
  a.post("/api/move", async (c) => c.json({ read: (await c.req.text()).length }));
  return a;
};
const send = (path: string, bytes: number) =>
  app().request(path, { method: "POST", body: chunked(bytes), duplex: "half" } as RequestInit);

describe("how much a write may carry", () => {
  it("refuses an oversized body that comes in chunks with no length given", async () => {
    const r = await send("/api/teach", 64 * 1024);
    expect(r.status).toBe(413);
    // the rest of the body is not read, so the connection is closed and no client sends its next request down it
    expect(r.headers.get("connection")).toBe("close");
  });

  it("reads a body of honest size", async () => {
    const r = await send("/api/teach", 2_000);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ read: 2_000 });
  });

  it("gives each route its own room: a moving save may be large, a lesson may not", async () => {
    expect((await send("/api/move", 1024 * 1024)).status).toBe(200);
    expect((await send("/api/move", 5 * 1024 * 1024)).status).toBe(413);
    expect(limitFor("/api/pets/12/log")).toBeGreaterThan(1_300_000);
    expect(limitFor("/api/something-new")).toBe(64 * 1024);
    // a lesson in words carries the pet's whole card, up to 34,000 characters (A11)
    expect(limitFor("/api/teach")).toBeGreaterThan(34_000 + 4_000);
  });

  it("holds the server's own routes to their sizes", async () => {
    const big = "a".repeat(limitFor("/api/teach") + 1);
    const r = await createApp(null).request("/api/teach", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(big.length) },
      body: big,
    });
    expect(r.status).toBe(413);
  });
});

describe("every write route is held to the size it promises, on the bytes it reads (A49)", () => {
  /** The real season and arena routes behind the real limits, as the server mounts them. */
  const routes = () => withArena(withSeason(withBodyLimits(new Hono()), createSeasonStore()), createArenaStore());
  const entry = (bytes: number) => JSON.stringify({ device: "device-abcdefgh", pet: { name: "x".repeat(bytes) } });
  const post = (path: string, body: string, length: boolean) =>
    routes().request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(length ? { "content-length": String(body.length) } : {}) },
      body,
    } as RequestInit);
  const postChunked = (path: string, bytes: number) =>
    routes().request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: chunked(bytes),
      duplex: "half",
    } as RequestInit);

  for (const path of ["/api/season/enter", "/api/arena/snapshot"])
    it(`${path} takes a 20,000-byte card, with or without its length said, and refuses one over 48 KB either way`, async () => {
      for (const length of [true, false])
        expect((await post(path, entry(20_000), length)).status, `length given: ${length}`).not.toBe(413);
      expect((await post(path, entry(50 * 1024), true)).status).toBe(413);
      expect((await postChunked(path, 50 * 1024)).status).toBe(413);
    });

  it("voice and reminder plans are held to 2 KB and 4 KB on the bytes read, a chunked body included", () => {
    expect(limitFor("/api/voice")).toBe(2 * 1024);
    expect(limitFor("/api/push/plan")).toBe(4 * 1024);
  });
});
