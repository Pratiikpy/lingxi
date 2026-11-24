/**
 * Sets up the relayer's own hot key so the deployer key never runs on a server:
 * creates the key file if missing (never printed), then sends it a little OKB for
 * tape-out fees, a little BEM for mint fees, and part of the transistor pool.
 *
 *   tsx scripts/fund-relayer.ts --deployment <json> [--okb 0.05] [--bem 0.2] [--nand 30000] [--latch 3000] [--mainnet-yes]
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatEther,
  http,
  parseEther,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { FACTORY, xLayer } from "../src/tapeout";
import type { Deployment } from "../src/registry";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n: string, f?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : f;
};
const d = JSON.parse(readFileSync(arg("deployment")!, "utf8")) as Deployment & { transistors: Address };
const rpc = arg("rpc", d.rpc)!;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(rpc) && !process.argv.includes("--mainnet-yes"))
  throw new Error("refusing a non-local node without --mainnet-yes");
const secrets = resolve(here, "../../../../.secrets");
const readEnv = (f: string) =>
  Object.fromEntries(
    readFileSync(f, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
const deployer = privateKeyToAccount(readEnv(resolve(secrets, "deployer.env")).DEPLOYER_PRIVATE_KEY as Hex);
const relayFile = resolve(secrets, "relayer.env");
if (!existsSync(relayFile)) {
  const k = generatePrivateKey();
  writeFileSync(relayFile, `RELAYER_ADDRESS=${privateKeyToAccount(k).address}\nK=${k}\n`, { mode: 0o600 });
}
const relayer = privateKeyToAccount(readEnv(relayFile).K as Hex).address;
const chain = { ...xLayer, rpcUrls: { default: { http: [rpc] } } };
const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, transport: http(rpc), account: deployer });
const wait = async (tx: Hex, label: string) => {
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new Error(`${label} failed`);
  console.log(`  ${label}: ${tx}`);
};

console.log(`relayer ${relayer}`);
const bem = (await pub.readContract({
  address: FACTORY,
  abi: [
    { type: "function", name: "bem", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  ] as const,
  functionName: "bem",
})) as Address;
await wait(
  await wallet.sendTransaction({ to: relayer, value: parseEther(arg("okb", "0.05")!), account: deployer, chain }),
  `send ${arg("okb", "0.05")} OKB`,
);
await wait(
  await wallet.writeContract({
    address: bem,
    abi: erc20Abi,
    functionName: "transfer",
    args: [relayer, parseUnits(arg("bem", "0.2")!, 8)],
    account: deployer,
    chain,
  }),
  `send ${arg("bem", "0.2")} BEM`,
);
const erc1155 = [
  {
    type: "function",
    name: "safeTransferFrom",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
for (const [id, n] of [
  [0n, BigInt(arg("nand", "30000")!)],
  [1n, BigInt(arg("latch", "3000")!)],
] as const) {
  await wait(
    await wallet.writeContract({
      address: d.transistors,
      abi: erc1155,
      functionName: "safeTransferFrom",
      args: [deployer.address, relayer, id, n, "0x"],
      account: deployer,
      chain,
    }),
    `send ${n} of transistor ${id}`,
  );
  console.log(
    `    relayer now holds ${await pub.readContract({ address: d.transistors, abi: erc1155, functionName: "balanceOf", args: [relayer, id] })}`,
  );
}
console.log(
  `relayer OKB ${formatEther(await pub.getBalance({ address: relayer }))}; deployer OKB ${formatEther(await pub.getBalance({ address: deployer.address }))}`,
);
