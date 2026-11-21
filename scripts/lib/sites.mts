/**
 * What the two sites are built from, and whether a site is current (A85): shared by the status check and the claims
 * check, so the live site and the on-chain copy are judged by one rule.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Address, type Hex, createPublicClient, hexToBytes, hexToString, http, parseAbi } from "viem";

/** What the web build (both sites) is made of: a change here needs a rebuild. Tests change nothing a site serves. */
export const SITE_INPUTS = [
  "apps/web/src", "apps/web/public", "apps/web/*.html", "apps/web/vite.config.ts", "apps/web/package.json", "apps/web/scripts",
  ...["brain", "game", "world", "art", "send", "handheld", "chain"].flatMap((p) => [`packages/${p}/src`, `packages/${p}/package.json`]),
  "packages/handheld/wasm", "packages/chain/deployments", "pnpm-lock.yaml",
  ":(exclude)**/*.test.ts", ":(exclude)**/*.test.tsx",
];
/** And the live server's own code and settings, with the request schemas it validates by (the game reads only their types). */
export const SERVER_INPUTS = ["services/api/src", "services/api/package.json", "packages/api/src", "packages/api/package.json", "deploy"];

/** DeWEB keeps each file on chain; the gateway answers a plain request with its own loader, so read the file itself. */
export const DEWEB = { opener: "0x536adD8F30f03b69f6fbF29d425A816A0dC50106", sites: "0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6", circuit: 1n } as const;

/** A file of the on-chain copy (its first 4 KB), read from X Layer itself, not through the gateway. */
export async function onChainFile(root: string, path: string): Promise<string> {
  const deployment = JSON.parse(readFileSync(join(root, "packages/chain/deployments/xlayer.json"), "utf8")) as { processor: Address };
  const pub = createPublicClient({ transport: http("https://rpc.xlayer.tech", { timeout: 20_000 }) });
  const container = (await pub.readContract({ address: DEWEB.opener, abi: parseAbi(["function accountOf(address circuits, uint256 tokenId) view returns (address)"]), functionName: "accountOf", args: [deployment.processor, DEWEB.circuit] })) as Address;
  const bytes = (await pub.readContract({ address: DEWEB.sites, abi: parseAbi(["function readRange(address container, string path, uint256 offset, uint256 length) view returns (bytes)"]), functionName: "readRange", args: [container, path, 0n, 4096n] })) as Hex;
  return hexToString(bytes);
}

/** A whole file of the on-chain copy, read from X Layer in pieces (A127): what the page itself is made of. */
export async function onChainWhole(root: string, path: string, piece = 196_608): Promise<string> {
  const deployment = JSON.parse(readFileSync(join(root, "packages/chain/deployments/xlayer.json"), "utf8")) as { processor: Address };
  const pub = createPublicClient({ transport: http("https://rpc.xlayer.tech", { timeout: 30_000 }) });
  const container = (await pub.readContract({ address: DEWEB.opener, abi: parseAbi(["function accountOf(address circuits, uint256 tokenId) view returns (address)"]), functionName: "accountOf", args: [deployment.processor, DEWEB.circuit] })) as Address;
  const read = parseAbi(["function readRange(address container, string path, uint256 offset, uint256 length) view returns (bytes)"]);
  const parts: Uint8Array[] = [];
  for (let offset = 0; ; offset += piece) {
    const bytes = hexToBytes((await pub.readContract({ address: DEWEB.sites, abi: read, functionName: "readRange", args: [container, path, BigInt(offset), BigInt(piece)] })) as Hex);
    parts.push(bytes);
    if (bytes.length < piece) break;
  }
  return Buffer.concat(parts).toString("utf8");
}

export type Served = { commit: string; dirty: boolean; builtAt: string };

/** A site's `build.json`, read. */
export function parseBuild(text: string): Served | string {
  const j = JSON.parse(text) as { commit?: unknown; dirty?: unknown; builtAt?: unknown };
  if (typeof j.commit !== "string") return "build.json has no commit";
  return { commit: j.commit, dirty: j.dirty === true, builtAt: String(j.builtAt) };
}

/**
 * Whether a site built from `s` serves `head`: built from it, or from an older commit when nothing it is made of changed
 * since (`unchangedSince` asks git); a build from uncommitted changes never does.
 */
export function currentness(s: Served, head: string, unchangedSince: (commit: string) => boolean): { current: boolean; why: string } {
  if (s.dirty) return { current: false, why: `built from uncommitted changes on top of ${s.commit.slice(0, 12)}` };
  if (s.commit === head) return { current: true, why: `serves ${s.commit.slice(0, 12)}, built ${s.builtAt}` };
  if (unchangedSince(s.commit)) return { current: true, why: `serves ${s.commit.slice(0, 12)}; nothing it is built from has changed since` };
  return { current: false, why: `serves ${s.commit.slice(0, 12)}, and what it is built from changed since: redeploy` };
}

/** Where the README's images say which live build they were taken from (A100). */
export const SHOTS_FILE = "docs/readme/shots.json";

/** Records that `files` were just taken from the site at `site`, built from the commit its build.json names. */
export async function recordShots(root: string, site: string, files: string[]): Promise<void> {
  const r = await fetch(`${site}/build.json`, { headers: { "cache-control": "no-cache" } });
  const built = parseBuild(await r.text());
  if (typeof built === "string") throw new Error(`${site}: ${built}`);
  const path = join(root, SHOTS_FILE);
  let kept: Record<string, { commit: string; at: string }> = {};
  try {
    kept = JSON.parse(readFileSync(path, "utf8")) as typeof kept;
  } catch {
    // the first shots
  }
  const at = new Date().toISOString().slice(0, 10);
  for (const f of files) kept[f] = { commit: built.commit, at };
  writeFileSync(path, `${JSON.stringify(Object.fromEntries(Object.entries(kept).sort()), null, 2)}\n`);
}
