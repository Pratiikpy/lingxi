import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { type Address, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { voucherTypedData } from "@lingxi/chain";
import { GOALS } from "@lingxi/world";
import type { Entry } from "../src/goals";
import { keepsakeNonce, withVouchers } from "../src/voucher";

const signer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const deployment = { chainId: 196, itemShop: "0x00000000000000000000000000000000000000aa" as Address, items: { "goal-saves": "6", "goal-hatch": "7", "goal-family": "8", "goal-ember": "9" } };
const g1 = GOALS.find((g) => g.id === "g1")!;
const alice = "0x1111111111111111111111111111111111111111";
const bob = "0x2222222222222222222222222222222222222222";
const inWindow = g1.start + 3600;
const save = (w: string, n: number): Entry => ({ m: "saves", w, n, b: 1, t: inWindow, tx: "0x" });

function app(entries: Entry[]) {
  return withVouchers(new Hono(), { entries: () => entries, signer, deployment, now: () => (inWindow + 60) * 1000 });
}
const ask = async (a: Hono, q: string) => {
  const r = await a.request(`/api/voucher?${q}`);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

describe("keepsake vouchers (plan 4.6)", () => {
  it("signs for a contributor to a completed goal, and the signature is the shop's EIP-712 voucher", async () => {
    const a = app([save(alice, 100), save(bob, 60)]);
    const { status, body } = await ask(a, `wallet=${alice}&goal=g1`);
    expect(status).toBe(200);
    expect(body.piece).toBe("goal-saves");
    const v = body.voucher as { to: Address; id: string; quantity: number; nonce: string; expiresAt: string };
    expect([v.to, v.id, v.quantity]).toEqual([alice, "6", 1]);
    expect(BigInt(v.nonce)).toBe(keepsakeNonce("g1", alice));
    expect(Number(v.expiresAt)).toBe(inWindow + 60 + 30 * 86_400);
    const typed = voucherTypedData(deployment as never, { to: v.to, id: BigInt(v.id), quantity: v.quantity, nonce: BigInt(v.nonce), expiresAt: BigInt(v.expiresAt) });
    expect(await verifyTypedData({ address: signer.address, ...typed, signature: body.signature as `0x${string}` })).toBe(true);
  });

  it("gives the same nonce every time, so the contract allows one keepsake per wallet and goal", async () => {
    const a = app([save(alice, 200)]);
    const one = (await ask(a, `wallet=${alice}&goal=g1`)).body.voucher as { nonce: string };
    const two = (await ask(a, `wallet=${alice.toUpperCase().replace("0X", "0x")}&goal=g1`)).body.voucher as { nonce: string };
    expect(one.nonce).toBe(two.nonce);
    expect(keepsakeNonce("g1", alice)).not.toBe(keepsakeNonce("g2", alice));
  });

  it("refuses a goal not yet complete, a wallet that did not help, junk and unknown goals", async () => {
    expect((await ask(app([save(alice, 10)]), `wallet=${alice}&goal=g1`)).body.reason).toBe("notComplete");
    expect((await ask(app([save(alice, 200)]), `wallet=${bob}&goal=g1`)).body.reason).toBe("notContributor");
    expect((await ask(app([save(alice, 200)]), `wallet=0x12&goal=g1`)).status).toBe(400);
    expect((await ask(app([save(alice, 200)]), `wallet=${alice}&goal=g9`)).status).toBe(404);
    // a contribution outside the goal's window does not count
    const early: Entry = { ...save(bob, 200), t: g1.start - 10 };
    expect((await ask(app([save(alice, 200), early]), `wallet=${bob}&goal=g1`)).body.reason).toBe("notContributor");
  });

  it("says so when no shop is deployed", async () => {
    const a = withVouchers(new Hono(), { entries: () => [save(alice, 200)], signer, deployment: { chainId: 196 }, now: () => (inWindow + 60) * 1000 });
    expect((await ask(a, `wallet=${alice}&goal=g1`)).status).toBe(503);
  });
});
