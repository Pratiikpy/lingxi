/**
 * Publishes one of Lingxi's own outfit designs to the fashion market (OutfitMarket), from the deployer.
 *
 *   tsx scripts/publish-outfit.ts --deployment <json> [--rpc <url>] [--key-file <path>] [--mainnet-yes]
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, formatEther, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decodeDesign, encodeDesign } from "@lingxi/art";
import { publishDesign, readDesign } from "../src/outfits";
import type { Deployment } from "../src/registry";
import { xLayer } from "../src/tapeout";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n: string, f?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : f;
};
const d = JSON.parse(readFileSync(arg("deployment")!, "utf8")) as Deployment;
const rpc = arg("rpc", d.rpc)!;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(rpc) && !process.argv.includes("--mainnet-yes")) throw new Error("refusing a non-local node without --mainnet-yes");
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

// a party hat for the hundredth day since Behemoth first ran
const hat = {
  slot: "head" as const,
  colours: ["#2b2140", "#ffc83d", "#ff7a59"],
  cells: [
    [0, 0, 0, 0, 2, 0, 0, 0, 0],
    [0, 0, 0, 1, 2, 1, 0, 0, 0],
    [0, 0, 0, 1, 3, 1, 0, 0, 0],
    [0, 0, 1, 2, 2, 2, 1, 0, 0],
    [0, 0, 1, 3, 3, 3, 1, 0, 0],
    [0, 1, 2, 2, 2, 2, 2, 1, 0],
    [0, 1, 3, 3, 3, 3, 3, 1, 0],
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
  ],
};
const price = parseEther("0.001");
const v1 = { v: 1 as const, address: d.outfitMarket! };
const { id, tx } = await publishDesign(pub, wallet, v1, { pixels: encodeDesign(hat), name: "Hundred-day party hat", price, maxSupply: 100, royaltyBps: 500 });
const back = await readDesign(pub, v1, id);
if (JSON.stringify(decodeDesign(Uint8Array.from(Buffer.from(back.pixels.slice(2), "hex"))).cells) !== JSON.stringify(hat.cells)) throw new Error("the design on chain differs");
console.log(`design #${id} "${back.name}" published: ${tx}; ${formatEther(back.price)} OKB a copy, ${back.maxSupply} copies, creator ${back.creator}`);
