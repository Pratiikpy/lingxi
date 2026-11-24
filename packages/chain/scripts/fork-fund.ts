/**
 * Local fork only: give a test address USDT by writing its balance slot, so red
 * packets can be tried without real money. Refuses to run against anything but a
 * local node.
 *
 *   tsx scripts/fork-fund.ts --to <address> [--usdt 100] [--token <address> --decimals 6] [--okb 1] [--rpc http://127.0.0.1:8547]
 */

import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { XLAYER_USDT } from "../src/redpacket";
import { xLayer } from "../src/tapeout";
import { assertLocal, giveOkb, giveToken } from "./lib/forkFund";

const arg = (n: string, f?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : f;
};
const rpc = arg("rpc", "http://127.0.0.1:8547")!;
assertLocal(rpc);
const to = arg("to") as Address;
const token = (arg("token") ?? XLAYER_USDT) as Address;
const decimals = Number(arg("decimals", "6"));
const amount = BigInt(Math.round(Number(arg("usdt", "100")) * 10 ** decimals));
const okb = arg("okb");
const pub = createPublicClient({
  chain: { ...xLayer, rpcUrls: { default: { http: [rpc] } } },
  transport: http(rpc),
}) as PublicClient;

const slot = await giveToken(pub, token, to, amount);
console.log(`gave ${to} ${Number(amount) / 10 ** decimals} of ${token} (balance slot ${slot})`);
if (okb) {
  await giveOkb(pub, to, BigInt(Math.round(Number(okb) * 1e9)) * 1_000_000_000n);
  console.log(`and ${okb} OKB`);
}
