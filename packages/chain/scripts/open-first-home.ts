/**
 * Opens the first Lingxi home on X Layer: the TapeOut container of pet #1's brain
 * circuit, held by the deployer. Reads the fee and the home first, opens it, and
 * reads it back.
 *
 *   tsx scripts/open-first-home.ts [--key-file <path>] --mainnet-yes
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, formatEther, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { openHome, openingFee, readHome } from "../src/home";
import { readPet } from "../src/registry";
import { xLayer } from "../src/tapeout";
import d from "../deployments/xlayer.json";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n: string, f?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : f;
};
if (!process.argv.includes("--mainnet-yes")) throw new Error("this spends real OKB: pass --mainnet-yes");
const env = Object.fromEntries(
  readFileSync(arg("key-file", resolve(here, "../../../../.secrets/deployer.env"))!, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const account = privateKeyToAccount((env.DEPLOYER_PRIVATE_KEY ?? env.K) as Hex);
const pub = createPublicClient({ chain: xLayer, transport: http("https://rpc.xlayer.tech") });
const wallet = createWalletClient({ chain: xLayer, transport: http("https://rpc.xlayer.tech"), account });

async function main() {
  const pet = await readPet(pub as never, d as never, 1n);
  if (pet.owner.toLowerCase() !== account.address.toLowerCase()) throw new Error("the deployer does not own pet #1");
  const processor = pet.processor as Address;
  const before = await readHome(pub as never, processor, pet.brainId);
  const fee = await openingFee(pub as never);
  const balance = await pub.getBalance({ address: account.address });
  console.log(`pet #1 brain: circuit #${pet.brainId} on ${processor}; home ${before.container}; opened ${before.opened}; fee ${formatEther(fee)} OKB; wallet ${formatEther(balance)} OKB`);
  if (before.opened) return console.log("already open");
  if (balance < fee + 10n ** 15n) throw new Error("not enough OKB for the fee and gas");
  const tx = await openHome(pub as never, wallet, processor, pet.brainId);
  const after = await readHome(pub as never, processor, pet.brainId);
  console.log(`opened: ${after.opened}; container ${after.container}; tx ${tx}; wallet now ${formatEther(await pub.getBalance({ address: account.address }))} OKB`);
}
main().catch((e) => (console.error(e), process.exit(1)));
