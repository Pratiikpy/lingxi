/**
 * Red packets from the browser: fund one (the link carries a one-time key),
 * open a share with the link (claim; for a lucky split, reveal two blocks later),
 * and refund what nobody opened after it expires. Sent packets are remembered on
 * this device so the sender can watch them and take back the rest.
 */

import { create } from "zustand";
import { type Address, type Hex, formatUnits, parseUnits } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { type ClaimView, XLAYER_USDT, claimPacket, collectPacket, createPacket, createdIn, nextPacketId, owedOf, pendingOf, readPacket, refundPacket, revealPacket, signClaim, tokenBalance } from "@lingxi/chain";
import { b64urlDecode, b64urlEncode } from "@lingxi/brain";
import { connectWallet, deployment, publicClient } from "./chain";
import { saveWrite } from "./saveRuntime";
import { now } from "./gameClock";
import { errorText, firstLine } from "./errorText";

const SENT_KEY = "lingxi.packets.sent.v1";
/**
 * Packets whose money may have gone to X Layer before their link was made (A42): the link's one-time key is kept here
 * before the wallet is asked, so a receipt that comes late, or a tab closed while waiting, never loses the only key that
 * opens the packet. Each is matched to its packet (by its transaction, or by the key itself among the packets made
 * since) and moved to the sent list with its link; one refused on chain, or never found, is let go.
 */
const PENDING_KEY = "lingxi.packets.pending.v1";
/** A kept key no packet on X Layer carries after this long was never sent (the wallet dropped it, or it never left). */
const PENDING_FORGET_MS = 24 * 3_600_000;
/** How many packets made since a key was kept are looked through for it. */
const SCAN_LIMIT = 256;
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? (location.hostname === "localhost" ? "http://localhost:8787" : "");
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

export interface PendingPacket {
  /** the link's one-time key, hex without 0x */
  key: string;
  keyAddress: string;
  /** the contract's next packet id when the key was kept: the packet's id is this or later */
  fromId: string;
  sender: string;
  total: string;
  count: number;
  from: PacketLink["from"];
  letter: string;
  origin: string;
  at: number;
  /** the transaction the wallet sent it in, once known */
  tx?: Hex;
}

function loadPending(): PendingPacket[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]") as PendingPacket[];
  } catch {
    return [];
  }
}

/** A wallet's own refusal: nothing was sent. */
const refusedInWallet = (e: unknown) => (e as { code?: number } | null)?.code === 4001 || /reject|denied|cancel/i.test(errorText(e));

function loadSent(): SentPacket[] {
  try {
    return JSON.parse(localStorage.getItem(SENT_KEY) ?? "[]") as SentPacket[];
  } catch {
    return [];
  }
}


interface PacketStore {
  sent: SentPacket[];
  /** packets sent and not yet matched to their link (A42) */
  pending: PendingPacket[];
  busy: string | null;
  /** a wallet's or node's words, or `packetPending` (sent, still being confirmed) or `packetFailed` (refused on chain) */
  error: string | null;
  /** matches kept keys to their packets on X Layer, moving each found one to the sent list with its link */
  recover: () => Promise<void>;
  balance: () => Promise<bigint | null>;
  send: (o: { amount: string; count: number; lucky: boolean; petOwnersOnly: boolean; days: number; from: PacketLink["from"]; letter: string; origin: string }) => Promise<string | null>;
  /**
   * Opens a share: claim, and for a lucky split reveal two blocks later. `petId` is the opener's settled pet on chain,
   * for pet-owners-only packets. Returns the amount received and the claim as its own transaction recorded it.
   */
  open: (link: PacketLink, onStage: (s: "signing" | "claiming" | "luck" | "revealing") => void, petId?: string) => Promise<{ ok: true; amount: bigint; best: boolean; claim: ClaimView | null } | { ok: false; reason: string }>;
  refund: (id: string) => Promise<boolean>;
  /** a lucky packet's top-up waiting for this wallet once every share is open */
  owed: (id: string) => Promise<bigint>;
  collect: (id: string) => Promise<bigint | null>;
}

