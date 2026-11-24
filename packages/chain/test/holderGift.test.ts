import { describe, expect, it } from "vitest";
import type { Address, PublicClient } from "viem";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { type GiftTerms, Test1Unreadable, giftWays, giftWaysOf, loadSnapshot, test1TokensOf } from "../src/holderGift";

const TEST1 = "0x0e91460d6823c711643e650a9a4c0cc21de41614" as Address;
const RIG = "0x9cfc959cd42B2e1d39a0d850c528210E818AE520" as Address;
const GIFT = "0x00000000000000000000000000000000000000f1" as Address;
const ME = "0x00000000000000000000000000000000000000aa" as Address;
const terms: GiftTerms = {
  gift: GIFT,
  outfit: 1n,
  test1: TEST1,
  rig: RIG,
  snapshotRoot: "0x00",
  snapshotBlock: 1n,
  bemMin: 1n,
  fabMin: 1n,
};

/** A chain with a Test1 collection of `supply` tokens, the given owners, rigs held, and tokens already used for the gift. */
function chain(o: { supply: number; mine: number[]; rigs?: number[]; used?: Array<[Address, number]> }) {
  const reads: string[] = [];
  let multicalls = 0;
  const owner = (id: number) => (o.mine.includes(id) ? ME : ("0x00000000000000000000000000000000000000bb" as Address));
  const usedSet = new Set((o.used ?? []).map(([c, id]) => `${c.toLowerCase()}:${id}`));
  const client = {
    readContract: async ({
      address,
      functionName,
      args,
    }: {
      address: Address;
      functionName: string;
      args?: readonly unknown[];
    }) => {
      reads.push(`${functionName}@${address.slice(0, 6)}`);
      if (functionName === "balanceOf")
        return BigInt(address.toLowerCase() === TEST1 ? o.mine.length : (o.rigs ?? []).length);
      if (functionName === "totalSupply") return BigInt(o.supply);
      if (functionName === "tokenOfOwnerByIndex") return BigInt((o.rigs ?? [])[Number(args![1])]!);
      if (functionName === "tokenUsed") return usedSet.has(`${String(args![0]).toLowerCase()}:${Number(args![1])}`);
      throw new Error(`unexpected read ${functionName}`);
    },
    // as viem answers: each result wrapped in a status when failures are allowed, bare when they are not
    multicall: async ({
      contracts,
      allowFailure = true,
    }: {
      contracts: Array<{ functionName: string; args: readonly unknown[]; address: Address }>;
      allowFailure?: boolean;
    }) => {
      multicalls++;
      return contracts.map((c) => {
        const id = Number(c.args[c.args.length - 1]);
        const r =
          c.functionName === "ownerOf"
            ? id >= 1 && id <= o.supply
              ? { status: "success", result: owner(id) }
              : { status: "failure", error: new Error("no token") }
            : c.functionName === "tokenUsed"
              ? { status: "success", result: usedSet.has(`${String(c.args[0]).toLowerCase()}:${id}`) }
              : null;
        if (!r) throw new Error("unexpected call");
        if (allowFailure) return r;
        if (r.status !== "success") throw new Error("call failed");
        return r.result;
      });
    },
  } as unknown as PublicClient;
  return { client, reads, calls: () => multicalls };
}

