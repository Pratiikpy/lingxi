/**
 * Deploys the item shop (plan 4.6) beside the BEM market, makes the game's on-chain pieces as item kinds on the
 * market, grants the shop their supply, prices the shop pieces, and records it all in the deployment file.
 * Reads before it writes, so a second run only does what is missing; every value is read back from the chain.
 *
 *   tsx scripts/deploy-item-shop.ts --deployment <json> [--rpc <url>] [--key-file <path>] [--voucher-key-file <path>] [--mainnet-yes]
 *
 * Keys are read from files, never the command line, and never printed. The voucher key only gives its address here.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Address, type Hex, createPublicClient, createWalletClient, formatEther, http, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { WEARABLE } from "@lingxi/art";
import { CHAIN_DECOR, CHAIN_WEAR } from "@lingxi/world";
import { itemShopAbi } from "../src/itemShopAbi";
import { outfitMarketV2Abi } from "../src/outfitMarketV2Abi";
import type { Deployment } from "../src/registry";
import { xLayer } from "../src/tapeout";

/** 0.05 BEM per shop piece (BEM has 8 decimals). */
export const SHOP_PRICE = 5_000_000n;
/** 0.1 BEM per limited outfit (plan 4.9 section 5). */
export const DROP_PRICE = 10_000_000n;
const KEEPSAKE_SUPPLY = 100_000;

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n: string, f?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : f;
};
const readEnv = (file: string) =>
  Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
const say = (s: string) => process.stdout.write(`${s}\n`);

const file = arg("deployment")!;
const d = JSON.parse(readFileSync(file, "utf8")) as Deployment & Record<string, unknown>;
const rpc = arg("rpc", d.rpc)!;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(rpc) && !process.argv.includes("--mainnet-yes")) throw new Error("refusing a non-local node without --mainnet-yes");
const deployer = privateKeyToAccount((readEnv(arg("key-file", resolve(here, "../../../../.secrets/deployer.env"))!).DEPLOYER_PRIVATE_KEY ?? "") as Hex);
const voucherSigner = privateKeyToAccount((readEnv(arg("voucher-key-file", resolve(here, "../../../../.secrets/voucher.env"))!).VOUCHER_PRIVATE_KEY ?? "") as Hex).address;
const chain = { ...xLayer, rpcUrls: { default: { http: [rpc] } } };
const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, transport: http(rpc), account: deployer });
const market = d.outfitMarketV2 as Address;
if (!market) throw new Error("no OutfitMarketV2 in the deployment");

const owner = (await pub.readContract({ address: market, abi: outfitMarketV2Abi, functionName: "owner" })) as Address;
if (owner.toLowerCase() !== deployer.address.toLowerCase()) throw new Error(`the market's owner is ${owner}, not this key`);
const start = await pub.getBalance({ address: deployer.address });
say(`deployer ${deployer.address}, ${formatEther(start)} OKB; market ${market}; voucher signer ${voucherSigner}`);

async function send(address: Address, abi: typeof outfitMarketV2Abi | typeof itemShopAbi, functionName: string, args: readonly unknown[]) {
  const { request } = await pub.simulateContract({ address, abi, functionName, args, account: deployer } as never);
  const tx = await wallet.writeContract(request as never);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new Error(`${functionName} failed: ${tx}`);
  return { tx, r };
}

const save = (patch: Record<string, unknown>) => {
  const cur = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  writeFileSync(file, `${JSON.stringify({ ...cur, ...patch }, null, 2)}\n`);
};

// 1. the shop
let shop = d.itemShop as Address | undefined;
if (!shop) {
  const art = JSON.parse(readFileSync(resolve(here, "../../../contracts/out/ItemShop.sol/ItemShop.json"), "utf8"));
  const bem = (await pub.readContract({ address: market, abi: outfitMarketV2Abi, functionName: "bem" })) as Address;
  const tx = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode.object as Hex, args: [deployer.address, market, bem, voucherSigner] });
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  shop = r.contractAddress as Address;
  say(`ItemShop ${shop} tx ${tx}`);
  save({ itemShop: shop, itemShopBlock: Number(r.blockNumber), voucherSigner, itemShopTx: tx });
}
const signer = (await pub.readContract({ address: shop, abi: itemShopAbi, functionName: "signer" })) as Address;
if (signer.toLowerCase() !== voucherSigner.toLowerCase()) throw new Error(`the shop's signer is ${signer}`);

