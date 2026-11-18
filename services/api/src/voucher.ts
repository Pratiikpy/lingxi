/**
 * Vouchers for on-chain keepsakes (plan 4.6). The server signs one only for something it can witness from the chain:
 * a wallet that contributed to a community goal that is complete gets that goal's keepsake. The nonce is fixed by
 * the goal and the wallet, so the shop contract lets each wallet claim each keepsake once, however often it asks.
 */

import type { Hono } from "hono";
import { type Address, type Hex, type LocalAccount, keccak256, toBytes } from "viem";
import { VoucherQuery } from "@lingxi/api-schema";
import { type Deployment, voucherTypedData } from "@lingxi/chain";
import { CHAIN_DECOR, GOALS, type GoalDef } from "@lingxi/world";
import { type Entry, reportGoals } from "./goals";

/** A voucher is good for thirty days; asking again later gives a fresh one with the same nonce. */
export const VOUCHER_DAYS = 30;

export const keepsakeNonce = (goal: string, wallet: string): bigint => BigInt(keccak256(toBytes(`lingxi:keepsake:${goal}:${wallet.toLowerCase()}`)));

export interface VoucherOptions {
  entries: () => readonly Entry[];
  signer: LocalAccount;
  deployment: Pick<Deployment, "chainId" | "itemShop" | "items">;
  goals?: readonly GoalDef[];
  now?: () => number;
}

/** GET /api/voucher?wallet=0x…&goal=g1: a signed voucher for that goal's keepsake, or the reason there is none. */
export function withVouchers(app: Hono, o: VoucherOptions): Hono {
  const goals = o.goals ?? GOALS;
  app.get("/api/voucher", async (c) => {
    c.header("access-control-allow-origin", "*");
    c.header("cache-control", "no-store");
    const q = VoucherQuery.safeParse(c.req.query());
    if (!q.success) return c.json({ ok: false, reason: "wallet" }, 400);
    const { wallet, goal: goalId } = q.data;
    const goal = goals.find((g) => g.id === goalId);
    const piece = CHAIN_DECOR.find((p) => p.chain?.kind === "keepsake" && p.chain.goal === goalId);
    if (!goal || !piece) return c.json({ ok: false, reason: "goal" }, 404);
    const itemId = o.deployment.items?.[piece.id];
    if (!o.deployment.itemShop || !itemId) return c.json({ ok: false, reason: "noShop" }, 503);
    const now = Math.floor((o.now?.() ?? Date.now()) / 1000);
    const [report] = reportGoals(o.entries(), [goal], now, [wallet]);
    if (!report || report.state !== "complete") return c.json({ ok: false, reason: "notComplete" }, 409);
    if (report.mine <= 0) return c.json({ ok: false, reason: "notContributor" }, 403);
    const voucher = { to: wallet as Address, id: BigInt(itemId), quantity: 1, nonce: keepsakeNonce(goal.id, wallet), expiresAt: BigInt(now + VOUCHER_DAYS * 86_400) };
    const signature: Hex = await o.signer.signTypedData(voucherTypedData(o.deployment as Deployment, voucher));
    return c.json({
      ok: true,
      piece: piece.id,
      voucher: { to: voucher.to, id: voucher.id.toString(), quantity: voucher.quantity, nonce: voucher.nonce.toString(), expiresAt: voucher.expiresAt.toString() },
      signature,
    });
  });
  return app;
}
