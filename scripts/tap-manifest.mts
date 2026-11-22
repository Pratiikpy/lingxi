/**
 * The TAP-11 manifest of Lingxi's agent API (plan H7): names the service container (circuit #1 on our processor, the
 * container our DeWEB copy lives in), the key that signs every answer, the holder's delegation of that key, the live
 * endpoint and every method.
 *
 *   npx tsx scripts/tap-manifest.mts                 write apps/web/public/.well-known/tapeapi.json
 *   npx tsx scripts/tap-manifest.mts --check         check the written file against X Layer and the signing key
 *   npx tsx scripts/tap-manifest.mts --publish --mainnet-yes
 *                                                    put the written file in the container's site store, read it back
 *
 * Identity comes from X Layer, never from a file: the container is TapeOut's opener's `accountOf(processor, 1)` and the
 * holder is the processor's `ownerOf(1)`. The signing key holds no funds and lives in `.secrets/tap-signer.env`; it is
 * made here once if it does not exist and is never printed. The delegation is signed with the project wallet, which
 * must be the holder.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Address, type Hex, createPublicClient, createWalletClient, formatEther, getAddress, http, parseAbi, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { xLayer } from "viem/chains";
import { MAX_DELEGATION_S, delegationDigest, recoverDigest } from "../services/api/src/tap";
import { manifestMethods, toolMethods } from "../services/api/src/tapMethods";
import { MCP_TOOLS } from "../services/api/src/mcpToolDefs";
import { hiddenText, toolsDigest } from "../services/api/src/tapTools";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const secrets = resolve(root, "../.secrets");
const OUT = resolve(root, "apps/web/public/.well-known/tapeapi.json");
export const MANIFEST_KEY = ".well-known/tapeapi.json";
const LIVE = "https://lingxi.knole.me/api/v1";
const MCP_ENDPOINT = "https://lingxi.knole.me/mcp";
/** A delegation with at least this long left is kept when the manifest is rewritten, so the holder signs rarely. */
const KEEP_DELEGATION_DAYS = 90;
const allMethods = () => [...manifestMethods(), ...toolMethods(MCP_TOOLS as never)];
function toolsPin(): string {
  const problems = hiddenText(MCP_TOOLS);
  if (problems.length) throw new Error(`the MCP tools carry hidden text (TAP-15 §3.4): ${problems.join("; ")}`);
  const sha = toolsDigest(MCP_TOOLS);
  if (!sha) throw new Error("the MCP tools have no digest (TAP-15 §3.2)");
  return sha;
}
const CIRCUIT = 1n;
/** How long a delegation runs before it is renewed: half a year, inside TAP-11's 366 days. */
const DELEGATION_DAYS = 183;
const OPENER: Address = "0x536adD8F30f03b69f6fbF29d425A816A0dC50106";
const SITES: Address = "0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6";
/** The DeWEB spend this goal allows in total, in wei, and what earlier publishes spent (BUILD-STATUS). */
const DEWEB_ALLOWANCE = 50_000_000_000_000_000n;

const deployment = JSON.parse(readFileSync(resolve(root, "packages/chain/deployments/xlayer.json"), "utf8")) as { processor: Address; rpc: string };
const rpc = process.env.LINGXI_RPC ?? "https://rpc.xlayer.tech";
const pub = createPublicClient({ chain: xLayer, transport: http(rpc) });
const readEnv = (file: string): Record<string, string> =>
  existsSync(file)
    ? Object.fromEntries(
        readFileSync(file, "utf8")
          .split(/\r?\n/)
          .filter((l) => l.includes("="))
          .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
      )
    : {};

async function identity(): Promise<{ container: Address; holder: Address }> {
  const container = (await pub.readContract({ address: OPENER, abi: parseAbi(["function accountOf(address circuits, uint256 tokenId) view returns (address)"]), functionName: "accountOf", args: [deployment.processor, CIRCUIT] })) as Address;
  const holder = (await pub.readContract({ address: deployment.processor, abi: parseAbi(["function ownerOf(uint256) view returns (address)"]), functionName: "ownerOf", args: [CIRCUIT] })) as Address;
  return { container: getAddress(container), holder: getAddress(holder) };
}

