/**
 * Publishes the on-chain build (apps/web/dist-deweb) to DeWEB through TapeKit's
 * contracts on X Layer, in the container of the gentle starter circuit (#1 on our
 * processor), and activates its name `1.2.<processor index>.tape`.
 *
 *   tsx scripts/publish-deweb.ts --deployment <json> [--rpc <url>] [--circuit 1] [--mainnet-yes]
 *
 * Safe to run again: a file whose on-chain size and SHA-256 already match is skipped,
 * and an upload that stopped half way is finished from the chunk it reached.
 * Contracts (TapeKit README, same addresses on X Layer and Base): container opener
 * 0x536a…0106, SiteRegistry 0xd6EF…ADB6, DomainBinding 0x6880…66f9.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FACTORY, xLayer } from "../src/tapeout";
import type { Deployment } from "../src/registry";

const OPENER = "0x536adD8F30f03b69f6fbF29d425A816A0dC50106" as const;
const SITES = "0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6" as const;
const DOMAINS = "0x68809Fd2fb343aA57D0aeB7f33Defe477c9666f9" as const;
const CHUNK = 24_000;

const openerAbi = parseAbi([
  "function open(address circuits, uint256 tokenId) payable",
  "function accountOf(address circuits, uint256 tokenId) view returns (address)",
  "function isDeployed(address circuits, uint256 tokenId) view returns (bool)",
  "function FEE() view returns (uint256)",
]);
const sitesAbi = parseAbi([
  "function putFile(address container, string path, string contentType, bytes32 sha256Hash, bytes data)",
  "function appendChunk(address container, string path, uint256 expectIndex, bytes data)",
  "function setFallback(address container, string path)",
  "function fileInfo(address container, string path) view returns (uint32 size, string contentType, bytes32 sha256Hash, uint40 updatedAt, uint256 chunkCount)",
  "function fallbackPath(address container) view returns (string)",
  "function pathCount(address container) view returns (uint256)",
  "function pathsRange(address container, uint256 from, uint256 n) view returns (string[])",
  "function removeFile(address container, string path)",
]);
const domainsAbi = parseAbi([
  "function bind(string name, address container, uint256 months) payable",
  "function monthlyFee() view returns (uint256)",
  "function isLive(string name, address container) view returns (bool)",
]);
const factoryIdx = parseAbi([
  "function cpuCount() view returns (uint256)",
  "function cpuAt(uint256 i) view returns (address)",
]);

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  webmanifest: "application/manifest+json",
  png: "image/png",
  gif: "image/gif",
  jpg: "image/jpeg",
  svg: "image/svg+xml",
  woff2: "font/woff2",
  woff: "font/woff",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
};

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n: string, f?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : f;
};
const d = JSON.parse(readFileSync(arg("deployment")!, "utf8")) as Deployment;
const rpc = arg("rpc", d.rpc)!;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(rpc) && !process.argv.includes("--mainnet-yes"))
  throw new Error("refusing a non-local node without --mainnet-yes");
const env = Object.fromEntries(
  readFileSync(resolve(here, "../../../../.secrets/deployer.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY as Hex);
const chain = { ...xLayer, rpcUrls: { default: { http: [rpc] } } };
const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, transport: http(rpc), account });
const circuit = BigInt(arg("circuit", "1")!);
const webDir = resolve(here, "../../../apps/web");
const manifest = JSON.parse(readFileSync(resolve(webDir, "dist-deweb.manifest.json"), "utf8")) as {
  files: Array<{ path: string; size: number; sha256: Hex }>;
  total: number;
};

let gasUsed = 0n;
async function send(label: string, req: Parameters<typeof wallet.writeContract>[0]): Promise<Hex> {
  for (let attempt = 0; ; attempt++) {
    try {
      const tx = await wallet.writeContract(req);
      const r = await pub.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
      if (r.status !== "success") throw new Error(`${label} reverted`);
      gasUsed += r.gasUsed;
      return tx;
    } catch (e) {
      if (attempt >= 3 || /reverted/.test((e as Error).message)) throw e;
      console.log(`  retrying ${label} (${(e as Error).message.split("\n")[0]})`);
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
}

const start = await pub.getBalance({ address: account.address });
// which processor number ours is, for the site's name
const count = (await pub.readContract({ address: FACTORY, abi: factoryIdx, functionName: "cpuCount" })) as bigint;
let index = -1n;
for (let i = count - 1n; i >= 0n && index < 0n; i--) {
  const a = (await pub.readContract({
    address: FACTORY,
    abi: factoryIdx,
    functionName: "cpuAt",
    args: [i],
  })) as Address;
  if (a.toLowerCase() === d.processor.toLowerCase()) index = i;
}
if (index < 0n) throw new Error("processor not found in the factory");
const name = `${circuit}.2.${index}.tape`;
const container = (await pub.readContract({
  address: OPENER,
  abi: openerAbi,
  functionName: "accountOf",
  args: [d.processor, circuit],
})) as Address;
console.log(
  `site ${name}, container ${container}, ${manifest.files.length} files, ${(manifest.total / 1e6).toFixed(2)} MB; deployer ${formatEther(start)} OKB`,
);

if (process.argv.includes("--plan")) {
  // H13b: what a publish of this build would send and cost, read from X Layer and priced by its own gas estimates and
  // gas price; nothing is signed or sent. A chunk after a file's first is priced as a first chunk of the same size (an
  // append cannot be estimated before its file exists; storing the bytes is most of either's gas)
  const gasPrice = await pub.getGasPrice();
  const estimate = (functionName: "putFile" | "removeFile", args: readonly unknown[]) =>
    pub.estimateContractGas({ address: SITES, abi: sitesAbi, functionName, args, account: account.address } as never);
  let gas = 0n;
  let toSend = 0;
  let bytes = 0;
  let chunksToSend = 0;
  for (const f of manifest.files) {
    const data = readFileSync(resolve(webDir, "dist-deweb", f.path));
    const info = (await pub.readContract({
      address: SITES,
      abi: sitesAbi,
      functionName: "fileInfo",
      args: [container, f.path],
    })) as readonly [number, string, Hex, number, bigint];
    const chunks = Math.ceil(data.length / CHUNK) || 1;
    const have = info[2].toLowerCase() === f.sha256.toLowerCase() ? Number(info[4]) : 0;
    if (have >= chunks && info[0] === data.length) continue;
    const type = TYPES[f.path.slice(f.path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";
    for (let i = have; i < chunks; i++) {
      const part = data.subarray(i * CHUNK, (i + 1) * CHUNK);
      gas += await estimate("putFile", [container, `${f.path}.plan-${i}`, type, f.sha256, toHex(part)]);
    }
    toSend++;
    bytes += data.length;
    chunksToSend += chunks - have;
  }
  const wanted = new Set(manifest.files.map((f) => f.path));
  const total = Number(
    (await pub.readContract({ address: SITES, abi: sitesAbi, functionName: "pathCount", args: [container] })) as bigint,
  );
  const onChain: string[] = [];
  for (let from = 0; from < total; from += 200)
    onChain.push(
      ...((await pub.readContract({
        address: SITES,
        abi: sitesAbi,
        functionName: "pathsRange",
        args: [container, BigInt(from), 200n],
      })) as string[]),
    );
  const stale = onChain.filter((p) => !wanted.has(p));
  for (const p of stale) gas += await estimate("removeFile", [container, p]);
  const okb = gas * gasPrice;
  console.log(
    `plan: ${toSend} files to send (${(bytes / 1e6).toFixed(2)} MB, ${chunksToSend} chunks), ${manifest.files.length - toSend} already there, ${stale.length} to remove; about ${gas} gas at ${formatEther(gasPrice * 1_000_000_000n)} gwei, about ${formatEther(okb)} OKB; the deployer holds ${formatEther(start)} OKB`,
  );
  process.exit(0);
}

if (
  !((await pub.readContract({
    address: OPENER,
    abi: openerAbi,
    functionName: "isDeployed",
    args: [d.processor, circuit],
  })) as boolean)
) {
  const fee = (await pub.readContract({ address: OPENER, abi: openerAbi, functionName: "FEE" })) as bigint;
  console.log(
    `opening the container (fee ${formatEther(fee)} OKB): ${await send("open", { address: OPENER, abi: openerAbi, functionName: "open", args: [d.processor, circuit], value: fee, account, chain } as never)}`,
  );
}

let uploaded = 0;
let skipped = 0;
for (const f of manifest.files) {
  const data = readFileSync(resolve(webDir, "dist-deweb", f.path));
  const info = (await pub.readContract({
    address: SITES,
    abi: sitesAbi,
    functionName: "fileInfo",
    args: [container, f.path],
  })) as readonly [number, string, Hex, number, bigint];
  const chunks = Math.ceil(data.length / CHUNK) || 1;
  let have = 0;
  if (info[2].toLowerCase() === f.sha256.toLowerCase() && Number(info[4]) > 0) {
    // the same file: complete, or stopped part way through its chunks
    have = Number(info[4]);
    if (have >= chunks && info[0] === data.length) {
      skipped++;
      continue;
    }
  }
  const ext = f.path.slice(f.path.lastIndexOf(".") + 1).toLowerCase();
  const type = TYPES[ext] ?? "application/octet-stream";
  if (have === 0) {
    await send(`put ${f.path}`, {
      address: SITES,
      abi: sitesAbi,
      functionName: "putFile",
      args: [container, f.path, type, f.sha256, toHex(data.subarray(0, CHUNK))],
      account,
      chain,
    });
    have = 1;
  }
  for (let i = have; i < chunks; i++)
    await send(`chunk ${i} of ${f.path}`, {
      address: SITES,
      abi: sitesAbi,
      functionName: "appendChunk",
      args: [container, f.path, BigInt(i), toHex(data.subarray(i * CHUNK, (i + 1) * CHUNK))],
      account,
      chain,
    });
  // read it back: size and hash must match what was meant (public nodes can lag a block or two behind a receipt)
  let back: readonly [number, string, Hex, number, bigint] = [0, "", "0x", 0, 0n];
  for (let attempt = 0; attempt < 10; attempt++) {
    back = (await pub.readContract({
      address: SITES,
      abi: sitesAbi,
      functionName: "fileInfo",
      args: [container, f.path],
    })) as readonly [number, string, Hex, number, bigint];
    if (back[0] === data.length && back[2].toLowerCase() === f.sha256.toLowerCase()) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (back[0] !== data.length || back[2].toLowerCase() !== f.sha256.toLowerCase())
    throw new Error(`${f.path}: on chain ${back[0]} bytes ${back[2]}, meant ${data.length} ${f.sha256}`);
  uploaded++;
  if (uploaded % 25 === 0) console.log(`  ${uploaded} uploaded, ${skipped} already there`);
}
console.log(`files: ${uploaded} uploaded, ${skipped} already there`);

// files from an earlier build that this one no longer has (old hashed bundles) come off the site
const wanted = new Set(manifest.files.map((f) => f.path));
const total = Number(
  (await pub.readContract({ address: SITES, abi: sitesAbi, functionName: "pathCount", args: [container] })) as bigint,
);
const onChain: string[] = [];
for (let from = 0; from < total; from += 200)
  onChain.push(
    ...((await pub.readContract({
      address: SITES,
      abi: sitesAbi,
      functionName: "pathsRange",
      args: [container, BigInt(from), 200n],
    })) as string[]),
  );
const stale = onChain.filter((p) => !wanted.has(p));
// the agent API's service manifest (TAP-11) lives here too: a build without it must never delete it from chain
if (stale.includes(".well-known/tapeapi.json"))
  throw new Error(
    "the build has no .well-known/tapeapi.json: publishing it would remove the agent API's service manifest from chain (scripts/tap-manifest.mts)",
  );
for (const p of stale)
  await send(`remove ${p}`, {
    address: SITES,
    abi: sitesAbi,
    functionName: "removeFile",
    args: [container, p],
    account,
    chain,
  });
if (stale.length) console.log(`removed ${stale.length} files the build no longer has`);

if (
  ((await pub.readContract({
    address: SITES,
    abi: sitesAbi,
    functionName: "fallbackPath",
    args: [container],
  })) as string) !== "index.html"
) {
  console.log(
    `fallback index.html: ${await send("setFallback", { address: SITES, abi: sitesAbi, functionName: "setFallback", args: [container, "index.html"], account, chain })}`,
  );
}
if (
  !((await pub.readContract({
    address: DOMAINS,
    abi: domainsAbi,
    functionName: "isLive",
    args: [name, container],
  })) as boolean)
) {
  const fee = (await pub.readContract({ address: DOMAINS, abi: domainsAbi, functionName: "monthlyFee" })) as bigint;
  const months = 120n;
  console.log(
    `activating ${name} for ${months} months (${formatEther(fee * months)} OKB): ${await send("bind", { address: DOMAINS, abi: domainsAbi, functionName: "bind", args: [name, container, months], value: fee * months, account, chain } as never)}`,
  );
}
const live = (await pub.readContract({
  address: DOMAINS,
  abi: domainsAbi,
  functionName: "isLive",
  args: [name, container],
})) as boolean;
const paths = (await pub.readContract({
  address: SITES,
  abi: sitesAbi,
  functionName: "pathCount",
  args: [container],
})) as bigint;
const end = await pub.getBalance({ address: account.address });
console.log(
  `${name}: live ${live}, ${paths} paths on chain; ${gasUsed} gas; cost ${formatEther(start - end)} OKB; https://${circuit}-2-${index}.tapekit.org/`,
);
