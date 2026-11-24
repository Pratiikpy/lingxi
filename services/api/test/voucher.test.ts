import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { type Address, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { voucherTypedData } from "@lingxi/chain";
import { CHAIN_DECOR, GOALS } from "@lingxi/world";
import type { Entry } from "../src/goals";
import { keepsakeNonce, withVouchers } from "../src/voucher";

const signer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const deployment = {
  chainId: 196,
  itemShop: "0x00000000000000000000000000000000000000aa" as Address,
  items: { "goal-saves": "6", "goal-hatch": "7", "goal-family": "8", "goal-ember": "9" },
};
const g1 = GOALS.find((g) => g.id === "g1")!;
const alice = "0x1111111111111111111111111111111111111111";
const bob = "0x2222222222222222222222222222222222222222";
const inWindow = g1.start + 3600;
/** `n` saves by wallet `w`, one entry each as the ledger keeps them, eight a day (the most a wallet counts, A64). */
const save = (w: string, n: number): Entry[] =>
  Array.from({ length: n }, (_, i) => ({
    m: "saves",
    w,
    n: 1,
    b: 1 + i,
    t: inWindow + Math.floor(i / 8) * 86_400 + (i % 8),
    tx: "0x",
  }));
/** Five neighbours who finish the goal together: each counts for at most a fifth of it. */
const town = Array.from({ length: 5 }, (_, i) => save(`0x${String(i + 3).repeat(40)}`, 40)).flat();

function app(entries: Entry[]) {
  return withVouchers(new Hono(), { entries: () => entries, signer, deployment, now: () => (inWindow + 60) * 1000 });
}
const ask = async (a: Hono, q: string) => {
  const r = await a.request(`/api/voucher?${q}`);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

describe("keepsake vouchers (plan 4.6)", () => {
  it("signs for a contributor to a completed goal, and the signature is the shop's EIP-712 voucher", async () => {
    const a = app([...save(alice, 100), ...save(bob, 60), ...town]);
    const { status, body } = await ask(a, `wallet=${alice}&goal=g1`);
    expect(status).toBe(200);
    expect(body.piece).toBe("goal-saves");
    const v = body.voucher as { to: Address; id: string; quantity: number; nonce: string; expiresAt: string };
    expect([v.to, v.id, v.quantity]).toEqual([alice, "6", 1]);
    expect(BigInt(v.nonce)).toBe(keepsakeNonce("g1", alice));
    expect(Number(v.expiresAt)).toBe(inWindow + 60 + 30 * 86_400);
    const typed = voucherTypedData(deployment as never, {
      to: v.to,
      id: BigInt(v.id),
      quantity: v.quantity,
      nonce: BigInt(v.nonce),
      expiresAt: BigInt(v.expiresAt),
    });
    expect(
      await verifyTypedData({ address: signer.address, ...typed, signature: body.signature as `0x${string}` }),
    ).toBe(true);
  });

  it("gives the same nonce every time, so the contract allows one keepsake per wallet and goal", async () => {
    const a = app([...save(alice, 200), ...town]);
    const one = (await ask(a, `wallet=${alice}&goal=g1`)).body.voucher as { nonce: string };
    const two = (await ask(a, `wallet=${alice.toUpperCase().replace("0X", "0x")}&goal=g1`)).body.voucher as {
      nonce: string;
    };
    expect(one.nonce).toBe(two.nonce);
    expect(keepsakeNonce("g1", alice)).not.toBe(keepsakeNonce("g2", alice));
  });

  it("refuses a goal not yet complete, a wallet that did not help, junk and unknown goals", async () => {
    expect((await ask(app([...save(alice, 10)]), `wallet=${alice}&goal=g1`)).body.reason).toBe("notComplete");
    expect((await ask(app([...save(alice, 200), ...town]), `wallet=${bob}&goal=g1`)).body.reason).toBe(
      "notContributor",
    );
    // one wallet cannot finish a goal alone, however much it does
    expect((await ask(app([...save(alice, 10_000)]), `wallet=${alice}&goal=g1`)).body.reason).toBe("notComplete");
    expect((await ask(app([...save(alice, 200)]), `wallet=0x12&goal=g1`)).status).toBe(400);
    expect((await ask(app([...save(alice, 200)]), `wallet=${alice}&goal=g9`)).status).toBe(404);
    // a contribution outside the goal's window does not count
    const early: Entry[] = save(bob, 200).map((e) => ({ ...e, t: g1.start - 10 }));
    expect((await ask(app([...save(alice, 200), ...early, ...town]), `wallet=${bob}&goal=g1`)).body.reason).toBe(
      "notContributor",
    );
  });

  it("says so when no shop is deployed", async () => {
    const a = withVouchers(new Hono(), {
      entries: () => [...save(alice, 200)],
      signer,
      deployment: { chainId: 196 },
      now: () => (inWindow + 60) * 1000,
    });
    expect((await ask(a, `wallet=${alice}&goal=g1`)).status).toBe(503);
  });

  it("the voucher key signs only goal keepsakes, one each, whatever a request adds", async () => {
    const keepsakeIds = new Set(
      CHAIN_DECOR.filter((p) => p.chain?.kind === "keepsake").map(
        (p) => deployment.items[p.id as keyof typeof deployment.items],
      ),
    );
    // a keepsake belongs to each goal of the first round; the monthly rounds after it (G4) have none and get no voucher
    for (const g of GOALS.filter((x) => !x.id.includes("-"))) {
      // saves come one entry each, eight a day at most counting for a wallet (A64); the rest may come in one entry
      const of = (w: string): Entry[] =>
        g.metric === "saves"
          ? Array.from({ length: g.target }, (_, i) => ({
              m: g.metric,
              w,
              n: 1,
              b: 1 + i,
              t: g.start + 60 + Math.floor(i / 8) * 86_400 + (i % 8),
              tx: "0x",
            }))
          : [{ m: g.metric, w, n: g.target, b: 1, t: g.start + 60, tx: "0x" }];
      const town = Array.from({ length: 5 }, (_, i) => of(`0x${String(i + 3).repeat(40)}`)).flat();
      const late = Math.max(...town.map((e) => e.t));
      const a = withVouchers(new Hono(), {
        entries: () => [...town, ...of(alice)],
        signer,
        deployment,
        now: () => (late + 120) * 1000,
      });
      // a request naming another item, a quantity or a recipient is answered with the keepsake alone, to the asker
      const { status, body } = await ask(a, `wallet=${alice}&goal=${g.id}&id=1&item=1&quantity=50&to=${bob}`);
      expect(status, g.id).toBe(200);
      const v = body.voucher as { to: string; id: string; quantity: number };
      expect(keepsakeIds.has(v.id), `${g.id} signs item ${v.id}`).toBe(true);
      expect([v.to, v.quantity]).toEqual([alice, 1]);
    }
    const later = GOALS.find((x) => x.id.includes("-"))!;
    const b = withVouchers(new Hono(), { entries: () => [], signer, deployment, now: () => (later.start + 60) * 1000 });
    expect((await ask(b, `wallet=${alice}&goal=${later.id}`)).status, "a later round has no keepsake").toBe(404);
  });
});
