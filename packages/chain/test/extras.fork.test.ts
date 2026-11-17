/**
 * The paid extras (plan 4.9) through the game's own helpers, on a fork of X Layer mainnet (skipped unless FORK_RPC
 * points at one). Extras is deployed from contracts/out onto the fork against the live pet registry and real BEM;
 * buyers get BEM by setting their balance in the token's storage, so every payment runs through the real token and
 * every burn lands on the real dead address. With DEPLOYMENT_FILE naming a deployment that carries the limited
 * outfits, one is also bought through the item shop and read back as a held piece.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Address, type Hex, createPublicClient, createWalletClient, encodeAbiParameters, erc20Abi, http, keccak256, pad, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  type Deployment,
  buyPack,
  buyShopItem,
  colourName,
  extrasAbi,
  extrasBurned,
  extrasReadiness,
  nameColours,
  packsHeld,
  petRegistryAbi,
  piecesHeld,
  readExtras,
  readShopItems,
  xLayer,
} from "../src/index";

const RPC = process.env.FORK_RPC;
const FILE = process.env.DEPLOYMENT_FILE;
const BEM: Address = "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952";
const REGISTRY: Address = "0x103d7252eb6b2fec22b3f65a6bb605945f280e99";
const DEAD: Address = "0x000000000000000000000000000000000000dEaD";
const PRICE = 5_000_000n; // 0.05 BEM
const fromHere = (rel: string) => new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const artifact = (name: string) => JSON.parse(readFileSync(fromHere(`../../../contracts/out/${name}.sol/${name}.json`), "utf8")) as { bytecode: { object: Hex } };

describe.skipIf(!RPC)("the paid extras on a mainnet fork, through the game's helpers", () => {
  it("packs, a name colour and a limited outfit: real BEM out, the same amount burned, the state the game reads", { timeout: 600_000 }, async () => {
    const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
    const pub = createPublicClient({ chain, transport: http(RPC) });
    const rpc = (m: string, p: unknown[]) => pub.request({ method: m as never, params: p as never });
    const bemOf = (who: Address) => pub.readContract({ address: BEM, abi: erc20Abi, functionName: "balanceOf", args: [who] }) as Promise<bigint>;
    // BEM keeps balances in the mapping at storage slot 5 (found by reading a known balance on X Layer)
    const fundBem = async (who: Address, units: bigint) => {
      const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [who, 5n]));
      await rpc("anvil_setStorageAt", [BEM, slot, pad(toHex(units), { size: 32 })]);
      expect(await bemOf(who)).toBe(units);
    };
    const keys = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()));
    for (const k of keys) await rpc("anvil_setBalance", [k.address, "0x56BC75E2D63100000"]);
    const [owner, alice, bob] = keys.map((account) => createWalletClient({ chain, transport: http(RPC), account }));
    const [o, a, b] = keys;

    // deployed exactly as the deploy script does: eight colours, 0.05 BEM for each extra
    const tx = await owner!.deployContract({ abi: extrasAbi, bytecode: artifact("Extras").bytecode.object, args: [o!.address, BEM, REGISTRY, 8, PRICE, PRICE, PRICE] });
    const extras = (await pub.waitForTransactionReceipt({ hash: tx })).contractAddress!;
    const d = { registry: REGISTRY, extras } as unknown as Deployment;

    const fresh = await readExtras(pub, d, a!.address);
    expect(fresh).toEqual({ room: 0, looks: 0, price: { room: PRICE, looks: PRICE, colour: PRICE }, colours: 8 });
    await fundBem(a!.address, 100_000_000n);
    await fundBem(b!.address, 100_000_000n);
    const ready = await extrasReadiness(pub, d, a!.address, PRICE);
    expect(ready).toEqual({ balance: 100_000_000n, needsApproval: true, enough: true });

    // Alice buys two room packs and one look pack; Bob one look pack
    const dead0 = await bemOf(DEAD);
    await buyPack(pub, alice!, d, "room", PRICE);
    await buyPack(pub, alice!, d, "room", PRICE);
    await buyPack(pub, alice!, d, "looks", PRICE);
    await buyPack(pub, bob!, d, "looks", PRICE);
    expect(await bemOf(a!.address)).toBe(100_000_000n - 3n * PRICE);
    // exactly the price was approved each time, so nothing is left approved afterwards
    expect((await extrasReadiness(pub, d, a!.address, 1n)).needsApproval).toBe(true);
    // packs never add up across wallets: a player's extras are the best one wallet holds
    expect(await packsHeld(pub, d, [a!.address, b!.address])).toEqual({ room: 2, looks: 1 });
    expect(await packsHeld(pub, d, [b!.address])).toEqual({ room: 0, looks: 1 });
    expect(await packsHeld(pub, d, [])).toEqual({ room: 0, looks: 0 });

    // a price changed in flight is refused, and nothing moves
    const setP = await owner!.writeContract({ address: extras, abi: extrasAbi, functionName: "setPrice", args: [0, 7_000_000n] });
    await pub.waitForTransactionReceipt({ hash: setP });
    const before = await bemOf(a!.address);
    await expect(buyPack(pub, alice!, d, "room", PRICE)).rejects.toThrow();
    expect(await bemOf(a!.address)).toBe(before);
    expect((await readExtras(pub, d, a!.address)).room).toBe(2);

    // a real mainnet pet: pet 3 is handed to Alice by its owner on the fork, and only she can colour its name
    const holder = (await pub.readContract({ address: REGISTRY, abi: petRegistryAbi, functionName: "ownerOf", args: [3n] })) as Address;
    await rpc("anvil_impersonateAccount", [holder]);
    await rpc("anvil_setBalance", [holder, "0x56BC75E2D63100000"]);
    const give = await createWalletClient({ chain, transport: http(RPC), account: holder }).writeContract({ address: REGISTRY, abi: petRegistryAbi, functionName: "transferFrom", args: [holder, a!.address, 3n] });
    await pub.waitForTransactionReceipt({ hash: give });
    await rpc("anvil_stopImpersonatingAccount", [holder]);
    await expect(colourName(pub, bob!, d, 3n, 4, PRICE)).rejects.toThrow();
    await colourName(pub, alice!, d, 3n, 4, PRICE);
    expect(await nameColours(pub, d, [1n, 3n])).toEqual({ "1": 0, "3": 4 });
    // back to plain is free
    const beforePlain = await bemOf(a!.address);
    await colourName(pub, alice!, d, 3n, 0, PRICE);
    expect(await bemOf(a!.address)).toBe(beforePlain);
    expect((await nameColours(pub, d, [3n]))["3"]).toBe(0);

    // every BEM that left the buyers is on the dead address, and the contract's own counters agree
    const burned = await extrasBurned(pub, d);
    expect(burned).toEqual({ room: 2n * PRICE, looks: 2n * PRICE, colour: PRICE, stray: 0n, total: 5n * PRICE, sold: { room: 2n, looks: 2n, colour: 1n } });
    expect((await bemOf(DEAD)) - dead0).toBe(5n * PRICE);
    expect(await bemOf(extras)).toBe(0n);

    // the limited outfits, when the deployment under test carries them: bought through the shop, held as pieces
    if (FILE) {
      const dep = JSON.parse(readFileSync(FILE, "utf8")) as Deployment;
      const crown = dep.items?.["nand-crown"];
      if (dep.itemShop && crown) {
        const item = (await readShopItems(pub, dep)).find((i) => i.piece === "nand-crown");
        expect(item?.price).toBe(10_000_000n);
        const dead1 = await bemOf(DEAD);
        await buyShopItem(pub, bob!, dep, BigInt(crown), 1, item!.price);
        expect((await bemOf(DEAD)) - dead1).toBe(10_000_000n);
        expect(await piecesHeld(pub, dep, [b!.address])).toContain("nand-crown");
        expect(await piecesHeld(pub, dep, [a!.address])).not.toContain("nand-crown");
      }
    }
  });
});
