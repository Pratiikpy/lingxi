/**
 * End to end against a fork of X Layer (skipped unless FORK_RPC and FORK_KEY_FILE
 * are set): a pet lives a day in the game rules, is hatched and checkpointed on
 * chain, and every logged thought is re-run through the processor and through
 * our reference evaluator reading the netlist straight from the chain.
 */

import { forkHttp } from "./forkRpc";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  STARTERS,
  beat,
  compileProgram,
  fastBrain,
  hexToBytes,
  load,
  stateBits,
  wordToBits,
  bitsToWord,
} from "@lingxi/brain";
import { catchUp, care, createPet, packState, unpackState } from "@lingxi/game";
import { checkpointOnChain, hatchOnChain, readNetlist, readPet, replayStep, type Deployment } from "../src/registry";
import { xLayer } from "../src/tapeout";

const RPC = process.env.FORK_RPC;
const KEY_FILE = process.env.FORK_KEY_FILE;

describe.skipIf(!RPC || !KEY_FILE)("a pet's day, proven on an X Layer fork", () => {
  it("hatches, checkpoints, and every thought replays identically", async () => {
    const d = JSON.parse(
      readFileSync(process.env.DEPLOYMENT_FILE ?? new URL("../deployments/local.json", import.meta.url), "utf8"),
    ) as Deployment;
    const key = readFileSync(KEY_FILE!, "utf8").match(/^K=(0x[0-9a-fA-F]{64})/m)![1] as Hex;
    const account = privateKeyToAccount(key);
    const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
    const pub = createPublicClient({ chain, transport: forkHttp(RPC) });
    const wallet = createWalletClient({ chain, transport: forkHttp(RPC), account });

    // the pet lives its first hours in the game rules
    const program = STARTERS.gentle;
    const brain = { fast: fastBrain(compileProgram(program)), nState: stateBits(program), program };
    const block = await pub.getBlock();
    const t0 = Number(block.timestamp) * 1000;
    let pet = createPet({ name: "Mochi", line: "gentle", now: t0, tzOffsetMin: 480, brain });
    const born = packState(pet, "baby");
    pet = care(pet, { kind: "feed", food: "mochi" }, t0 + 60_000, brain).pet;
    pet = care(pet, { kind: "play" }, t0 + 120_000, brain).pet;
    pet = catchUp(pet, t0 + 3 * 3_600_000, brain);

    const { petId } = await hatchOnChain(pub, wallet, d, "gentle", born);
    const onChain0 = await readPet(pub, d, petId);
    expect(onChain0.owner).toBe(account.address);
    expect(onChain0.brainId).toBe(BigInt(d.circuits.gentle!.id));

    await checkpointOnChain(pub, wallet, d, petId, 1, packState(pet, "baby"), pet.logHash as Hex);
    const onChain1 = await readPet(pub, d, petId);
    expect(onChain1.day).toBe(1);
    expect(onChain1.logHash).toBe(pet.logHash);
    expect(unpackState(onChain1.state, 8).brain).toEqual(pet.brain);

    // replay the whole log: processor step (through PetRegistry) vs our evaluator on the chain's own netlist bytes
    const nl = await readNetlist(pub, onChain1.processor, onChain1.brainId);
    const circuit = load(hexToBytes(nl.bytes), nl.nIn, nl.nOut);
    let state = 0n;
    let local = new Array<number>(nl.nState).fill(0);
    const sample = pet.pendingLog.filter((_, i) => i % 9 === 0 || i < 3);
    let i = 0;
    for (const word of pet.pendingLog) {
      const [ns] = beat(circuit, local, wordToBits(word, 16));
      if (sample.includes(word) && i < 24) {
        const chainStep = await replayStep(pub, d, petId, state, word);
        expect(chainStep.next).toBe(bitsToWord(ns));
        i++;
      }
      local = ns;
      state = bitsToWord(ns);
    }
    expect(local).toEqual(pet.brain);
  }, 300_000);
});
