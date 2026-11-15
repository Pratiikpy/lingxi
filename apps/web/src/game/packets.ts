/**
 * Red packets from the browser: fund one (the link carries a one-time key),
 * open a share with the link (claim; for a lucky split, reveal two blocks later),
 * and refund what nobody opened after it expires. Sent packets are remembered on
 * this device so the sender can watch them and take back the rest.
 */

import { create } from "zustand";
import { type Address, type Hex, formatUnits, parseUnits } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { XLAYER_USDT, claimPacket, createPacket, pendingOf, readClaims, readPacket, refundPacket, revealPacket, signClaim, tokenBalance } from "@lingxi/chain";
import { b64urlDecode, b64urlEncode } from "@lingxi/brain";
import { connectWallet, deployment, publicClient } from "./chain";

const SENT_KEY = "lingxi.packets.sent.v1";
const PREFIX = "lxp1.";
export const USDT_DECIMALS = 6;
export const packetsAvailable = () => !!deployment?.redPacket;
export const usdt = (v: bigint) => formatUnits(v, USDT_DECIMALS);

export interface PacketLink {
  id: string;
  /** the one-time key, hex without 0x */
  key: string;
  from: { name: string; line: "gentle" | "bold" | "curious" };
  letter: string;
}

export function encodePacketLink(p: PacketLink): string {
  return PREFIX + b64urlEncode(JSON.stringify(p));
}

/** Reads a packet link; anything malformed is refused. */
export function decodePacketLink(code: string): PacketLink | null {
  if (!code.startsWith(PREFIX) || code.length > 2000) return null;
  try {
    const v = JSON.parse(b64urlDecode(code.slice(PREFIX.length))) as Record<string, unknown>;
    const from = (v.from ?? {}) as Record<string, unknown>;
    const line = (["gentle", "bold", "curious"] as const).find((l) => l === from.line);
    if (typeof v.id !== "string" || !/^\d{1,20}$/.test(v.id)) return null;
    if (typeof v.key !== "string" || !/^[0-9a-f]{64}$/.test(v.key)) return null;
    if (!line) return null;
    return { id: v.id, key: v.key, from: { name: String(from.name ?? "").slice(0, 12) || "A friend", line }, letter: typeof v.letter === "string" ? v.letter.slice(0, 200) : "" };
  } catch {
    return null;
  }
}

export interface SentPacket {
  id: string;
  link: string;
  total: string;
  count: number;
  at: number;
}

function loadSent(): SentPacket[] {
  try {
    return JSON.parse(localStorage.getItem(SENT_KEY) ?? "[]") as SentPacket[];
  } catch {
    return [];
  }
}

const firstLine = (e: unknown) => (e as Error).message?.split(/\r?\n/)[0] || "failed";

interface PacketStore {
  sent: SentPacket[];
  busy: string | null;
  error: string | null;
  balance: () => Promise<bigint | null>;
  send: (o: { amount: string; count: number; lucky: boolean; petOwnersOnly: boolean; days: number; from: PacketLink["from"]; letter: string; origin: string }) => Promise<string | null>;
  /** claim (and reveal if lucky); returns the amount received */
  open: (link: PacketLink, onStage: (s: "signing" | "claiming" | "luck" | "revealing") => void) => Promise<{ ok: true; amount: bigint; best: boolean } | { ok: false; reason: string }>;
  refund: (id: string) => Promise<boolean>;
}

export const usePackets = create<PacketStore>((set, get) => ({
  sent: loadSent(),
  busy: null,
  error: null,
  balance: async () => {
    try {
      const w = await connectWallet();
      return await tokenBalance(publicClient, XLAYER_USDT, w.account!.address);
    } catch {
      return null;
    }
  },
  send: async (o) => {
    if (!deployment?.redPacket) return null;
    set({ busy: "sending", error: null });
    try {
      const wallet = await connectWallet();
      const pk = generatePrivateKey();
      const total = parseUnits(o.amount, USDT_DECIMALS);
      const { id } = await createPacket(publicClient, wallet, deployment, {
        token: XLAYER_USDT,
        total,
        count: o.count,
        lifetimeSec: o.days * 86_400,
        key: privateKeyToAccount(pk).address,
        lucky: o.lucky,
        petOwnersOnly: o.petOwnersOnly,
      });
      const link = `${o.origin}#packet=${encodePacketLink({ id: id.toString(), key: pk.slice(2), from: o.from, letter: o.letter })}`;
      const sent = [{ id: id.toString(), link, total: o.amount, count: o.count, at: Date.now() }, ...get().sent].slice(0, 50);
      try {
        localStorage.setItem(SENT_KEY, JSON.stringify(sent));
      } catch {
        // the link is still shown; it just won't be listed after a reload
      }
      set({ sent, busy: null });
      return link;
    } catch (e) {
      set({ busy: null, error: firstLine(e) });
      return null;
    }
  },
  open: async (link, onStage) => {
    if (!deployment?.redPacket) return { ok: false, reason: "notDeployed" };
    try {
      const wallet = await connectWallet();
      const me = wallet.account!.address as Address;
      const id = BigInt(link.id);
      const already = await pendingOf(publicClient, deployment, id, me);
      let block: bigint;
      if (!already) {
        onStage("signing");
        const sig = await signClaim(publicClient, deployment, `0x${link.key}` as Hex, id, me);
        onStage("claiming");
        const r = await claimPacket(publicClient, wallet, deployment, id, sig);
        if (!r.reserved) return { ok: true, amount: r.amount, best: false };
        block = r.block;
      } else block = already.atBlock;
      // a lucky share is decided by a block that did not exist when we claimed
      onStage("luck");
      for (let i = 0; i < 120; i++) {
        if ((await publicClient.getBlockNumber()) > block + 1n) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      onStage("revealing");
      const r = await revealPacket(publicClient, wallet, deployment, id);
      const claims = await readClaims(publicClient, deployment, id);
      const mine = claims.find((c) => c.claimer.toLowerCase() === me.toLowerCase());
      return { ok: true, amount: r.amount, best: !!mine && ((mine.sealOutput >> 5) & 1) === 1 };
    } catch (e) {
      // the contract's error name sits further down viem's message than the first line
      const msg = (e as Error).message ?? "";
      const reason = /AllClaimed/.test(msg) ? "allClaimed" : /AlreadyClaimed/.test(msg) ? "already" : /Expired/.test(msg) ? "expired" : /SealSaysNo/.test(msg) ? "petsOnly" : /BadKey/.test(msg) ? "badKey" : /noWallet/.test(msg) ? "noWallet" : firstLine(e);
      return { ok: false, reason };
    }
  },
  refund: async (id) => {
    if (!deployment?.redPacket) return false;
    set({ busy: "refunding", error: null });
    try {
      const wallet = await connectWallet();
      await refundPacket(publicClient, wallet, deployment, BigInt(id));
      set({ busy: null });
      return true;
    } catch (e) {
      set({ busy: null, error: firstLine(e) });
      return false;
    }
  },
}));

export { readPacket, readClaims };
