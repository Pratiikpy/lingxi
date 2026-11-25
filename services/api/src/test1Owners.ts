/**
 * Who holds each TapeCode-Test1 (H9). The collection does not list tokens by owner, so a holder claiming the holder
 * pin would otherwise type their token's number. This index reads every token's owner from X Layer (a thousand to a
 * multicall: its 10,000 tokens in about ten calls), again every ten minutes, and answers which tokens a wallet holds in
 * one request. The answer is a hint: the game confirms each token on chain before offering it, and reads every owner
 * itself when the hint does not account for all the wallet holds.
 */

import type { Hono } from "hono";
import { type Address, type PublicClient, parseAbi } from "viem";
import { RateLimiter } from "./limit";
import { clientIp } from "./clientIp";

const nft = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function totalSupply() view returns (uint256)",
]);
const OWNERS_PER_CALL = 1000;
const LANES = 4;
const TRIES = 3;
/** How often the index reads every owner again. */
export const TEST1_REFRESH_MS = 10 * 60_000;

export interface Test1Index {
  refresh: () => Promise<void>;
  /** the tokens the index saw this wallet hold, and when; null until the first complete read */
  tokensOf: (wallet: Address) => { tokens: string[]; at: number; block: number } | null;
}

/**
 * `collection` may be found on the first read (the gift contract names it), so the route can be registered at start:
 * the server's router takes no routes once it has answered a request.
 */
export function createTest1Index(opts: {
  pub: PublicClient;
  collection: Address | (() => Promise<Address>);
  now?: () => number;
}): Test1Index {
  const now = opts.now ?? Date.now;
  let collection: Address | null = typeof opts.collection === "string" ? opts.collection : null;
  const collectionOf = async () => (collection ??= await (opts.collection as () => Promise<Address>)());
  let owners: Map<string, number[]> | null = null;
  let at = 0;
  let block = 0;
  let running: Promise<void> | null = null;

  const batch = async (address: Address, from: number, count: number) => {
    for (let attempt = 1; ; attempt++) {
      const r = await opts.pub
        .multicall({
          allowFailure: true,
          batchSize: 1 << 20,
          contracts: Array.from({ length: count }, (_, k) => ({
            address,
            abi: nft,
            functionName: "ownerOf" as const,
            args: [BigInt(from + k)] as const,
          })),
        })
        // a batch that fails whole is the node failing: handled just below, not as missing tokens
        .catch(() => null);
      // a batch whose every call failed is the node failing, not 1,000 missing tokens
      if (r && r.some((x) => x.status === "success")) return r;
      if (attempt >= TRIES) throw new Error(`owners of #${from} to #${from + count - 1} unreadable`);
    }
  };

  const read = async () => {
    const address = await collectionOf();
    const head = Number(await opts.pub.getBlockNumber());
    const supply = Number((await opts.pub.readContract({ address, abi: nft, functionName: "totalSupply" })) as bigint);
    const next = new Map<string, number[]>();
    const starts = Array.from({ length: Math.ceil(supply / OWNERS_PER_CALL) }, (_, k) => 1 + k * OWNERS_PER_CALL);
    for (let i = 0; i < starts.length; i += LANES) {
      const lanes = await Promise.all(
        starts.slice(i, i + LANES).map((from) => batch(address, from, Math.min(OWNERS_PER_CALL, supply - from + 1))),
      );
      lanes.forEach((results, lane) =>
        results.forEach((r, k) => {
          if (r.status !== "success") return;
          const who = String(r.result).toLowerCase();
          const list = next.get(who);
          const id = starts[i + lane]! + k;
          if (list) list.push(id);
          else next.set(who, [id]);
        }),
      );
    }
    // a pass that failed part way keeps the last complete one
    owners = next;
    at = now();
    block = head;
  };

  return {
    // one read at a time, whoever asks
    refresh: () => (running ??= read().finally(() => (running = null))),
    tokensOf: (wallet) => (owners ? { tokens: (owners.get(wallet.toLowerCase()) ?? []).map(String), at, block } : null),
  };
}

/** GET /api/holders/test1/:wallet: the Test1 tokens the index saw the wallet hold (a hint the game confirms on chain). */
export function withTest1Owners(app: Hono, index: Test1Index, limiter = new RateLimiter(120, 60_000)): Hono {
  app.get("/api/holders/test1/:wallet", (c) => {
    if (!limiter.take(clientIp(c))) return c.json({ ok: false, reason: "busy" });
    const wallet = c.req.param("wallet");
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return c.json({ ok: false, reason: "invalid" }, 400);
    const r = index.tokensOf(wallet as Address);
    // not ready yet is an answer, not an error: the game then reads the owners itself
    if (!r) return c.json({ ok: false, reason: "notReady" });
    c.header("cache-control", "public, max-age=60");
    return c.json({ ok: true, ...r });
  });
  return app;
}
