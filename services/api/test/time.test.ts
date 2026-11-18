import { describe, expect, it } from "vitest";
import { createApp } from "../src/server";

describe("the server's clock (P1)", () => {
  const app = createApp(null);

  it("answers with its time in milliseconds, never cached", async () => {
    const before = Date.now();
    const res = await app.request("/api/time");
    const { now } = (await res.json()) as { now: number };
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("is readable from any page, so the on-chain copy of the game can set its clock too", async () => {
    const res = await app.request("/api/time", { headers: { Origin: "https://1-2-419.tapekit.org" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