export const usePackets = create<PacketStore>((set, get) => {
  const keepPending = (pending: PendingPacket[]) => {
    set({ pending });
    saveWrite(PENDING_KEY, JSON.stringify(pending));
  };
  const keepSent = (sent: SentPacket[]) => {
    set({ sent });
    try {
      saveWrite(SENT_KEY, JSON.stringify(sent));
    } catch {
      // the link is still shown; it just won't be listed after a reload
    }
  };
  const linkOf = (p: PendingPacket, id: bigint) => `${p.origin}packet=${encodePacketLink({ id: id.toString(), key: p.key, from: p.from, letter: p.letter })}`;
  /** a kept key's packet found: listed with its link, the key let go */
  const found = (p: PendingPacket, id: bigint): string => {
    const link = linkOf(p, id);
    if (!get().sent.some((s) => s.id === id.toString())) keepSent([{ id: id.toString(), link, total: p.total, count: p.count, at: p.at }, ...get().sent].slice(0, 50));
    letGo(p);
    return link;
  };
  const letGo = (p: PendingPacket) => {
    try {
      keepPending(get().pending.filter((x) => x.key !== p.key));
    } catch {
      // kept in storage until it can be written again; found again next time, and listed once
    }
  };
  /** the packet a kept key opens, among those made since it was kept; null if none carries it yet */
  const byKey = async (p: PendingPacket): Promise<bigint | null> => {
    const end = await nextPacketId(publicClient, deployment!);
    const last = BigInt(p.fromId) + BigInt(SCAN_LIMIT);
    for (let id = BigInt(p.fromId); id < end && id < last; id++) {
      const v = await readPacket(publicClient, deployment!, id).catch(() => null);
      if (v && v.key.toLowerCase() === p.keyAddress.toLowerCase() && v.sender.toLowerCase() === p.sender.toLowerCase()) return id;
    }
    return null;
  };
  return {
  sent: loadSent(),
  pending: loadPending(),
  busy: null,
  error: null,
  recover: async () => {
    if (!deployment?.redPacket) return;
    for (const p of get().pending) {
      try {
        const receipt = p.tx ? await publicClient.getTransactionReceipt({ hash: p.tx }).catch(() => null) : null;
        const made = receipt?.status === "success" ? createdIn(receipt.logs) : null;
        if (made !== null) {
          found(p, made);
          continue;
        }
        if (receipt?.status === "reverted") {
          // refused on chain: its money never left the wallet
          letGo(p);
          set({ error: "packetFailed" });
          continue;
        }
        const id = await byKey(p);
        if (id !== null) found(p, id);
        else if (now() - p.at > PENDING_FORGET_MS) letGo(p);
      } catch {
        // the node did not answer: asked again next time
      }
    }
    if (get().error === "packetPending" && get().pending.length === 0) set({ error: null });
  },
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
    let kept: PendingPacket | null = null;
    let asked = false;
    try {
      const wallet = await connectWallet();
      const pk = generatePrivateKey();
      const keyAddress = privateKeyToAccount(pk).address;
      const total = parseUnits(o.amount, USDT_DECIMALS);
      // the key is kept before any money can move (a full storage refuses the packet here, before anything is sent):
      // a packet whose link was never made can still be found by it (A42)
      const draft: PendingPacket = { key: pk.slice(2), keyAddress, fromId: (await nextPacketId(publicClient, deployment)).toString(), sender: wallet.account!.address, total: o.amount, count: o.count, from: o.from, letter: o.letter, origin: o.origin, at: now() };
      keepPending([...get().pending, draft]);
      kept = draft;
      const { id } = await createPacket(
        publicClient,
        wallet,
        deployment,
        { token: XLAYER_USDT, total, count: o.count, lifetimeSec: o.days * 86_400, key: keyAddress, lucky: o.lucky, petOwnersOnly: o.petOwnersOnly },
        {
          sending: () => (asked = true),
          sent: (tx) => {
            const withTx: PendingPacket = { ...draft, tx };
            kept = withTx;
            try {
              keepPending(get().pending.map((x) => (x.key === draft.key ? withTx : x)));
            } catch {
              // the key itself is kept; the packet is found by it
            }
          },
        },
      );
      const link = found(draft, id);
      set({ busy: null });
      return link;
    } catch (e) {
      const k: PendingPacket | null = kept;
      if (!k) {
        set({ busy: null, error: firstLine(e) });
        return null;
      }
      // nothing was sent (refused before the wallet was asked, or in the wallet itself): the key is let go
      if (!asked || (!k.tx && refusedInWallet(e))) {
        letGo(k);
        set({ busy: null, error: firstLine(e) });
        return null;
      }
      // refused on chain: its money never left the wallet
      if (k.tx && /RevertedOnChain|reverted/i.test(`${(e as Error | null)?.name ?? ""} ${errorText(e)}`)) {
        letGo(k);
        set({ busy: null, error: "packetFailed" });
        return null;
      }
      // sent, and not yet confirmed: the key stays until X Layer says what became of it
      set({ busy: null, error: "packetPending" });
      return null;
    }
  },
  open: async (link, onStage, petId) => {
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
        const r = await claimPacket(publicClient, wallet, deployment, id, sig, petId ? BigInt(petId) : 0n);
        if (!r.reserved) return { ok: true, amount: r.amount, best: false, claim: r.claim };
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
      // the reveal's own receipt carries the share it drew: whether it was the best is bit 5 of the seal's answer
      return { ok: true, amount: r.amount, best: !!r.claim && ((r.claim.sealOutput >> 5) & 1) === 1, claim: r.claim };
    } catch (e) {
      // the contract's error name sits further down viem's message than the first line
      const msg = errorText(e);
      const reason = /AllClaimed/.test(msg) ? "allClaimed" : /AlreadyClaimed/.test(msg) ? "already" : /Expired/.test(msg) ? "expired" : /SealSaysNo|NotYourPet/.test(msg) ? "petsOnly" : /PetUsed/.test(msg) ? "petUsed" : /BadKey/.test(msg) ? "badKey" : /noWallet/.test(msg) ? "noWallet" : firstLine(e);
      return { ok: false, reason };
    }
  },
  owed: async (id) => {
    if (!deployment?.redPacket) return 0n;
    try {
      const w = await connectWallet();
      return await owedOf(publicClient, deployment, BigInt(id), w.account!.address);
    } catch {
      return 0n;
    }
  },
  collect: async (id) => {
    if (!deployment?.redPacket) return null;
    try {
      const w = await connectWallet();
      return (await collectPacket(publicClient, w, deployment, BigInt(id))).amount;
    } catch {
      return null;
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
  };
});

