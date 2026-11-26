/**
 * P8: the game reports its own uncaught errors to /api/errors, so real players' bugs are seen without anyone writing
 * in. A report is its message, its place and the build, nothing else: an address, a key, an email or a long number in
 * the message is scrubbed before it is kept, each client is rate-limited, every field is capped, and the latest show
 * on /api/health.
 */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createErrorLog, scrub, withErrors } from "../src/clientErrors";
import { RateLimiter } from "../src/limit";

const post = (app: Hono, body: unknown, ip = "203.0.113.7") =>
  app.request("/api/errors", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("scrub (P8)", () => {
  it("removes what could name a player: addresses, keys and hashes, emails, long numbers", () => {
    const s = scrub(
      "not owner 0x1111111111111111111111111111111111111111 key 0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd mail me@example.com id 12345678901",
    );
    expect(s).not.toMatch(/0x[0-9a-f]{8,}/i);
    expect(s).not.toMatch(/example\.com/);
    expect(s).not.toMatch(/\d{10,}/);
    expect(s).toBe("not owner 0x… key 0x… mail … id #…");
  });

  it("leaves an ordinary error message as it is", () => {
    expect(scrub("TypeError: Cannot read properties of undefined (reading 'x')")).toBe(
      "TypeError: Cannot read properties of undefined (reading 'x')",
    );
  });
});

describe("POST /api/errors (P8)", () => {
  it("keeps a report, scrubbed, and shows it among the latest", async () => {
    const log = createErrorLog();
    const app = withErrors(new Hono(), log);
    const r = await post(app, {
      message: "Error: owner 0x2222222222222222222222222222222222222222 refused",
      where: "/assets/index-abc.js:12:34",
      build: "20261126T003332Z-eaf5077f16e5",
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    const [latest] = log.latest(5);
    expect(latest).toMatchObject({
      message: "Error: owner 0x… refused",
      where: "/assets/index-abc.js:12:34",
      build: "20261126T003332Z-eaf5077f16e5",
      count: 1,
    });
    expect(JSON.stringify(log.latest(5)), "the client's address is not kept").not.toMatch(/203\.0\.113\.7/);
  });

  it("the same error again is counted, not stored twice", async () => {
    const log = createErrorLog();
    const app = withErrors(new Hono(), log);
    for (let i = 0; i < 3; i++) await post(app, { message: "Error: boom", where: "/a.js:1:1", build: "b" });
    expect(log.latest(5)).toHaveLength(1);
    expect(log.latest(5)[0]!.count).toBe(3);
    expect(log.lastHour()).toBe(3);
  });

  it("refuses a report with a missing or oversized field, and anything that is not one", async () => {
    const app = withErrors(new Hono(), createErrorLog());
    expect((await post(app, { message: "x".repeat(301), where: "/a.js", build: "b" })).status).toBe(400);
    expect((await post(app, { where: "/a.js", build: "b" })).status).toBe(400);
    expect((await post(app, { message: "x", where: "/a.js", build: "b", player: "p" })).status).toBe(400);
    expect((await post(app, "not json")).status).toBe(400);
  });

  it("each client may send only so many", async () => {
    const log = createErrorLog();
    const app = withErrors(new Hono(), log, new RateLimiter(2, 3_600_000));
    const send = (ip: string) => post(app, { message: `Error: ${ip}`, where: "/a.js", build: "b" }, ip);
    expect((await send("198.51.100.1")).status).toBe(200);
    expect((await send("198.51.100.1")).status).toBe(200);
    const third = await send("198.51.100.1");
    expect(await third.json()).toEqual({ ok: false, reason: "busy" });
    // another client is not held back by the first
    expect((await send("198.51.100.2")).status).toBe(200);
    expect(log.lastHour()).toBe(3);
  });

  it("keeps a bounded number of distinct errors, dropping the oldest", async () => {
    const log = createErrorLog({ keep: 3 });
    const app = withErrors(new Hono(), log, new RateLimiter(100, 3_600_000));
    for (let i = 0; i < 5; i++) await post(app, { message: `Error: ${"abcde"[i]}`, where: "/a.js", build: "b" });
    expect(log.latest(10).map((e) => e.message)).toEqual(["Error: e", "Error: d", "Error: c"]);
  });
});
