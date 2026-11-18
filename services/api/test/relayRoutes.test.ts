import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { signRelay } from "@lingxi/chain";
import { RateLimiter } from "../src/limit";
import { RelayQuota } from "../src/relayGate";
import { createApp } from "../src/server";

const owner = privateKeyToAccount(generatePrivateKey());
const sitter = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const keepers: Record<string, string[]> = { "7": [owner.address, sitter.address], "8": [owner.address] };
const isKeeper = async (pet: string, who: string) => (keepers[pet] ?? []).some((k) => k.toLowerCase() === who.toLowerCase());

/** A relayer that tapes out nothing: it counts what would have cost OKB. */
function fakeRelayer(opts: { reused?: boolean } = {}) {
  const spent: string[] = [];
  return {
    spent,
    relayer: {
      relay: async (line: string) => {
        if (!opts.reused) spent.push(line);
        return { ok: true, processor: "0xf70d324da8c1c4cb0de3ff147e53e7e9db543c4e", brainId: "99", reused: !!opts.reused };
      },
    },
  };
}
const body = { line: "gentle", lessons: [] };
const post = (app: ReturnType<typeof createApp>, json: unknown, ip = "203.0.113.9") =>
  app.request("/api/tapeout", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify(json) });
const appWith = (relayer: unknown, quota = new RelayQuota({ perPetPerDay: 6, perSignerPerDay: 12, perHour: 12 })) =>
  createApp(null, undefined, relayer as never, new RateLimiter(1000, 3_600_000), null, undefined, isKeeper, quota);

describe("POST /api/tapeout", () => {
  it("tapes out for the pet's owner or its sitter", async () => {
    const f = fakeRelayer();
    const app = appWith(f.relayer);
    for (const who of [owner, sitter]) expect((await post(app, await signRelay(who, "brain", "7", body))).status).toBe(200);
    expect(f.spent).toHaveLength(2);
  });

  it("refuses an unsigned request, a stranger, a replay and a request sent to the wrong route", async () => {
    const f = fakeRelayer();
    const app = appWith(f.relayer);
    expect((await post(app, body)).status).toBe(400);
    expect((await post(app, await signRelay(stranger, "brain", "7", body))).status).toBe(403);
    const once = await signRelay(owner, "brain", "7", body);
    expect((await post(app, once)).status).toBe(200);
    expect((await post(app, once)).status).toBe(401);
    expect((await post(app, await signRelay(owner, "child", "7", body))).status).toBe(400);
    expect(f.spent).toHaveLength(1);
  });

  it("stops a keeper at the pet's daily quota, even from many addresses", async () => {
    const f = fakeRelayer();
    const app = appWith(f.relayer, new RelayQuota({ perPetPerDay: 3, perSignerPerDay: 100, perHour: 100 }));
    // a refusal for quota is the server's gentle "busy" (200, reason busy, Retry-After), as on every route
    const answers: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await post(app, await signRelay(owner, "brain", "7", body), `198.51.100.${i}`);
      const j = (await r.json()) as { ok: boolean; reason?: string };
      answers.push(j.ok ? "taped" : (j.reason ?? "?"));
    }
    expect(answers).toEqual(["taped", "taped", "taped", "busy", "busy", "busy"]);
    expect(f.spent).toHaveLength(3);
  });

  it("does not charge a pet for a brain that already exists", async () => {
    const f = fakeRelayer({ reused: true });
    const app = appWith(f.relayer, new RelayQuota({ perPetPerDay: 1, perSignerPerDay: 1, perHour: 1 }));
    for (let i = 0; i < 4; i++) expect((await post(app, await signRelay(owner, "brain", "7", body))).status).toBe(200);
  });

  it("is off when the server cannot check keepers on chain", async () => {
    const app = createApp(null, undefined, fakeRelayer().relayer as never);
    expect((await post(app, await signRelay(owner, "brain", "7", body))).status).toBe(503);
  });
});