function signerKey(): Hex {
  const file = resolve(secrets, "tap-signer.env");
  const have = readEnv(file).TAP_SIGNER_PRIVATE_KEY;
  if (have) return have as Hex;
  const key = generatePrivateKey();
  mkdirSync(secrets, { recursive: true });
  writeFileSync(file, `# signs Lingxi's TAP-13 answers; holds no funds\nTAP_SIGNER_PRIVATE_KEY=${key}\n`, { mode: 0o600 });
  return key;
}

async function write(): Promise<void> {
  const { container, holder } = await identity();
  const signer = privateKeyToAccount(signerKey()).address;
  // a delegation already written for this container and signer, with long enough left, is kept
  const now = Math.floor(Date.now() / 1000);
  const old = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as Partial<Manifest>) : {};
  let expires: number;
  let sig: Hex;
  if (old.container === container && old.signer === signer && old.delegation && old.delegation.expires > now + KEEP_DELEGATION_DAYS * 86_400 && (await recoverDigest(delegationDigest(xLayer.id, container, signer, old.delegation.expires), old.delegation.sig)) === holder) {
    ({ expires, sig } = old.delegation);
  } else {
    const deployer = privateKeyToAccount(readEnv(resolve(secrets, "deployer.env")).DEPLOYER_PRIVATE_KEY as Hex);
    if (deployer.address !== holder) throw new Error(`circuit #${CIRCUIT}'s holder is ${holder}, not the project wallet: the holder must sign the delegation`);
    expires = now + DELEGATION_DAYS * 86_400;
    const digest = delegationDigest(xLayer.id, container, signer, expires);
    // TAP-11 §4.2: the holder signs the EIP-712 digest itself, with no personal_sign prefix
    sig = await deployer.sign({ hash: digest });
    if ((await recoverDigest(digest, sig)) !== holder) throw new Error("the delegation does not recover to the holder");
  }
  const manifest = {
    tapeapi: "0.1",
    name: "Lingxi agent API",
    circuits: getAddress(deployment.processor),
    tokenId: CIRCUIT.toString(),
    container,
    signer,
    delegation: { expires, sig },
    endpoints: { live: [LIVE], async: false },
    methods: allMethods(),
    mcp: { endpoint: MCP_ENDPOINT, toolsSha256: toolsPin() },
  };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(text) > 65_536) throw new Error("the manifest is over 64 KiB");
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  console.log(`wrote ${OUT}: container ${container}, signer ${signer}, delegation until ${new Date(expires * 1000).toISOString().slice(0, 10)}, ${manifest.methods.length} methods, tools ${manifest.mcp.toolsSha256}`);
}

interface Manifest {
  circuits: Address;
  tokenId: string;
  container: Address;
  signer: Address;
  delegation: { expires: number; sig: Hex };
  endpoints: { live: string[] };
  methods: Array<{ name: string }>;
  mcp?: { endpoint: string; toolsSha256: string };
}

async function check(): Promise<Manifest> {
  const m = JSON.parse(readFileSync(OUT, "utf8")) as Manifest;
  const { container, holder } = await identity();
  const bad: string[] = [];
  if (m.circuits.toLowerCase() !== deployment.processor.toLowerCase()) bad.push("circuits is not our processor");
  if (m.tokenId !== CIRCUIT.toString() || m.container !== container) bad.push("the manifest names another circuit or container");
  const now = Math.floor(Date.now() / 1000);
  if (!(now < m.delegation.expires && m.delegation.expires <= now + MAX_DELEGATION_S)) bad.push("the delegation has expired or runs too far ahead");
  if ((await recoverDigest(delegationDigest(xLayer.id, container, m.signer, m.delegation.expires), m.delegation.sig)) !== holder) bad.push("the delegation is not the holder's");
  if (privateKeyToAccount(signerKey()).address !== m.signer) bad.push("the signing key in .secrets is not the manifest's signer");
  const names = allMethods().map((x) => x.name);
  if (JSON.stringify(m.methods.map((x) => x.name)) !== JSON.stringify(names)) bad.push("the methods differ from the API's");
  if (m.mcp?.endpoint !== MCP_ENDPOINT || m.mcp.toolsSha256 !== toolsPin()) bad.push("mcp.toolsSha256 is not the digest of the tools the server lists");
  if (bad.length) throw new Error(bad.join("; "));
  console.log(`manifest checks against X Layer: container ${container}, holder ${holder}, signer ${m.signer}, ${m.methods.length} methods`);
  return m;
}

