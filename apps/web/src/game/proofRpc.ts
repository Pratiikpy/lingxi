/**
 * How every verification in this site reads X Layer (the proof page, the rules self-check, the circuit hash table).
 *
 * The game reads through Lingxi's own server first, because a public node's rate-limit reply arrives without CORS
 * headers and breaks the page. A proof must not depend on us, so here the order is reversed: the judge's own RPC if
 * they set one, then X Layer's public RPCs, paced; Lingxi's server answers only when every one of those failed, and
 * every answer says which host gave it, so the page can show it.
 */

import type { PublicClient } from "viem";
import { create } from "zustand";
import { xLayer } from "@lingxi/chain";
import { API_RPC, NETWORK, OFFICIAL_RPCS, rpcs } from "./chain";
import { type Endpoints, makeProofClient, proofRequest, rotated } from "./rpcAsk";

export { type Answer, type Endpoints, RpcAnswerError, proofRequest } from "./rpcAsk";

const MINE_KEY = "lingxi.proof.rpc";

function readMine(): string | null {
  try {
    return localStorage.getItem(MINE_KEY);
  } catch {
    return null;
  }
}

/** Who answered this page's verification reads, and how often. */
interface Tally {
  mine: string | null;
  hosts: Record<string, number>;
  fallback: number;
  setMine: (url: string | null) => void;
  answered: (host: string, fallback: boolean) => void;
}

export const useProofRpc = create<Tally>((set) => ({
  mine: readMine(),
  hosts: {},
  fallback: 0,
  setMine: (mine) => {
    try {
      if (mine) localStorage.setItem(MINE_KEY, mine);
      else localStorage.removeItem(MINE_KEY);
    } catch {
      // kept for this visit only
    }
    set({ mine });
  },
  answered: (host, fallback) =>
    set((s) => ({
      hosts: { ...s.hosts, [host]: (s.hosts[host] ?? 0) + 1 },
      fallback: s.fallback + (fallback ? 1 : 0),
    })),
}));

/** The endpoints a verification asks now, with the public ones rotated so parallel workers spread across them. */
export function endpoints(start = 0): Endpoints {
  const pub = NETWORK === "xlayer" ? OFFICIAL_RPCS : rpcs;
  const mine = useProofRpc.getState().mine;
  // the judge's own endpoint is asked once, first, even when it is one of the public ones
  const order = rotated(pub, start).filter((u) => !mine || new URL(u).host !== new URL(mine).host);
  return { mine, publicRpcs: order, fallback: NETWORK === "xlayer" ? API_RPC : null };
}

/**
 * A client for verification reads. `onAnswer` hears each host that answered (for a check's own note); the page's
 * tally hears them all.
 */
export function proofClient(start = 0, onAnswer?: (host: string, fallback: boolean) => void): PublicClient {
  return makeProofClient(xLayer, endpoints, start, (a) => {
    useProofRpc.getState().answered(a.host, a.fallback);
    onAnswer?.(a.host, a.fallback);
  });
}

/** Checks that an RPC a judge typed is an https X Layer node before any proof uses it. */
export async function checkOwnRpc(
  url: string,
): Promise<{ ok: true } | { ok: false; reason: "address" | "unreachable" | "chain" }> {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return { ok: false, reason: "address" };
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)))
    return { ok: false, reason: "address" };
  try {
    const a = await proofRequest({ mine: u.toString(), publicRpcs: [], fallback: null }, { method: "eth_chainId" });
    return Number(a.result) === xLayer.id ? { ok: true } : { ok: false, reason: "chain" };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}
