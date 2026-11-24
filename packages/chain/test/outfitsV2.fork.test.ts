/**
 * The BEM fashion market and the holder gift through the game's own helpers, on a fork of X Layer mainnet
 * (skipped unless FORK_RPC points at one, e.g. `anvil --fork-url https://rpc.xlayer.tech`). The contracts are
 * deployed from contracts/out onto the fork; buyers get real BEM by setting their balance in the token's
 * storage, so every payment runs through the real BEM contract.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  erc20Abi,
  http,
  keccak256,
  pad,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encodeDesign } from "@lingxi/art";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import {
  type Market,
  type SnapshotFile,
  loadSnapshot,
  bemBurned,
  bemReadiness,
  buyDesign,
  buyListing,
  checkTest1,
  claimGift,
  copiesHeld,
  formatBem,
  giftClaimed,
  giftTerms,
  giftWays,
  holderGiftAbi,
  listCopies,
  outfitMarketV2Abi,
  parseBem,
  parseWearKey,
  proceedsOwed,
  publishDesign,
  readDesign,
  readListings,
  wearKey,
  withdrawProceeds,
  xLayer,
} from "../src/index";

const RPC = process.env.FORK_RPC;
const BEM: Address = "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952";
const TEST1: Address = "0x0e91460D6823C711643e650A9a4C0cc21DE41614";
const RIG: Address = "0x9cfc959cd42B2e1d39a0d850c528210E818AE520";
const DEAD: Address = "0x000000000000000000000000000000000000dEaD";
const artifact = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../contracts/out/${name}.sol/${name}.json`, import.meta.url).pathname.replace(
        /^\/([A-Za-z]:)/,
        "$1",
      ),
      "utf8",
    ),
  ) as { bytecode: { object: Hex } };

describe("BEM amounts", () => {
  it("parse and format with 8 decimals", () => {
    expect(parseBem("0.25")).toBe(25_000_000n);
    expect(parseBem("1")).toBe(100_000_000n);
    expect(parseBem("0.000000001")).toBeNull();
    expect(parseBem("-1")).toBeNull();
    expect(parseBem("abc")).toBeNull();
    expect(formatBem(25_000_000n)).toBe("0.25");
    expect(formatBem(100_000_000n)).toBe("1");
    expect(formatBem(1n)).toBe("0.00000001");
  });
  it("wear keys keep market 1's old ids and give market 2 its own", () => {
    expect(wearKey(1, 5n)).toBe("c:5");
    expect(wearKey(2, 5n)).toBe("c2:5");
    expect(parseWearKey("c:5")).toEqual({ v: 1, id: 5n });
    expect(parseWearKey("c2:12")).toEqual({ v: 2, id: 12n });
    expect(parseWearKey("u:abc")).toBeNull();
  });
});

describe.skipIf(!RPC)("the BEM market and the holder gift on a mainnet fork, through the game's helpers", () => {
  it(
    "publish, approve and buy in BEM, resell, burn, withdraw; then holders claim the gift",
    { timeout: 600_000 },
    async () => {
      const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
      const pub = createPublicClient({ chain, transport: http(RPC) });
      const rpc = (m: string, p: unknown[]) => pub.request({ method: m as never, params: p as never });
      // BEM keeps balances in the mapping at storage slot 5 (found by reading a known balance on X Layer)
      const fundBem = async (who: Address, units: bigint) => {
        const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [who, 5n]));
        await rpc("anvil_setStorageAt", [BEM, slot, pad(toHex(units), { size: 32 })]);
        expect(await pub.readContract({ address: BEM, abi: erc20Abi, functionName: "balanceOf", args: [who] })).toBe(
          units,
        );
      };
      const keys = [0, 1, 2, 3].map(() => privateKeyToAccount(generatePrivateKey()));
      for (const k of keys) await rpc("anvil_setBalance", [k.address, "0x56BC75E2D63100000"]);
      const [owner, creator, alice, bob] = keys.map((account) =>
        createWalletClient({ chain, transport: http(RPC), account }),
      );
      const [o, c, a, b] = keys;

      // deploy the market and the gift exactly as the deploy script will
      const mtx = await owner!.deployContract({
        abi: outfitMarketV2Abi,
        bytecode: artifact("OutfitMarketV2").bytecode.object,
        args: [o!.address, BEM],
      });
      const market = (await pub.waitForTransactionReceipt({ hash: mtx })).contractAddress!;
      const m: Market = { v: 2, address: market };

      // a creator publishes; Alice buys two copies; the fee is burned on the real token
      const drawing = {
        slot: "held" as const,
        cells: [
          [0, 1, 0],
          [1, 2, 1],
          [0, 3, 0],
          [0, 3, 0],
        ],
        colours: ["#2b2140", "#ffc83d", "#7a5236"],
      };
      const { id } = await publishDesign(pub, creator!, m, {
        pixels: encodeDesign(drawing),
        name: "Sun staff",
        price: parseBem("0.1")!,
        maxSupply: 50,
        royaltyBps: 500,
      });
      const design = await readDesign(pub, m, id);
      expect(design.market).toBe(2);
      expect(design.item).toBe(false);
      await fundBem(a!.address, parseBem("1")!);
      await fundBem(b!.address, parseBem("1")!);
      const ready = await bemReadiness(pub, m, a!.address, parseBem("0.2")!);
      expect(ready.needsApproval).toBe(true);
      expect(ready.enough).toBe(true);
      const deadBefore = (await pub.readContract({
        address: BEM,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [DEAD],
      })) as bigint;
      await buyDesign(pub, alice!, m, id, 2, design.price);
      expect((await copiesHeld(pub, m, a!.address, [id]))[0]).toBe(2n);
      expect((await bemReadiness(pub, m, a!.address, 1n)).allowance).toBe(0n); // the exact amount was approved and used

      // Alice resells one copy to Bob for 0.5 BEM
      const { listingId } = await listCopies(pub, alice!, m, id, 1, parseBem("0.5")!, { days: 7 });
      const open = await readListings(pub, m);
      const mine = open.find((l) => l.id === listingId)!;
      expect(mine.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000) + 6 * 86_400);
      expect(mine.buyer).toBeNull();
      await buyListing(pub, bob!, m, listingId, 1, parseBem("0.5")!);
      expect((await copiesHeld(pub, m, b!.address, [id]))[0]).toBe(1n);

      // 3% of 0.2 + 3% of 0.5 burned, matched by the dead address and the market's own total
      const burned = await bemBurned(pub, m);
      expect(burned).toBe(parseBem("0.021")!);
      const deadAfter = (await pub.readContract({
        address: BEM,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [DEAD],
      })) as bigint;
      expect(deadAfter - deadBefore).toBe(burned);
      expect(await proceedsOwed(pub, m, c!.address)).toBe(parseBem("0.194")! + parseBem("0.025")!);
      expect(await proceedsOwed(pub, m, a!.address)).toBe(parseBem("0.46")!);
      await withdrawProceeds(pub, alice!, m);
      expect(
        await pub.readContract({ address: BEM, abi: erc20Abi, functionName: "balanceOf", args: [a!.address] }),
      ).toBe(parseBem("0.8")! + parseBem("0.46")!);

      // the holder gift: the owner publishes the pin, deploys the gift, grants it
      const { id: pin } = await publishDesign(pub, owner!, m, {
        pixels: encodeDesign(drawing),
        name: "Holder pin",
        price: 0n,
        maxSupply: 5000,
        royaltyBps: 500,
      });
      // a snapshot file as the snapshot script writes it: Bob (0.5 BEM), Carol (20 FAB), Alice below both minimums
      const carol = privateKeyToAccount(generatePrivateKey());
      const file: SnapshotFile = {
        block: "76000000",
        bemMin: parseBem("0.1")!.toString(),
        fabMin: parseBem("10")!.toString(),
        root: "",
        entries: [
          [b!.address, parseBem("0.5")!.toString(), "0"],
          [carol.address, "0", parseBem("20")!.toString()],
          [a!.address, parseBem("0.05")!.toString(), parseBem("1")!.toString()],
        ],
      };
      const root = StandardMerkleTree.of(
        file.entries.map((e) => [e[0].toLowerCase(), e[1], e[2]]),
        ["address", "uint256", "uint256"],
      ).root as Hex;
      file.root = root;
      const gtx = await owner!.deployContract({
        abi: holderGiftAbi,
        bytecode: artifact("HolderGift").bytecode.object,
        args: [market, pin, TEST1, RIG, root, 76_000_000n, parseBem("0.1")!, parseBem("10")!],
      });
      const gift = (await pub.waitForTransactionReceipt({ hash: gtx })).contractAddress!;
      const stx = await owner!.writeContract({
        address: market,
        abi: outfitMarketV2Abi,
        functionName: "setMinter",
        args: [pin, gift, 4999],
      });
      await pub.waitForTransactionReceipt({ hash: stx });
      const terms = (await giftTerms(pub, {
        chainId: 196,
        rpc: RPC!,
        processor: DEAD,
        registry: DEAD,
        circuits: {},
        holderGift: gift,
      }))!;
      expect(terms.outfit).toBe(pin);

      // the snapshot loads only when its root matches the contract; a tampered file is refused
      const snap = loadSnapshot(file, terms);
      expect(() =>
        loadSnapshot(
          { ...file, entries: [[b!.address, parseBem("5")!.toString(), "0"], ...file.entries.slice(1)] },
          terms,
        ),
      ).toThrow();
      expect(() => loadSnapshot({ ...file, block: "1" }, terms)).toThrow();
      expect(await giftWays(pub, terms, a!.address, snap)).toEqual([]); // below both minimums
      expect((await giftWays(pub, terms, carol.address, snap)).map((w) => w.label)).toEqual(["fab"]);

      // Bob held 0.5 BEM at the snapshot: he claims through it, once
      const ways = await giftWays(pub, terms, b!.address, snap);
      expect(ways.map((w) => w.label)).toEqual(["bem"]);
      await claimGift(pub, bob!, terms, ways[0]!);
      expect(await giftClaimed(pub, terms, b!.address)).toBe(true);
      expect((await copiesHeld(pub, m, b!.address, [pin]))[0]).toBe(1n);
      await expect(claimGift(pub, bob!, terms, ways[0]!)).rejects.toThrow();

      // the real owner of TapeCode-Test1 #1 confirms its number and claims through it
      const holder = (await pub.readContract({
        address: TEST1,
        abi: [
          {
            type: "function",
            name: "ownerOf",
            stateMutability: "view",
            inputs: [{ type: "uint256" }],
            outputs: [{ type: "address" }],
          },
        ],
        functionName: "ownerOf",
        args: [1n],
      })) as Address;
      expect(await checkTest1(pub, terms, a!.address, 1n)).toBe("notYours");
      expect(await checkTest1(pub, terms, holder, 999_999n)).toBe("missing");
      expect(await checkTest1(pub, terms, holder, 1n)).toBe("ok");
      await rpc("anvil_impersonateAccount", [holder]);
      await rpc("anvil_setBalance", [holder, "0x56BC75E2D63100000"]);
      const holderWallet = createWalletClient({ chain, transport: http(RPC), account: holder });
      await claimGift(pub, holderWallet, terms, { kind: "nft", collection: TEST1, tokenId: 1n, label: "test1" });
      expect((await copiesHeld(pub, m, holder, [pin]))[0]).toBe(1n);
      expect(await checkTest1(pub, terms, holder, 1n)).toBe("used");
      await rpc("anvil_stopImpersonatingAccount", [holder]);
    },
  );
});
