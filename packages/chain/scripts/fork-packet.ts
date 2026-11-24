/**
 * A real lucky red packet on a local X Layer fork, for testing the game against it: a sender funded on the fork makes
 * a packet of `shares` shares, and `opened` friends each open one (reserve, two blocks, reveal), through the same
 * helpers the game uses. Prints the packet's id and one-time key as JSON. Fork only: it writes balances directly.
 *
 *   FORK_RPC=http://127.0.0.1:8582 DEPLOYMENT_FILE=deployments/rehearsal.json tsx scripts/fork-packet.ts 3 2
 */

import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  numberToHex,
  pad,
  type Address,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { XLAYER_USDT, claimPacket, createPacket, revealPacket, signClaim } from "../src/redpacket";
import type { Deployment } from "../src/registry";
import { xLayer } from "../src/tapeout";

const RPC = process.env.FORK_RPC;
const FILE = process.env.DEPLOYMENT_FILE;
if (!RPC || !FILE) throw new Error("set FORK_RPC (a local fork, never mainnet) and DEPLOYMENT_FILE");
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(RPC))
  throw new Error("FORK_RPC must be a local fork: this script writes balances directly");
const shares = Number(process.argv[2] ?? 3);
const opened = Number(process.argv[3] ?? 2);

const d = JSON.parse(readFileSync(FILE, "utf8")) as Deployment;
const chain = { ...xLayer, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const rpc = (m: string, p: unknown[]) => pub.request({ method: m as never, params: p as never });

const people = Array.from({ length: opened + 1 }, () => privateKeyToAccount(generatePrivateKey()));
for (const a of people) await rpc("anvil_setBalance", [a.address, "0x56BC75E2D63100000"]);
const [sender, ...friends] = people.map((account) => createWalletClient({ chain, transport: http(RPC), account }));
// USDT keeps balances in slot 0
const total = BigInt(shares) * 1_000_000n;
const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [sender!.account!.address, 0n]));
await rpc("anvil_setStorageAt", [XLAYER_USDT, slot, pad(numberToHex(total), { size: 32 })]);

const key = generatePrivateKey();
const { id } = await createPacket(pub, sender!, d, {
  token: XLAYER_USDT,
  total,
  count: shares,
  lifetimeSec: 86_400,
  key: privateKeyToAccount(key).address,
  lucky: true,
  petOwnersOnly: false,
});
for (const f of friends)
  await claimPacket(pub, f, d, id, await signClaim(pub, d, key, id, f.account!.address as Address));
await rpc("evm_mine", []);
await rpc("evm_mine", []);
for (const f of friends) await revealPacket(pub, f, d, id);
console.log(
  JSON.stringify({
    id: String(id),
    key: key.slice(2),
    sender: sender!.account!.address,
    opened: friends.map((f) => f.account!.address),
    block: Number(await pub.getBlockNumber()),
  }),
);