async function publish(): Promise<void> {
  if (!process.argv.includes("--mainnet-yes")) throw new Error("refusing to write to X Layer without --mainnet-yes");
  const m = await check();
  const deployer = privateKeyToAccount(readEnv(resolve(secrets, "deployer.env")).DEPLOYER_PRIVATE_KEY as Hex);
  const wallet = createWalletClient({ chain: xLayer, transport: http(rpc), account: deployer });
  const data = readFileSync(OUT);
  const sha = `0x${createHash("sha256").update(data).digest("hex")}` as Hex;
  const sitesAbi = parseAbi([
    "function putFile(address container, string path, string contentType, bytes32 sha256Hash, bytes data)",
    "function fileInfo(address container, string path) view returns (uint32 size, string contentType, bytes32 sha256Hash, uint40 updatedAt, uint256 chunkCount)",
  ]);
  const before = (await pub.readContract({ address: SITES, abi: sitesAbi, functionName: "fileInfo", args: [m.container, MANIFEST_KEY] })) as readonly [number, string, Hex, number, bigint];
  if (before[2].toLowerCase() === sha && Number(before[4]) > 0 && before[0] === data.length) {
    console.log(`already on chain: ${MANIFEST_KEY}, ${data.length} bytes, sha256 ${sha}`);
    return;
  }
  const req = { address: SITES, abi: sitesAbi, functionName: "putFile", args: [m.container, MANIFEST_KEY, "application/json", sha, toHex(data)], account: deployer, chain: xLayer } as const;
  const gas = await pub.estimateContractGas(req);
  const price = await pub.getGasPrice();
  const spent = BigInt(process.env.LINGXI_DEWEB_SPENT_WEI ?? "0");
  if (!process.env.LINGXI_DEWEB_SPENT_WEI) throw new Error("set LINGXI_DEWEB_SPENT_WEI to what DeWEB has spent so far (BUILD-STATUS), so the allowance is kept");
  const cost = (gas * price * 12n) / 10n;
  console.log(`putting ${MANIFEST_KEY} (${data.length} bytes): about ${formatEther(cost)} OKB; DeWEB spent so far ${formatEther(spent)} of ${formatEther(DEWEB_ALLOWANCE)}`);
  if (spent + cost > DEWEB_ALLOWANCE) throw new Error("this write would pass the DeWEB allowance");
  const tx = await wallet.writeContract(req);
  const r = await pub.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
  if (r.status !== "success") throw new Error(`putFile reverted: ${tx}`);
  const fee = r.gasUsed * r.effectiveGasPrice;
  for (let attempt = 0; attempt < 10; attempt++) {
    const back = (await pub.readContract({ address: SITES, abi: sitesAbi, functionName: "fileInfo", args: [m.container, MANIFEST_KEY] })) as readonly [number, string, Hex, number, bigint];
    if (back[2].toLowerCase() === sha && back[0] === data.length) {
      console.log(`on chain: ${MANIFEST_KEY} in ${m.container}, ${back[0]} bytes, sha256 ${sha}, tx ${tx}, fee ${formatEther(fee)} OKB (DeWEB total now ${formatEther(spent + fee)})`);
      return;
    }
    await new Promise((ok) => setTimeout(ok, 3000));
  }
  throw new Error(`written in ${tx} but not read back`);
}

if (process.argv.includes("--publish")) await publish();
else if (process.argv.includes("--check")) await check();
else await write();
