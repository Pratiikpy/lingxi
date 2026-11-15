/**
 * Deploys PetLook (on-chain pictures and names), installs the art, checks it, and
 * makes it PetRegistry's renderer. Every step is read back before the next.
 *
 *   tsx scripts/deploy-look.ts --deployment <json> [--rpc <url>] [--key-file <path>] [--mainnet-yes]
 *
 * Checks before switching the registry over: every stored layer equals what was
 * sent, and the picture the contract draws for pet #1 equals the game's sprite.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, formatEther, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CORAL, SHELL } from "@lingxi/art";
import { buildLayers, canvasOfSvg, gameSprite, installCalls, lookOf } from "../src/look";
import { petRegistryAbi } from "../src/registryAbi";
import type { Deployment } from "../src/registry";
import { xLayer } from "../src/tapeout";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n: string, f?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : f;
};
const file = arg("deployment")!;
const d = JSON.parse(readFileSync(file, "utf8")) as Deployment;
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
const art = JSON.parse(readFileSync(resolve(here, "../../../contracts/out/PetLook.sol/PetLook.json"), "utf8")) as { abi: never[]; bytecode: { object: Hex } };
function say(s: string) {
  console.log(s);
}

const regOwner = (await pub.readContract({ address: d.registry, abi: petRegistryAbi, functionName: "owner" })) as Address;
if (regOwner.toLowerCase() !== account.address.toLowerCase()) throw new Error(`the registry is owned by ${regOwner}, not this key`);
const start = await pub.getBalance({ address: account.address });
say(`deployer ${account.address}, ${formatEther(start)} OKB`);

const tx = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode.object, args: [d.registry, account.address] });
const rc = await pub.waitForTransactionReceipt({ hash: tx });
if (rc.status !== "success" || !rc.contractAddress) throw new Error("deploy failed");
const look = rc.contractAddress;
say(`PetLook ${look} (tx ${tx})`);
const send = async (functionName: string, args: unknown[]) => {
  const h = await wallet.writeContract({ address: look, abi: art.abi, functionName: functionName as never, args: args as never });
  const r = await pub.waitForTransactionReceipt({ hash: h });
  if (r.status !== "success") throw new Error(`${functionName} failed`);
  return h;
};
const read = (functionName: string, args: unknown[]) => pub.readContract({ address: look, abi: art.abi, functionName: functionName as never, args: args as never });

const built = buildLayers();
const calls = installCalls(built, CORAL, SHELL);
for (const b of calls.batches) say(`  layers ${b.keys.join(",")}: ${await send("setLayers", [b.keys, b.data])}`);
for (const f of calls.faces) say(`  faces for stage ${f.stage}: ${await send("setFaces", [f.stage, f.large, f.at])}`);
for (const [i, p] of calls.palettes.entries()) say(`  palette ${i}: ${await send("setPalette", [BigInt(i), p])}`);
for (const f of calls.frames) say(`  frame for stage ${f.stage} (${f.x},${f.y} ${f.size}): ${await send("setFrame", [f.stage, f.x, f.y, f.size])}`);

// read everything back
for (const l of built.layers) if (((await read("layer", [BigInt(l.key)])) as string).toLowerCase() !== l.data.toLowerCase()) throw new Error(`layer ${l.key} differs`);
for (const f of calls.faces) if (((await read("faceAt", [f.stage])) as string).toLowerCase() !== f.at.toLowerCase()) throw new Error(`faces ${f.stage} differ`);
for (const f of calls.frames) if (((await read("frame", [f.stage])) as string).toLowerCase() !== `0x${[f.x, f.y, f.size].map((n) => n.toString(16).padStart(2, "0")).join("")}`) throw new Error(`frame ${f.stage} differs`);
const pet1 = (await pub.readContract({ address: d.registry, abi: petRegistryAbi, functionName: "pet", args: [1n] })) as { state: bigint };
const drawn = canvasOfSvg((await read("svgOf", [pet1.state])) as string);
if (JSON.stringify(drawn.px) !== JSON.stringify(gameSprite(lookOf(pet1.state)).px)) throw new Error("pet #1's on-chain picture differs from the game");
say(`read back: ${built.layers.length} layers, 4 face sets, 5 frames, 2 palettes; pet #1 drawn exactly (${JSON.stringify(lookOf(pet1.state))})`);

const sr = await wallet.writeContract({ address: d.registry, abi: petRegistryAbi, functionName: "setRenderer", args: [look] });
if ((await pub.waitForTransactionReceipt({ hash: sr })).status !== "success") throw new Error("setRenderer failed");
const uri = (await pub.readContract({ address: d.registry, abi: petRegistryAbi, functionName: "tokenURI", args: [1n] })) as string;
const meta = JSON.parse(Buffer.from(uri.split(",")[1]!, "base64").toString("utf8")) as { name: string; image: string };
if (!meta.image.startsWith("data:image/svg+xml;base64,")) throw new Error("registry metadata has no picture");
say(`registry renderer set (tx ${sr}); pet #1 metadata: "${meta.name}" with an on-chain picture`);

writeFileSync(file, JSON.stringify({ ...d, look }, null, 2) + "\n");
const end = await pub.getBalance({ address: account.address });
say(`cost ${formatEther(start - end)} OKB; ${file} updated`);