describe("finding a holder's TapeCode-Test1 (H9)", () => {
  it("reads every owner from the chain and returns the wallet's tokens, those that have not given the gift first", async () => {
    const c = chain({ supply: 10_000, mine: [7, 4321, 9999], used: [[TEST1, 7]] });
    const found = await test1TokensOf(c.client, terms, ME);
    expect(found).toEqual({ unused: [4321n, 9999n], used: [7n] });
    // ten thousand owners in a handful of calls, not one call each
    expect(c.calls()).toBeLessThanOrEqual(12);
  });

  it("takes an index's answer as a hint: confirmed on chain in one call, and a stale one falls back to reading every owner", async () => {
    const c = chain({ supply: 10_000, mine: [7, 4321] });
    expect(await test1TokensOf(c.client, terms, ME, { candidates: [7n, 4321n] })).toEqual({
      unused: [7n, 4321n],
      used: [],
    });
    // one call to confirm the two, one to read their gift flags: no owner walk
    expect(c.calls()).toBe(2);
    // the index has not seen 4321 yet, and lists a token sold since: the wallet holds two, so every owner is read
    const stale = chain({ supply: 10_000, mine: [7, 4321] });
    expect(await test1TokensOf(stale.client, terms, ME, { candidates: [7n, 99n] })).toEqual({
      unused: [7n, 4321n],
      used: [],
    });
    expect(stale.calls()).toBeGreaterThan(2);
  });

  it("reads in smaller batches when asked, for a door with a smaller request limit", async () => {
    const c = chain({ supply: 1_000, mine: [999] });
    expect(await test1TokensOf(c.client, terms, ME, { perCall: 100 })).toEqual({ unused: [999n], used: [] });
    expect(c.calls()).toBe(11);
  });

  it("asks nothing more of a wallet that holds no Test1", async () => {
    const c = chain({ supply: 10_000, mine: [] });
    expect(await test1TokensOf(c.client, terms, ME)).toEqual({ unused: [], used: [] });
    expect(c.calls()).toBe(0);
  });

  it("offers the snapshot first, then a Rig, then a Test1, so a wallet that qualifies anyway keeps its NFTs' gifts", async () => {
    const c = chain({ supply: 100, mine: [42], rigs: [5] });
    // a real snapshot, built and checked against its root the way the game loads it
    const entries: Array<[string, string, string]> = [
      [ME, "500000000", "0"],
      ["0x00000000000000000000000000000000000000cc", "0", "200000000"],
    ];
    const root = StandardMerkleTree.of(
      entries.map((e) => [e[0].toLowerCase(), e[1], e[2]] as [string, string, string]),
      ["address", "uint256", "uint256"],
    ).root as `0x${string}`;
    const withSnap = { ...terms, snapshotRoot: root, bemMin: 100_000_000n, fabMin: 100_000_000n };
    const snap = loadSnapshot({ block: "1", bemMin: "100000000", fabMin: "100000000", root, entries }, withSnap);
    const ways = await giftWays(c.client, withSnap, ME, snap);
    expect(ways.map((w) => w.label)).toEqual(["bem", "rig", "test1"]);
    expect(ways[2]).toEqual({ kind: "nft", collection: TEST1, tokenId: 42n, label: "test1" });
  });

  it("a batch the node fails is asked again; one that keeps failing is reported, never read as holding nothing", async () => {
    // the token sits in the batch that fails, so only asking again can find it
    const c = chain({ supply: 2_000, mine: [500] });
    let fails = 1;
    const flaky = {
      ...c.client,
      readContract: c.client.readContract,
      multicall: async (args: Parameters<PublicClient["multicall"]>[0]) => {
        // the first owners batch fails whole, as viem reports a timed-out batch with failures allowed
        if (fails-- > 0)
          return (args.contracts as unknown[]).map(() => ({ status: "failure", error: new Error("timeout") }));
        return c.client.multicall(args as never);
      },
    } as unknown as PublicClient;
    expect(await test1TokensOf(flaky, terms, ME)).toEqual({ unused: [500n], used: [] });
    const dead = {
      ...c.client,
      readContract: c.client.readContract,
      multicall: async () => Promise.reject(new Error("rate limited")),
    } as unknown as PublicClient;
    await expect(test1TokensOf(dead, terms, ME)).rejects.toBeInstanceOf(Test1Unreadable);
    expect(await giftWaysOf(dead, terms, ME, null)).toEqual({ ways: [], test1: "unreadable" });
  });

  it("does not offer a Test1 that has already given its gift", async () => {
    const c = chain({ supply: 100, mine: [42], used: [[TEST1, 42]] });
    expect(await giftWays(c.client, terms, ME, null)).toEqual([]);
  });
});
