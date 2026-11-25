/**
 * H9 on a fork of X Layer mainnet, against the deployed holder gift and real holders' wallets: a wallet from the BEM and
 * FAB snapshot, a real TapeOut Rig holder and a real TapeCode-Test1 holder each have their way to the pin found from the
 * chain by the game's own helper (no number typed), claim it through the game's helper, and hold the pin after; a
 * second claim is refused; and a Test1 that has given its pin, handed to a stranger, is not offered again.
 */
import { forkHttp } from "./forkRpc";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Address, createPublicClient, createWalletClient, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  type SnapshotFile,
  claimGift,
  copiesHeld,
  giftClaimed,
  giftTerms,
  giftWays,
  loadSnapshot,
  test1TokensOf,
  xLayer,
  type Deployment,
} from "../src/index";

const RPC = process.env.FORK_RPC;
const file =
  process.env.DEPLOYMENT_FILE ??
  new URL("../deployments/xlayer.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const d = JSON.parse(readFileSync(file, "utf8")) as Deployment;
const snapshotFile = JSON.parse(
  readFileSync(
    new URL("../../../apps/web/public/holder-snapshot.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    "utf8",
  ),
) as SnapshotFile;
const nft = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function tokenByIndex(uint256) view returns (uint256)",
  "function transferFrom(address,address,uint256)",
]);

describe.skipIf(!RPC || !d.holderGift)("the holder pin for real holders, found and claimed in two taps (H9)", () => {
  it(
    "snapshot, Rig and Test1 holders each claim through the way the game finds for them",
    { timeout: 1_500_000 },
    async () => {
      const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
      // a fork reads each token's storage from its upstream node the first time, so a batch of owners can take minutes
      const pub = createPublicClient({ chain, transport: forkHttp(RPC, 600_000) });
      const rpc = (m: string, p: unknown[]) => pub.request({ method: m as never, params: p as never });
      const as = async (who: Address) => {
        await rpc("anvil_impersonateAccount", [who]);
        await rpc("anvil_setBalance", [who, "0x56BC75E2D63100000"]);
        return createWalletClient({ chain, transport: forkHttp(RPC), account: who });
      };
      const terms = (await giftTerms(pub, d))!;
      const snap = loadSnapshot(snapshotFile, terms);
      const market = { v: 2 as const, address: d.outfitMarketV2! };

      // three real people's wallets (plain wallets, as a player's is: a contract holding BEM cannot receive the pin, an
      // ERC-1155 token, and cannot play): one in the snapshot by its BEM, a Rig holder, and a Test1 holder who is neither
      const plain = async (w: Address) => ((await pub.getCode({ address: w })) ?? "0x") === "0x";
      let snapWallet: Address | null = null;
      for (const e of snapshotFile.entries)
        if (
          !snapWallet &&
          BigInt(e[1]) >= terms.bemMin &&
          (await plain(e[0] as Address)) &&
          !(await giftClaimed(pub, terms, e[0] as Address))
        )
          snapWallet = e[0] as Address;
      let rigHolder: Address | null = null;
      for (let i = 0n; i < 50n && !rigHolder; i++) {
        const o = (await pub.readContract({
          address: terms.rig,
          abi: nft,
          functionName: "ownerOf",
          args: [await pub.readContract({ address: terms.rig, abi: nft, functionName: "tokenByIndex", args: [i] })],
        })) as Address;
        if (!snap.index.has(o.toLowerCase()) && (await plain(o)) && !(await giftClaimed(pub, terms, o))) rigHolder = o;
      }
      let test1Holder: Address | null = null;
      for (let id = 1n; id <= 300n && !test1Holder; id++) {
        const o = (await pub.readContract({
          address: terms.test1,
          abi: nft,
          functionName: "ownerOf",
          args: [id],
        })) as Address;
        const bal = parseAbi(["function balanceOf(address) view returns (uint256)"]);
        const rigs = (await pub.readContract({
          address: terms.rig,
          abi: bal,
          functionName: "balanceOf",
          args: [o],
        })) as bigint;
        // one Test1, low in the numbering: the lookup stops once it has found as many as the wallet holds
        const ones = (await pub.readContract({
          address: terms.test1,
          abi: bal,
          functionName: "balanceOf",
          args: [o],
        })) as bigint;
        if (
          rigs === 0n &&
          ones === 1n &&
          !snap.index.has(o.toLowerCase()) &&
          (await plain(o)) &&
          !(await giftClaimed(pub, terms, o))
        )
          test1Holder = o;
      }
      expect(snapWallet, "a snapshot wallet").not.toBeNull();
      expect(rigHolder, "a Rig holder outside the snapshot").not.toBeNull();
      expect(test1Holder, "a Test1 holder outside the snapshot with no Rig").not.toBeNull();

      for (const [who, label] of [
        [snapWallet!, "bem"],
        [rigHolder!, "rig"],
        [test1Holder!, "test1"],
      ] as const) {
        if (await giftClaimed(pub, terms, who)) continue;
        // tap one: the game reads the wallet and finds its way, a Test1's number included
        const ways = await giftWays(pub, terms, who, snap);
        expect(ways[0]?.label, `${who}: the first way offered`).toBe(label);
        // tap two: the claim, signed by that wallet
        const w = await as(who);
        const before = (await copiesHeld(pub, market, who, [terms.outfit]))[0]!;
        await claimGift(pub, w, terms, ways[0]!);
        expect(await giftClaimed(pub, terms, who), `${label}: claimed`).toBe(true);
        expect((await copiesHeld(pub, market, who, [terms.outfit]))[0], `${label}: the pin is held`).toBe(before + 1n);
        await expect(claimGift(pub, w, terms, ways[0]!), `${label}: a second claim`).rejects.toThrow();
      }

      // the Test1 that gave its pin, handed to a stranger, is not offered to them
      const used = (await test1TokensOf(pub, terms, test1Holder!)).used[0]!;
      const stranger = privateKeyToAccount(generatePrivateKey()).address;
      const holderWallet = await as(test1Holder!);
      await pub.waitForTransactionReceipt({
        hash: await holderWallet.writeContract({
          address: terms.test1,
          abi: nft,
          functionName: "transferFrom",
          args: [test1Holder!, stranger, used],
        }),
      });
      expect(await test1TokensOf(pub, terms, stranger)).toEqual({ unused: [], used: [used] });
      expect(await giftWays(pub, terms, stranger, snap)).toEqual([]);
    },
  );
});
