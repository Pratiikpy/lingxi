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
const appWith = (relayer: unknown, quota = new RelayQuota({ perPetPerDay: 6, perSignerPerDay: 12, perHour: 12 }), isSettled?: (pet: string) => Promise<boolean>) =>
  createApp(null, undefined, relayer as never, new RateLimiter(1000, 3_600_000), null, undefined, isKeeper, quota, isSettled);

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

describe("sponsored tape-outs, by route (A40)", () => {
  it("a burst of signed requests for one pet, all at once, passes only its daily cap", async () => {
    const spent: string[] = [];
    // a relayer that takes its time, so every request is in flight before any finishes
    const slow = { relay: async (line: string) => (await new Promise((r) => setTimeout(r, 50)), spent.push(line), { ok: true, processor: "0xf70d324da8c1c4cb0de3ff147e53e7e9db543c4e", brainId: "99", reused: false }) };
    const app = appWith(slow, new RelayQuota({ perPetPerDay: 3, perSignerPerDay: 100, perHour: 100 }));
    const asks = await Promise.all(Array.from({ length: 8 }, async (_, i) => post(app, await signRelay(owner, "brain", "7", body), `198.51.100.${i}`)));
    expect(asks.every((r) => r.status === 200)).toBe(true);
    expect(spent, "only three tape-outs were sent").toHaveLength(3);
  });

  it("refuses a pet not yet settled once the newcomers' share is used, and says so as an answer", async () => {
    const f = fakeRelayer();
    const app = appWith(f.relayer, new RelayQuota({ perPetPerDay: 6, perSignerPerDay: 12, perHour: 4, perDay: 100, newcomerShare: 0.25, lifetime: { newcomer: 3, settled: 40 } }), async () => false);
    expect(((await (await post(app, await signRelay(owner, "brain", "7", body))).json()) as { ok: boolean }).ok).toBe(true);
    const r = await post(app, await signRelay(owner, "brain", "8", body));
    expect([r.status, await r.json()]).toEqual([200, { ok: false, reason: "newcomer" }]);
    expect(f.spent).toHaveLength(1);
  });
});

