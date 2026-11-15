/**
 * Hatches a pet on a deployment and saves its first day: a few real hours of the
 * game rules (care, then time passing), the state and the input-log hash
 * checkpointed, and the log written out so anyone can replay it on the proof page.
 *
 *   tsx scripts/first-pet.ts --deployment <json> [--rpc <url>] [--key-file <path>] [--name Mochi] [--mainnet-yes]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { STARTERS, compileProgram, fastBrain, stateBits } from "@lingxi/brain";
import { care, catchUp, createPet, packState } from "@lingxi/game";
import { checkpointOnChain, hatchOnChain, readPet, type Deployment } from "../src/registry";
import { xLayer } from "../src/tapeout";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n: string, f?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : f;
};
const depFile = arg("deployment")!;
const d = JSON.parse(readFileSync(depFile, "utf8")) as Deployment;
const rpc = arg("rpc", d.rpc)!;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(rpc) && !process.argv.includes("--mainnet-yes")) throw new Error("refusing a non-local node without --mainnet-yes");
const env = Object.fromEntries(
  readFileSync(arg("key-file", resolve(here, "../../../../.secrets/deployer.env"))!, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const account = privateKeyToAccount((env.DEPLOYER_PRIVATE_KEY ?? env.K) as Hex);
const chain = { ...xLayer, rpcUrls: { default: { http: [rpc] } } };
const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, transport: http(rpc), account });

const program = STARTERS.gentle;
const brain = { fast: fastBrain(compileProgram(program)), nState: stateBits(program), program };
const t0 = Number((await pub.getBlock()).timestamp) * 1000;
let pet = createPet({ name: arg("name", "Mochi")!, line: "gentle", now: t0, tzOffsetMin: 480, brain });
const born = packState(pet, "baby");
const { petId, tx } = await hatchOnChain(pub, wallet, d, 0, "gentle", born);
console.log(`hatched pet #${petId}: ${tx}`);
// its first hours, under the game's own rules
pet = care(pet, { kind: "feed", food: "mochi" }, t0 + 60_000, brain).pet;
pet = care(pet, { kind: "pet" }, t0 + 120_000, brain).pet;
pet = care(pet, { kind: "play" }, t0 + 180_000, brain).pet;
pet = catchUp(pet, t0 + 30 * 60_000, brain);
const cp = await checkpointOnChain(pub, wallet, d, petId, 1, packState(pet, "baby"), pet.logHash as Hex);
const onChain = await readPet(pub, d, petId);
if (onChain.logHash !== pet.logHash) throw new Error("log hash on chain differs");
console.log(`saved day 1: ${cp} (${pet.pendingLog.length} thoughts, log hash ${pet.logHash})`);
const brainId = onChain.brainId.toString();
const out = resolve(here, `../deployments/pet-${petId}-log.json`);
writeFileSync(out, JSON.stringify({ petId: petId.toString(), words: pet.pendingLog, segments: [{ brainId, words: pet.pendingLog }] }));
console.log(`log for the proof page: ${out}`);