// 2. each piece: an item kind on the market, granted to the shop, priced if it is sold. Decorations come first
// (plan 4.6), then the limited outfits (plan 4.9).
interface OnChainPiece {
  id: string;
  name: string;
  supply: number;
  /** BEM base units, or 0 for a keepsake that is only claimed */
  price: bigint;
}
const ON_CHAIN: OnChainPiece[] = [
  ...CHAIN_DECOR.map((p) => ({ id: p.id, name: p.name.en, supply: p.chain!.kind === "shop" ? p.chain!.supply : KEEPSAKE_SUPPLY, price: p.chain!.kind === "shop" ? SHOP_PRICE : 0n })),
  ...CHAIN_WEAR.map((p) => ({ id: p.id, name: WEARABLE[p.id]!.name.en, supply: p.supply, price: DROP_PRICE })),
];
const items: Record<string, string> = { ...((JSON.parse(readFileSync(file, "utf8")) as { items?: Record<string, string> }).items ?? {}) };
for (const piece of ON_CHAIN) {
  if (!items[piece.id]) {
    const { tx, r } = await send(market, outfitMarketV2Abi, "createItem", [piece.name, piece.supply]);
    const ev = parseEventLogs({ abi: outfitMarketV2Abi, logs: r.logs, eventName: "ItemCreated" })[0] as { args: { id: bigint } } | undefined;
    if (!ev) throw new Error(`${piece.id}: no ItemCreated event`);
    items[piece.id] = ev.args.id.toString();
    save({ items });
    say(`  ${piece.id}: item ${ev.args.id} (${piece.supply}) tx ${tx}`);
  }
  const id = BigInt(items[piece.id]!);
  const cap = (await pub.readContract({ address: market, abi: outfitMarketV2Abi, functionName: "minterCap", args: [id, shop] })) as number;
  if (cap === 0) {
    const des = (await pub.readContract({ address: market, abi: outfitMarketV2Abi, functionName: "design", args: [id] })) as { maxSupply: number; minted: number };
    await send(market, outfitMarketV2Abi, "setMinter", [id, shop, des.maxSupply - des.minted]);
    say(`  ${piece.id}: shop may make ${des.maxSupply - des.minted}`);
  }
  if (piece.price > 0n) {
    const p = (await pub.readContract({ address: shop, abi: itemShopAbi, functionName: "price", args: [id] })) as bigint;
    if (p !== piece.price) {
      await send(shop, itemShopAbi, "setPrice", [id, piece.price]);
      say(`  ${piece.id}: priced at ${Number(piece.price) / 1e8} BEM`);
    }
  }
}

// 3. read everything back
for (const piece of ON_CHAIN) {
  const id = BigInt(items[piece.id]!);
  const [cap, price, des] = await Promise.all([
    pub.readContract({ address: market, abi: outfitMarketV2Abi, functionName: "minterCap", args: [id, shop] }) as Promise<number>,
    pub.readContract({ address: shop, abi: itemShopAbi, functionName: "price", args: [id] }) as Promise<bigint>,
    pub.readContract({ address: market, abi: outfitMarketV2Abi, functionName: "design", args: [id] }) as Promise<{ maxSupply: number; item: boolean }>,
  ]);
  if (cap === 0 || price !== piece.price || des.maxSupply !== piece.supply || !des.item) throw new Error(`${piece.id}: read back cap ${cap}, price ${price}, supply ${des.maxSupply}, item ${des.item}`);
}
const end = await pub.getBalance({ address: deployer.address });
say(`done: ${ON_CHAIN.length} pieces; spent ${formatEther(start - end)} OKB; wrote ${file}`);
