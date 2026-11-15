/**
 * Local fork only: give a test address USDT by writing its balance slot, so red
 * packets can be tried without real money. Refuses to run against anything but a
 * local node.
 *
 *   tsx scripts/fork-fund.ts --to <address> [--usdt 100] [--rpc http://127.0.0.1:8547]
 */

import { createPublicClient, encodeAbiParameters, http, keccak256, numberToHex, pad, type Address, type Hex } from "viem";
import { XLAYER_USDT } from "../src/redpacket";
import { xLayer } from "../src/tapeout";

const arg = (n: string, f?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : f;
};
const rpc = arg("rpc", "http://127.0.0.1:8547")!;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(rpc)) throw new Error("fork-fund only runs against a local node");
const to = arg("to") as Address;
const amount = BigInt(Math.round(Number(arg("usdt", "100")) * 1e6));
const pub = createPublicClient({ chain: { ...xLayer, rpcUrls: { default: { http: [rpc] } } }, transport: http(rpc) });
const abi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;

for (let slot = 0n; slot < 60n; slot++) {
  const key = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [to, slot]));
  const before = await pub.getStorageAt({ address: XLAYER_USDT, slot: key });
  await pub.request({ method: "anvil_setStorageAt" as never, params: [XLAYER_USDT, key, pad(numberToHex(amount), { size: 32 })] as never });
  const bal = await pub.readContract({ address: XLAYER_USDT, abi, functionName: "balanceOf", args: [to] });
  if (bal === amount) {
    console.log(`gave ${to} ${Number(amount) / 1e6} USDT (balance slot ${slot})`);
    process.exit(0);
  }
  await pub.request({ method: "anvil_setStorageAt" as never, params: [XLAYER_USDT, key, (before ?? pad("0x0", { size: 32 })) as Hex] as never });
}
throw new Error("could not find the USDT balance slot");
