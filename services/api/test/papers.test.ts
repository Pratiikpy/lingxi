import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createPapersStore, papersMessage, withPapers } from "../src/papers";
import { RateLimiter } from "../src/limit";

const owner = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const other = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const papers = JSON.stringify({ name: "Pip", line: "gentle", pendingLog: [1, 2, 3] });

function app(o: { owner?: Address; seller?: Address | null; fail?: boolean } = {}) {
  const chain = {
    ownerOf: async () => {
      if (o.fail) throw new Error("rpc");
      return o.owner ?? owner.address;
    },
    sellerOf: async () => (o.seller === undefined ? owner.address : o.seller),
  };
  return withPapers(new Hono(), createPapersStore(), chain);
}
const post = async (a: Hono, id: string, body: unknown) => {
  const r = await a.request(`/api/papers/${id}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

describe("adoption papers mailbox (plan 4.8)", () => {
  it("keeps papers signed by the owner who has the pet on offer, and hands them back", async () => {
    const a = app();
    const signature = await owner.signMessage({ message: papersMessage("7", papers) });
    expect((await post(a, "7", { papers, signature })).status).toBe(200);
    const r = await a.request("/api/papers/7");
    const got = (await r.json()) as { papers: string; signer: string };
    expect(got.papers).toBe(papers);
    expect(got.signer).toBe(owner.address.toLowerCase());
  });

  it("refuses another wallet, a pet not on offer, papers signed for another pet, and junk", async () => {
    const a = app();
    const byOther = await other.signMessage({ message: papersMessage("7", papers) });
    expect((await post(a, "7", { papers, signature: byOther })).body.reason).toBe("notOwner");
    const forOther = await owner.signMessage({ message: papersMessage("8", papers) });
    expect((await post(a, "7", { papers, signature: forOther })).body.reason).toBe("notOwner");
    const signature = await owner.signMessage({ message: papersMessage("7", papers) });
    expect((await post(app({ seller: null }), "7", { papers, signature })).body.reason).toBe("notOffered");
    expect((await post(a, "7", { papers: "not json", signature })).status).toBe(400);
    expect((await post(a, "0", { papers, signature })).status).toBe(400);
    expect((await post(a, "7", "{")).status).toBe(400);
    expect((await post(a, "7", { papers, signature: "0x12" })).status).toBe(400);
    expect((await post(app({ fail: true }), "7", { papers, signature })).status).toBe(503);
    expect(await (await a.request("/api/papers/7")).json()).toEqual({ ok: false, reason: "none" });
  });

  it("refuses papers that are too big", async () => {
    const big = JSON.stringify({ log: "x".repeat(700_000) });
    const signature = await owner.signMessage({ message: papersMessage("7", big) });
    expect((await post(app(), "7", { papers: big, signature })).status).toBe(413);
  });
});

describe("adoption papers are limited per address before any chain read (A52)", () => {
  it("an address past its posts for the hour is told busy, with no read of X Layer", async () => {
    let reads = 0;
    const chain = { ownerOf: async () => (reads++, owner.address), sellerOf: async () => owner.address };
    const a = withPapers(new Hono(), createPapersStore(), chain, Date.now, new RateLimiter(2, 3_600_000));
    const body = { papers, signature: await owner.signMessage({ message: papersMessage("7", papers) }) };
    expect((await post(a, "7", body)).body.ok).toBe(true);
    expect((await post(a, "7", body)).body.ok).toBe(true);
    const r = await post(a, "7", body);
    expect([r.status, r.body]).toEqual([200, { ok: false, reason: "busy" }]);
    expect(reads).toBe(2);
  });
});
