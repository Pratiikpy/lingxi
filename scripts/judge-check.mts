/**
 * `pnpm judge:check` — check Lingxi against X Layer mainnet without trusting us.
 *
 *   1. our processor is registered with TapeOut's factory
 *   2. every circuit on chain is byte for byte what this repo's compiler produces (SHA-256 shown)
 *   3. pet #1's saved day: its committed log hash and memory are reproduced by replaying its log
 *   4. pet #1's brain answers all 65,536 inputs, at the memory it saved on chain, exactly as the open evaluator
 *   5. the red packet seal answers all 65,536 inputs exactly as its reference
 *
 * Reads only; needs no wallet. About four minutes on the public RPC (220 s measured on 20 November), longer on a busy machine.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPublicClient, http, type Address, type Hex } from "viem";
import {
  STARTERS,
  beat,
  bitsToWord,
  compileProgram,
  compileSeal,
  hexToBytes,
  load,
  netlistBytes,
  sealReference,
  wordToBits,
} from "@lingxi/brain";
import { EVOLUTION, chainLog, unpackState } from "@lingxi/game";
import {
  FACTORY,
  canvasOfSvg,
  factoryAbi,
  gameSprite,
  lookOf,
  processorAbi,
  readMetadata,
  readPet,
  replayMany,
  xLayer,
  type Deployment,
} from "@lingxi/chain";

const d = JSON.parse(
  readFileSync(new URL("../packages/chain/deployments/xlayer.json", import.meta.url), "utf8"),
) as Deployment & { circuits: Record<string, { id: string }> };
const pubs = ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"].map((u) =>
  createPublicClient({ chain: { ...xLayer, rpcUrls: { default: { http: [u] } } }, transport: http(u) }),
);
const pub = pubs[0]!;
let failures = 0;
const ok = (good: boolean, what: string) => {
  if (!good) failures++;
  console.log(`${good ? "PASS" : "FAIL"}  ${what}`);
};
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 16);

console.log(`Lingxi on X Layer (chain ${await pub.getChainId()}), processor ${d.processor}, registry ${d.registry}\n`);

ok(
  (await pub.readContract({
    address: FACTORY,
    abi: factoryAbi,
    functionName: "isCPU",
    args: [d.processor as Address],
  })) as boolean,
  "processor is registered with TapeOut's factory",
);

const expected: Record<string, Uint8Array> = {
  gentle: netlistBytes(compileProgram(STARTERS.gentle)),
  bold: netlistBytes(compileProgram(STARTERS.bold)),
  curious: netlistBytes(compileProgram(STARTERS.curious)),
  evolution: netlistBytes(compileProgram(EVOLUTION)),
  seal: netlistBytes(compileSeal()),
};
for (const [name, bytes] of Object.entries(expected)) {
  const id = BigInt(d.circuits[name]!.id);
  const onChain = hexToBytes(
    (await pub.readContract({
      address: d.processor as Address,
      abi: processorAbi,
      functionName: "netlist",
      args: [id],
    })) as Hex,
  );
  ok(
    sha(onChain) === sha(bytes) && onChain.length === bytes.length,
    `circuit #${id} ${name}: ${bytes.length} bytes, sha256 ${sha(bytes)}… equals this repo's compiler output`,
  );
}

// pet #1: replay its published log
const pet = await readPet(pub, d, 1n);
const log = JSON.parse(
  readFileSync(new URL("../packages/chain/deployments/pet-1-log.json", import.meta.url), "utf8"),
) as { words: number[] };
let h = "0x" + "00".repeat(32);
for (const w of log.words) h = chainLog(h, w);
ok(
  h.toLowerCase() === pet.logHash.toLowerCase(),
  `pet #1 day ${pet.day}: the log's hash chain equals the hash committed on chain (${log.words.length} beats)`,
);
const gentle = load(expected.gentle!, 16, 8);
let mem = new Array<number>(pet.brainBits).fill(0);
for (const w of log.words) mem = beat(gentle, mem, wordToBits(w, 16))[0];
ok(
  JSON.stringify(mem) === JSON.stringify(unpackState(pet.state, pet.brainBits).brain),
  "pet #1: replaying the log gives exactly the memory saved on chain",
);

// the picture the registry serves is drawn on chain by PetLook, and it is the game's own art for the saved state
const meta = await readMetadata(pub, d, 1n);
const svg = meta.image?.startsWith("data:image/svg+xml;base64,")
  ? Buffer.from(meta.image.slice(26), "base64").toString("utf8")
  : "";
ok(
  svg.length > 0 && JSON.stringify(canvasOfSvg(svg).px) === JSON.stringify(gameSprite(lookOf(pet.state)).px),
  `pet #1's picture (tokenURI, drawn by PetLook ${d.look}) equals the game's sprite for its saved state, pixel for pixel`,
);

// every input, through the chain, in batches of 64 spread over both official endpoints
async function everyInput(
  label: string,
  ask: (client: (typeof pubs)[number], words: number[]) => Promise<number[]>,
  expect: (w: number) => number,
) {
  let next = 0;
  let bad = 0;
  const t0 = Date.now();
  const work = async (client: (typeof pubs)[number]) => {
    while (next < 65536) {
      const from = next;
      next += 64;
      const words = Array.from({ length: Math.min(64, 65536 - from) }, (_, k) => from + k);
      let got: number[] = [];
      for (let a = 0; a < 4; a++) {
        try {
          got = await ask(client, words);
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 1000 * (a + 1)));
        }
      }
      words.forEach((w, k) => {
        if (got[k] !== expect(w)) bad++;
      });
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  await Promise.all([0, 1, 2, 3].map((i) => work(pubs[i % 2]!)));
  ok(bad === 0, `${label}: ${65536 - bad} of 65,536 inputs match (${Math.round((Date.now() - t0) / 1000)} s)`);
}

// at the memory pet #1 saved on chain, as the landing, README and proof page say (A56)
const savedMemory = unpackState(pet.state, pet.brainBits).brain;
await everyInput(
  `pet #1's brain at its saved memory (${savedMemory.join("")}), via PetRegistry.replayStep → processor.step`,
  async (client, words) =>
    (await replayMany(client, d, 1n, BigInt(bitsToWord(savedMemory)), words)).map(
      (r) => Number(r.outputs) | (Number(r.next) << 8),
    ),
  (w) => {
    const [ns, outs] = beat(gentle, savedMemory, wordToBits(w, 16));
    return Number(bitsToWord(outs)) | (Number(bitsToWord(ns)) << 8);
  },
);
await everyInput(
  `LX-SEAL/1 (circuit #${d.circuits.seal!.id}) via processor.eval`,
  async (client, words) => {
    const res = (await client.multicall({
      allowFailure: false,
      batchSize: 1 << 22,
      contracts: words.map((w) => ({
        address: d.processor as Address,
        abi: processorAbi,
        functionName: "eval",
        args: [
          BigInt(d.circuits.seal!.id),
          `0x${(w & 0xff).toString(16).padStart(2, "0")}${(w >> 8).toString(16).padStart(2, "0")}` as Hex,
        ],
      })),
    })) as Hex[];
    return res.map((hx) => parseInt(hx.slice(2, 4), 16));
  },
  (w) => sealReference(w),
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