/**
 * Who opened a packet so far (A1). The contract keeps only events, and the public nodes read at most 100 blocks a time,
 * so the list comes from the game server's index of them; the on-chain copy, which has no server, has the contract's
 * own counts only. `asOf` is the block the index has read to.
 */
export type ClaimsRead = { kind: "list"; claims: ClaimView[]; asOf: number } | { kind: "catchingUp"; asOf: number } | { kind: "onChainCopy" } | { kind: "unreachable" };

/** The list with a claim this player just made, from its own receipt, until the server's index has read it too. */
export function withClaim(read: ClaimsRead, claim: ClaimView | null): ClaimsRead {
  if (!claim || read.kind !== "list" || read.claims.some((c) => c.tx === claim.tx && c.index === claim.index)) return read;
  return { ...read, claims: [...read.claims, claim] };
}

export async function claimsOf(id: bigint): Promise<ClaimsRead> {
  if (!BASE) return { kind: "onChainCopy" };
  try {
    const r = (await (await fetch(`${BASE}/api/packets/${id}/claims`, { signal: AbortSignal.timeout(10_000) })).json()) as
      | { ok: true; indexedTo: number; claims: Array<{ claimer: string; amount: string; index: number; sealInput: number; sealOutput: number; tx: string }> }
      | { ok: false; reason: string; indexedTo?: number };
    if (!r.ok) return r.reason === "unknown" && typeof r.indexedTo === "number" ? { kind: "catchingUp", asOf: r.indexedTo } : { kind: "unreachable" };
    return {
      kind: "list",
      asOf: r.indexedTo,
      claims: r.claims.map((c) => ({ claimer: c.claimer as Address, amount: BigInt(c.amount), index: c.index, sealInput: c.sealInput, sealOutput: c.sealOutput, tx: c.tx as Hex })),
    };
  } catch {
    return { kind: "unreachable" };
  }
}

export { readPacket };
