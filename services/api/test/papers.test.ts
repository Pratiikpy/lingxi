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
  const r = await a.request(`/api/papers/${id}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
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

describe("the papers store writes safely (A64), one pet at a time, and makes room (A83)", () => {
  it("a write that fails part way leaves the papers already kept whole, and later writes go through", async () => {
    const { mkdtempSync, mkdirSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const file = join(mkdtempSync(join(tmpdir(), "papers-")), "papers.json");
    const store = createPapersStore(file);
    store.put("7", { papers, signer: owner.address, at: 1 });
    // pet 8's place cannot be written (something is in the way), as when the disk fails
    mkdirSync(join(file.replace(/\.json$/, ""), "8.json"));
    expect(() => store.put("8", { papers, signer: owner.address, at: 2 })).not.toThrow();
    expect((await createPapersStore(file).get("7"))?.papers, "what was kept is whole").toBe(papers);
    rmSync(join(file.replace(/\.json$/, ""), "8.json"), { recursive: true });
    store.put("9", { papers, signer: owner.address, at: 3 });
    expect((await createPapersStore(file).get("9"))?.papers, "and later writes go through").toBe(papers);
  });

  it("each pet's papers are their own file, the older single file is moved in once, and a full shelf lets the oldest go", async () => {
    const { mkdtempSync, readdirSync, writeFileSync, existsSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const file = join(mkdtempSync(join(tmpdir(), "papers-")), "papers.json");
    writeFileSync(file, JSON.stringify({ "3": { papers, signer: owner.address, at: 100 } }));
    const size = JSON.stringify({ papers, signer: owner.address, at: 100 }).length;
    const store = createPapersStore(file, { count: 1_000, chars: size * 2 + 10 });
    expect((await store.get("3"))?.papers, "moved in from the older file").toBe(papers);
    expect(existsSync(file)).toBe(false);
    store.put("4", { papers, signer: owner.address, at: 200 });
    store.put("5", { papers, signer: owner.address, at: 300 });
    expect(readdirSync(file.replace(/\.json$/, "")).sort(), "one file per pet, the oldest let go").toEqual([
      "4.json",
      "5.json",
    ]);
    // after a restart, the order holds: the next post lets 4 go
    const again = createPapersStore(file, { count: 1_000, chars: size * 2 + 10 });
    again.put("6", { papers, signer: owner.address, at: 400 });
    expect([await again.get("4"), (await again.get("5"))?.papers, (await again.get("6"))?.papers]).toEqual([
      null,
      papers,
      papers,
    ]);
  });
});
