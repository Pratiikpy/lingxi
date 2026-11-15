/**
 * A home's own page on DeWEB (PRD Z4). Once a pet's home is open, its owner can
 * publish a page into the home's container through TapeKit's SiteRegistry and
 * activate its name `<circuit>.2.<processor index>.tape` through TapeKit's
 * DomainBinding, so the pet has an address of its own, served from X Layer by any
 * TapeKit gateway (https://<circuit>-2-<index>.tapekit.org/).
 *
 * The page is one self-contained file: the pet's picture and name as published,
 * and a small script that reads the pet live from PetRegistry over X Layer's RPC
 * (day, last save, log fingerprint, owner), with links to its proof page.
 * Contracts and their write rules: TapeKit SPEC.md §3 and §8 (the holder of the
 * circuit, or an operator it names, may edit; while a circuit is listed for sale
 * its site is frozen).
 */

import { type Address, type Hex, type PublicClient, type WalletClient, bytesToHex, encodeFunctionData, parseAbi, sha256, stringToBytes } from "viem";
import { FACTORY } from "./tapeout";

export const SITES: Address = "0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6";
export const DOMAINS: Address = "0x68809Fd2fb343aA57D0aeB7f33Defe477c9666f9";
/** SiteRegistry takes at most this many bytes per write. */
export const CHUNK_BYTES = 24_000;
/** How long the name is activated for on first publish. */
export const NAME_MONTHS = 120n;

const sitesAbi = parseAbi([
  "function putFile(address container, string path, string contentType, bytes32 sha256Hash, bytes data)",
  "function appendChunk(address container, string path, uint256 expectIndex, bytes data)",
  "function setFallback(address container, string path)",
  "function fileInfo(address container, string path) view returns (uint32 size, string contentType, bytes32 sha256Hash, uint40 updatedAt, uint256 chunkCount)",
]);
const domainsAbi = parseAbi(["function bind(string name, address container, uint256 months) payable", "function monthlyFee() view returns (uint256)", "function isLive(string name, address container) view returns (bool)"]);
const factoryAbi = parseAbi(["function cpuCount() view returns (uint256)", "function cpuAt(uint256 i) view returns (address)"]);
const registryRead = parseAbi(["function pet(uint256 petId) view returns ((address,uint64,uint8,uint8,uint32,uint40,uint40,bytes32,uint256,uint128,uint128))", "function ownerOf(uint256) view returns (address)"]);

export class HomePageError extends Error {
  constructor(
    readonly code: "tooBig" | "notWritten" | "notLive" | "noProcessor",
    message: string,
  ) {
    super(message);
  }
}

/** The processor's number in TapeOut's factory, which names every site on it. `hint` is checked first. */
export async function processorIndex(pub: PublicClient, processor: Address, hint?: number): Promise<number> {
  const at = (i: bigint) => pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "cpuAt", args: [i] }) as Promise<Address>;
  if (hint !== undefined && (await at(BigInt(hint))).toLowerCase() === processor.toLowerCase()) return hint;
  const count = (await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "cpuCount" })) as bigint;
  for (let i = count - 1n; i >= 0n; i--) if ((await at(i)).toLowerCase() === processor.toLowerCase()) return Number(i);
  throw new HomePageError("noProcessor", "the processor is not in TapeOut's factory");
}

export const homeSiteName = (circuit: bigint, index: number): string => `${circuit}.2.${index}.tape`;
export const homeSiteUrl = (circuit: bigint, index: number): string => `https://${circuit}-2-${index}.tapekit.org/`;

