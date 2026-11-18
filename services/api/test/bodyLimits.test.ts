import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { limitFor, withBodyLimits } from "../src/bodyLimits";

/** A request whose body arrives in chunks with no content-length, as a caller trying to slip past a header check would send it. */
const chunked = (bytes: number) =>
  new ReadableStream({
    start(ctl) {
      const piece = new Uint8Array(16 * 1024).fill(97);
      for (let sent = 0; sent < bytes; sent += piece.length) ctl.enqueue(piece.subarray(0, Math.min(piece.length, bytes - sent)));
      ctl.close();
    },
  });

const app = () => {
  const a = withBodyLimits(new Hono());
  a.post("/api/teach", async (c) => c.json({ read: (await c.req.text()).length }));
  a.post("/api/move", async (c) => c.json({ read: (await c.req.text()).length }));
  return a;
};
const send = (path: string, bytes: number) => app().request(path, { method: "POST", body: chunked(bytes), duplex: "half" } as RequestInit);

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
  });
});
