import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { clientIp } from "../src/clientIp";
import { withSeason } from "../src/server";
import { createSeasonStore } from "../src/season";

const ipOf = async (headers: Record<string, string>) => {
  const app = new Hono().get("/", (c) => c.text(clientIp(c)));
  return (await app.request("/", { headers })).text();
};

describe("who is asking", () => {
  it("is the address Cloudflare saw, and never a header the caller wrote", async () => {
    expect(await ipOf({ "cf-connecting-ip": "203.0.113.9" })).toBe("203.0.113.9");
    expect(await ipOf({ "cf-connecting-ip": "2001:db8::1" })).toBe("2001:db8:0:0::/64");
    expect(
      await ipOf({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1", "x-real-ip": "198.51.100.2" }),
    ).toBe("203.0.113.9");
    expect(await ipOf({ "x-forwarded-for": "198.51.100.1", "x-real-ip": "198.51.100.2" })).toBe("local");
  });

  it("does not take a malformed address as a new caller", async () => {
    expect(await ipOf({ "cf-connecting-ip": "not an address" })).toBe("invalid");
    expect(await ipOf({ "cf-connecting-ip": `${"9".repeat(80)}` })).toBe("invalid");
  });

  it("stops one client rotating x-forwarded-for past a limit (the audit's season repro)", async () => {
    const app = withSeason(new Hono(), createSeasonStore());
    const pet = (n: number) => ({ name: `Bot${n}`, line: "bold", stage: "adult", card: "[]" });
    let accepted = 0;
    for (let i = 0; i < 80; i++) {
      const r = await app.request("/api/season/enter", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.9",
          "x-forwarded-for": `10.9.${i >> 8}.${i & 255}`,
        },
        body: JSON.stringify({
          pet: pet(i),
          device: `device-rot-${i}`,
          wallet: "0x000000000000000000000000000000000000bEEF",
        }),
      });
      if (((await r.json()) as { ok: boolean }).ok) accepted++;
    }
    expect(accepted).toBeLessThanOrEqual(30);
  });
});

describe("an IPv6 network counts as one caller (A54)", () => {
  it("two addresses in one /64 are one caller, two /64s are two, in any written form", async () => {
    const a = await ipOf({ "cf-connecting-ip": "2001:db8:1:2:aaaa::1" });
    expect(a).toBe("2001:db8:1:2::/64");
    expect(await ipOf({ "cf-connecting-ip": "2001:0DB8:0001:0002:bbbb:cccc:dddd:eeee" })).toBe(a);
    expect(await ipOf({ "cf-connecting-ip": "2001:db8:1:2::1.2.3.4" })).toBe(a);
    expect(await ipOf({ "cf-connecting-ip": "2001:db8:1:3::1" })).toBe("2001:db8:1:3::/64");
    expect(await ipOf({ "cf-connecting-ip": "::1" })).toBe("0:0:0:0::/64");
  });

  it("an IPv4 address, written plainly or mapped into IPv6, is that IPv4 address", async () => {
    expect(await ipOf({ "cf-connecting-ip": "203.0.113.9" })).toBe("203.0.113.9");
    expect(await ipOf({ "cf-connecting-ip": "::ffff:203.0.113.9" })).toBe("203.0.113.9");
    expect(await ipOf({ "cf-connecting-ip": "::FFFF:cb00:7109" })).toBe("203.0.113.9");
  });

  it("holds a caller rotating addresses inside one /64 to the season's per-address cap", async () => {
    const app = withSeason(new Hono(), createSeasonStore());
    const pet = (n: number) => ({ name: `Bot${n}`, line: "bold", stage: "adult", card: "[]" });
    let accepted = 0;
    for (let i = 0; i < 80; i++) {
      const r = await app.request("/api/season/enter", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": `2001:db8:1:2:${(i + 1).toString(16)}::1` },
        body: JSON.stringify({
          pet: pet(i),
          device: `device-six-${i}`,
          wallet: "0x000000000000000000000000000000000000bEEF",
        }),
      });
      if (((await r.json()) as { ok: boolean }).ok) accepted++;
    }
    expect(accepted).toBeLessThanOrEqual(30);
  });
});
