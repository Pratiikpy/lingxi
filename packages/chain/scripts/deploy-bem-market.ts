/**
 * Deploys the BEM fashion market (OutfitMarketV2) and the holder gift, and records both in the deployment file.
 * Steps: deploy the market (owner: the deployer; paid in BEM); publish the holder pin as a design with no
 * primary sale; deploy the gift with the holder snapshot's root and block; grant it 4,999 pins. Every value is
 * read back from the chain before the deployment file is written.
 *
 *   tsx scripts/deploy-bem-market.ts --deployment <json> --snapshot <holder-snapshot.json> [--rpc <url>] [--key-file <path>] [--mainnet-yes]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Address, type Hex, createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { decodeDesign, encodeDesign } from "@lingxi/art";
import { holderGiftAbi } from "../src/holderGiftAbi";
import { outfitMarketV2Abi } from "../src/outfitMarketV2Abi";
import { publishDesign, readDesign } from "../src/outfits";
import type { SnapshotFile } from "../src/holderGift";
import type { Deployment } from "../src/registry";
import { xLayer } from "../src/tapeout";

export const BEM: Address = "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952";
export const TEST1: Address = "0x0e91460D6823C711643e650A9a4C0cc21DE41614";
export const RIG: Address = "0x9cfc959cd42B2e1d39a0d850c528210E818AE520";
/** How many pins the gift may give: the design's supply less the creator's own copy. */
const GIFTS = 4999;

/** The holder pin: a tiny TapeOut chip worn on the head, gold legs and two lit gates. */
export const HOLDER_PIN = {
  slot: "head" as const,
  cells: [
    [0, 2, 0, 2, 0, 2, 0],
    [2, 1, 1, 1, 1, 1, 2],
    [0, 1, 3, 1, 3, 1, 0],
    [2, 1, 1, 1, 1, 1, 2],
    [0, 2, 0, 2, 0, 2, 0],
  ],
  colours: ["#2b2140", "#ffc83d", "#7fe0c8"],
};

const here = dirname(fileURLToPath(import.meta.url));
/** Addresses compare without regard to letter case (receipts give lower case, contracts give checksums). */
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const arg = (n: string, f?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : f;
};

async function main() {
  const file = arg("deployment")!;
  const d = JSON.parse(readFileSync(file, "utf8")) as Deployment;
  const rpc = arg("rpc", d.rpc)!;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(rpc) && !process.argv.includes("--mainnet-yes")) throw new Error("refusing a non-local node without --mainnet-yes");
  const snap = JSON.parse(readFileSync(arg("snapshot")!, "utf8")) as SnapshotFile;
  // the root is rebuilt here, never taken on trust from the file
  const root = StandardMerkleTree.of(snap.entries.map((e) => [e[0].toLowerCase(), e[1], e[2]]), ["address", "uint256", "uint256"]).root as Hex;
  if (root.toLowerCase() !== snap.root.toLowerCase()) throw new Error("the snapshot file's root does not match its entries");
  const env = Object.fromEntries(
    readFileSync(arg("key-file", resolve(here, "../../../../.secrets/deployer.env"))!, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
  const account = privateKeyToAccount((env.DEPLOYER_PRIVATE_KEY ?? env.K) as Hex);
  const chain = { ...xLayer, rpcUrls: { default: { http: [rpc] } } };
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ chain, transport: http(rpc), account });
  const art = (name: string) => JSON.parse(readFileSync(resolve(here, `../../../contracts/out/${name}.sol/${name}.json`), "utf8")) as { bytecode: { object: Hex } };
  const before = await pub.getBalance({ address: account.address });
  const wait = async (hash: Hex) => {
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`transaction failed: ${hash}`);
    return r;
  };

  // 1. the market
  const mr = await wait(await wallet.deployContract({ abi: outfitMarketV2Abi, bytecode: art("OutfitMarketV2").bytecode.object, args: [account.address, BEM] }));
  const market = mr.contractAddress!;
  const m = { v: 2 as const, address: market };
  const read = <T>(fn: string, args: unknown[] = []) => pub.readContract({ address: market, abi: outfitMarketV2Abi, functionName: fn as never, args: args as never }) as Promise<T>;
  const [owner, bem, fee, burn] = await Promise.all([read<Address>("owner"), read<Address>("bem"), read<number>("feeBps"), read<Address>("BURN")]);
  if (!same(owner, account.address) || !same(bem, BEM) || Number(fee) !== 300 || !same(burn, "0x000000000000000000000000000000000000dEaD")) throw new Error("the market does not read back as configured");

  // 2. the pin, with no primary sale; its pixels must read back exactly
  const pin = await publishDesign(pub, wallet, m, { pixels: encodeDesign(HOLDER_PIN), name: "TapeOut chip pin", price: 0n, maxSupply: GIFTS + 1, royaltyBps: 500 });
  const back = await readDesign(pub, m, pin.id);
  const cells = decodeDesign(Uint8Array.from(Buffer.from(back.pixels.slice(2), "hex"))).cells;
  if (JSON.stringify(cells) !== JSON.stringify(HOLDER_PIN.cells) || back.price !== 0n || back.maxSupply !== GIFTS + 1) throw new Error("the pin does not read back as drawn");

  // 3. the gift, committed to the snapshot
  const bemMin = BigInt(snap.bemMin);
  const fabMin = BigInt(snap.fabMin);
  const gr = await wait(
    await wallet.deployContract({ abi: holderGiftAbi, bytecode: art("HolderGift").bytecode.object, args: [market, pin.id, TEST1, RIG, root, BigInt(snap.block), bemMin, fabMin] }),
  );
  const gift = gr.contractAddress!;
  const g = <T>(fn: string) => pub.readContract({ address: gift, abi: holderGiftAbi, functionName: fn as never }) as Promise<T>;
  const [gm, go, gt, gri, groot, gblock, gb, gf] = await Promise.all([
    g<Address>("market"),
    g<bigint>("outfit"),
    g<Address>("test1"),
    g<Address>("rig"),
    g<Hex>("snapshotRoot"),
    g<bigint>("snapshotBlock"),
    g<bigint>("bemMin"),
    g<bigint>("fabMin"),
  ]);
  if (!same(gm, market) || go !== pin.id || !same(gt, TEST1) || !same(gri, RIG) || groot.toLowerCase() !== root.toLowerCase() || gblock !== BigInt(snap.block) || gb !== bemMin || gf !== fabMin) {
    throw new Error("the gift does not read back as configured");
  }

  // 4. the grant
  await wait(await wallet.writeContract({ address: market, abi: outfitMarketV2Abi, functionName: "setMinter", args: [pin.id, gift, GIFTS] }));
  if (Number(await read<number>("minterCap", [pin.id, gift])) !== GIFTS) throw new Error("the grant does not read back");

  writeFileSync(file, JSON.stringify({ ...d, outfitMarketV2: market, outfitMarketV2Block: Number(mr.blockNumber), holderGift: gift, holderOutfit: Number(pin.id) }, null, 2) + "\n");
  const after = await pub.getBalance({ address: account.address });
  console.log(`OutfitMarketV2 ${market} (block ${mr.blockNumber}); pin #${pin.id}; HolderGift ${gift} (snapshot block ${snap.block}, ${snap.entries.length} wallets, root ${root}); grant ${GIFTS}; cost ${formatEther(before - after)} OKB`);
}

main().catch((e) => (console.error(e), process.exit(1)));
