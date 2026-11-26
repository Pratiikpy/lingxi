/**
 * The network the game plays on, kept apart from the rest of chain.ts (P3): which deployment, which RPCs, the read client
 * and the wallet's address. Screens that only read X Layer (the hatch screen's holder note among them) import this alone,
 * so they do not pull the whole game store in behind them; chain.ts re-exports all of it.
 */
import type { Hex, PublicClient } from "viem";
import { type Deployment, xLayer } from "@lingxi/chain";
import { lazyPublicClient, viem } from "./chainClient";
import { OFFICIAL_RPCS } from "./nodes";
import localDeployment from "../../../../packages/chain/deployments/local.json";
import xlayerDeployment from "../../../../packages/chain/deployments/xlayer.json";
// a rehearsal of a mainnet deploy on a local fork of X Layer (VITE_CHAIN=rehearsal, test builds only)
import rehearsalDeployment from "../../../../packages/chain/deployments/rehearsal.json";
import { ENV_API, LOCAL_API, ON_LOCALHOST } from "./apiBase";

// X Layer mainnet unless a build asks for a local chain (VITE_CHAIN=local) or a fork rehearsal, so a fresh clone plays
// against the real contracts with no setup
export const NETWORK = (import.meta.env.VITE_CHAIN as string | undefined) || "xlayer";
const DEPLOYMENTS: Record<string, Deployment | undefined> = {
  local: localDeployment as unknown as Deployment,
  xlayer: xlayerDeployment as unknown as Deployment,
  // the condition is a build-time constant, so a production build drops the rehearsal file entirely
  rehearsal: import.meta.env.VITE_CHAIN === "rehearsal" ? (rehearsalDeployment as unknown as Deployment) : undefined,
};
export const deployment: Deployment | undefined = DEPLOYMENTS[NETWORK];
export const explorerTx = (tx: string) => (NETWORK === "local" ? null : `https://www.oklink.com/xlayer/tx/${tx}`);

// VITE_RPC points a test build at a local fork of X Layer; production builds leave it unset
// (an empty value counts as unset, as the on-chain build passes it)
// X Layer's public RPCs. Both drop their CORS headers on a rate-limit reply, which the browser then reports as a
// blocked request: to a burst of 80 at once, OKX's refused 1 and rpc.xlayer.tech 2 (2026-11-19). OKX's is listed first.
export { OFFICIAL_RPCS };
// With a server of our own (VITE_API_URL), the browser reads X Layer through it, same origin, so a public RPC's
// rate-limit reply can never surface as a blocked request; the public RPCs stay behind it as fallbacks. The
// on-chain copy on DeWEB has no server and talks to the public RPCs directly.
export const API_RPC = ENV_API ? `${ENV_API}/api/rpc` : ON_LOCALHOST ? `${LOCAL_API}/api/rpc` : null;
export const rpcs: string[] = (import.meta.env.VITE_RPC as string | undefined)
  ? [import.meta.env.VITE_RPC as string]
  : NETWORK === "xlayer"
    ? [...(API_RPC ? [API_RPC] : []), ...OFFICIAL_RPCS]
    : [deployment?.rpc ?? "https://xlayerrpc.okx.com"];
export const rpc = rpcs[0] ?? "https://xlayerrpc.okx.com";
export const chain = { ...xLayer, rpcUrls: { default: { http: rpcs } } };
// P3: the client is built, and viem's client half loaded, the first time the game reads X Layer (chainClient.ts)
export const publicClient: PublicClient = lazyPublicClient(
  ({ createPublicClient, fallback, http }) =>
    createPublicClient({ chain, transport: fallback(rpcs.map((u) => http(u))) }) as PublicClient,
);

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export function injected(): Eip1193 | null {
  const w = window as unknown as { okxwallet?: Eip1193; ethereum?: Eip1193 };
  return w.okxwallet ?? w.ethereum ?? null;
}

/**
 * The wallet's address, for a check that only reads (C3): it asks for the accounts and nothing else, so the wallet shows
 * no network switch and nothing to sign. Anything that sends a transaction uses connectWallet.
 */
export async function walletAddress(): Promise<Hex> {
  const devKey = import.meta.env.DEV ? (import.meta.env.VITE_DEV_KEY as Hex | undefined) : undefined;
  if (devKey) return (await viem()).privateKeyToAccount(devKey).address;
  const provider = injected();
  if (!provider) {
    // the offer to carry the pets to a browser with a wallet lives with the rest of the moving code (move.ts)
    void import("./move").then((m) => m.walletNeeded());
    throw new Error("noWallet");
  }
  const [address] = (await provider.request({ method: "eth_requestAccounts" })) as Hex[];
  if (!address) throw new Error("noAccount");
  return address;
}