export interface HomePageInput {
  petId: bigint;
  name: string;
  /** the pet's picture as a data URL (PetLook's), or none */
  image?: string;
  registry: Address;
  rpc: string;
  /** the pet's proof page, e.g. https://lingxi.knole.me/verify.html#7 */
  proofUrl: string;
  siteName: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The page published into the home. Everything it shows live is read from X Layer in the visitor's browser. */
export function homePageHtml(p: HomePageInput): string {
  const name = esc(p.name.slice(0, 40));
  const image = p.image && /^data:image\/(svg\+xml|png);base64,[A-Za-z0-9+/=]+$/.test(p.image) ? p.image : "";
  const call = encodeFunctionData({ abi: registryRead, functionName: "pet", args: [p.petId] });
  const owner = encodeFunctionData({ abi: registryRead, functionName: "ownerOf", args: [p.petId] });
  const proof = /^https:\/\/[^\s"'<>]+$/.test(p.proofUrl) ? p.proofUrl : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} · Lingxi</title>
<style>
:root{--bg:#fff7e8;--card:#fffdf8;--ink:#2b2140;--soft:#6b5f80;--line:#2b2140;--accent:#ff7a59}
@media (prefers-color-scheme:dark){:root{--bg:#1d1730;--card:#272040;--ink:#f6efff;--soft:#b9aed0;--line:#f6efff}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px 16px}
main{width:min(460px,100%);background:var(--card);border:2px solid var(--line);border-radius:20px;padding:24px;box-shadow:0 6px 0 var(--line)}
.pic{width:160px;height:160px;margin:0 auto 8px;display:block;image-rendering:pixelated}
h1{margin:4px 0 2px;text-align:center;font-size:28px}.sub{margin:0 0 16px;text-align:center;color:var(--soft)}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0 0 16px}dt{color:var(--soft)}dd{margin:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}
a.btn{display:block;text-align:center;padding:12px;border:2px solid var(--line);border-radius:14px;background:var(--accent);color:#2b2140;font-weight:700;text-decoration:none;margin-top:8px}
.note{font-size:13px;color:var(--soft);margin:14px 0 0}
</style>
</head>
<body>
<main>
${image ? `<img class="pic" src="${image}" alt="${name}" width="160" height="160">` : ""}
<h1>${name}</h1>
<p class="sub"><span data-en="Lingxi pet" data-zh="灵犀宠物">Lingxi pet</span> #${p.petId} · ${esc(p.siteName)}</p>
<dl>
<dt data-en="Day" data-zh="天数">Day</dt><dd id="day">…</dd>
<dt data-en="Last saved" data-zh="上次保存">Last saved</dt><dd id="saved">…</dd>
<dt data-en="Owner" data-zh="主人">Owner</dt><dd id="owner" class="mono">…</dd>
<dt data-en="Log fingerprint" data-zh="日志指纹">Log fingerprint</dt><dd id="log" class="mono">…</dd>
</dl>
${proof ? `<a class="btn" href="${proof}" data-en="Check its mind on X Layer" data-zh="在 X Layer 上核对它的心智">Check its mind on X Layer</a>` : ""}
<p class="note" data-en="This page lives in ${name}'s home on X Layer. The numbers above are read from the chain as you open it." data-zh="这个页面放在${name}在 X Layer 上的家里。上面的数字是你打开时从链上读到的。">This page lives in ${name}'s home on X Layer. The numbers above are read from the chain as you open it.</p>
</main>
<script>
(function(){
var zh=/^zh/i.test(navigator.language||"");
if(zh){document.documentElement.lang="zh";document.querySelectorAll("[data-zh]").forEach(function(e){e.textContent=e.getAttribute("data-zh")});}
function rpc(data){return fetch(${JSON.stringify(p.rpc)},{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_call",params:[{to:${JSON.stringify(p.registry)},data:data},"latest"]})}).then(function(r){return r.json()}).then(function(j){if(!j.result||j.result==="0x")throw new Error("no result");return j.result.slice(2)});}
function word(h,i){return h.slice(i*64,i*64+64)}
function num(w){return parseInt(w.slice(-12),16)}
rpc(${JSON.stringify(call)}).then(function(h){
var day=num(word(h,4)),checked=num(word(h,6));
document.getElementById("day").textContent=String(day);
document.getElementById("saved").textContent=checked?new Date(checked*1000).toLocaleString(zh?"zh-CN":undefined):(zh?"还没有":"not yet");
document.getElementById("log").textContent="0x"+word(h,7);
}).catch(function(){document.getElementById("day").textContent=zh?"暂时读不到 X Layer":"X Layer couldn't be reached";});
rpc(${JSON.stringify(owner)}).then(function(h){document.getElementById("owner").textContent="0x"+h.slice(24,64)}).catch(function(){});
})();
</script>
</body>
</html>
`;
}

export interface HomePageStatus {
  published: boolean;
  live: boolean;
  /** whether the published page is exactly `html` */
  current: boolean;
}

export async function readHomePage(pub: PublicClient, container: Address, siteName: string, html?: string): Promise<HomePageStatus> {
  const [info, live] = await Promise.all([
    pub.readContract({ address: SITES, abi: sitesAbi, functionName: "fileInfo", args: [container, "index.html"] }) as Promise<readonly [number, string, Hex, number, bigint]>,
    pub.readContract({ address: DOMAINS, abi: domainsAbi, functionName: "isLive", args: [siteName, container] }) as Promise<boolean>,
  ]);
  const published = info[4] > 0n;
  return { published, live, current: published && !!html && info[2].toLowerCase() === sha256(stringToBytes(html)).toLowerCase() };
}

/** What activating the name costs (TapeKit's monthly fee times the months), read from the chain. */
export async function nameFee(pub: PublicClient, months = NAME_MONTHS): Promise<bigint> {
  return ((await pub.readContract({ address: DOMAINS, abi: domainsAbi, functionName: "monthlyFee" })) as bigint) * months;
}

/**
 * Writes the page into the home (in chunks when it is larger than one write), makes it the
 * fallback, activates the name if it is not live, and reads all of it back.
 */
export async function publishHomePage(pub: PublicClient, wallet: WalletClient, container: Address, siteName: string, html: string, months = NAME_MONTHS): Promise<Hex[]> {
  const bytes = stringToBytes(html);
  if (bytes.length > CHUNK_BYTES * 8) throw new HomePageError("tooBig", "the page is larger than a home page may be");
  const account = wallet.account!;
  const txs: Hex[] = [];
  const send = async (req: Parameters<PublicClient["simulateContract"]>[0]) => {
    const sim = await pub.simulateContract({ ...req, account } as never);
    const tx = await wallet.writeContract((sim as unknown as { request: never }).request);
    const r = await pub.waitForTransactionReceipt({ hash: tx });
    if (r.status !== "success") throw new HomePageError("notWritten", "a write to the home page reverted");
    txs.push(tx);
  };
  const hash = sha256(bytes);
  await send({ address: SITES, abi: sitesAbi, functionName: "putFile", args: [container, "index.html", "text/html; charset=utf-8", hash, bytesToHex(bytes.slice(0, CHUNK_BYTES))] } as never);
  for (let i = 1; i * CHUNK_BYTES < bytes.length; i++) {
    await send({ address: SITES, abi: sitesAbi, functionName: "appendChunk", args: [container, "index.html", BigInt(i), bytesToHex(bytes.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES))] } as never);
  }
  await send({ address: SITES, abi: sitesAbi, functionName: "setFallback", args: [container, "index.html"] } as never);
  if (!((await pub.readContract({ address: DOMAINS, abi: domainsAbi, functionName: "isLive", args: [siteName, container] })) as boolean)) {
    await send({ address: DOMAINS, abi: domainsAbi, functionName: "bind", args: [siteName, container, months], value: await nameFee(pub, months) } as never);
  }
  const s = await readHomePage(pub, container, siteName, html);
  if (!s.current) throw new HomePageError("notWritten", "the page on chain does not match what was written");
  if (!s.live) throw new HomePageError("notLive", "the name did not activate");
  return txs;
}
