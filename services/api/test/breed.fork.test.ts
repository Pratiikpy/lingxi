/**
 * Families on an X Layer fork (skipped unless FORK_RPC and RELAY_KEY_FILE are set):
 * two owners hatch pets, both grow up, the partner gives consent, the relayer tapes
 * out the child circuit (REFs to both parents' brains plus the glue), the Breeder
 * hatches the child, and the child's on-chain thoughts match the game's child brain.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { STARTERS, compileProgram, fastBrain, stateBits } from "@lingxi/brain";
import { allowPartnerOnChain, breedOnChain, checkpointOnChain, hatchOnChain, readPet, replayStep, setBrainOnChain, type Deployment, xLayer } from "@lingxi/chain";
import { createPet, familyOf, mindBrain, packState } from "@lingxi/game";
import { BrainRelayer } from "../src/relayer";

const RPC = process.env.FORK_RPC;
const RELAY_KEY_FILE = process.env.RELAY_KEY_FILE;

describe.skipIf(!RPC || !RELAY_KEY_FILE)("a family, proven on an X Layer fork", () => {
  it("consent, child circuit, Breeder checks, and the child thinks as both parents", async () => {
    const d = JSON.parse(readFileSync(new URL("../../../packages/chain/deployments/local.json", import.meta.url), "utf8")) as Deployment;
    expect(d.breeder).toBeTruthy();
    const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
    const pub = createPublicClient({ chain, transport: http(RPC) });
    const rpc = (method: string, params: unknown[]) => pub.request({ method: method as never, params: params as never });

    // two fresh owners and a stranger, funded on the fork
    const owners = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()));
    for (const o of owners) await rpc("anvil_setBalance", [o.address, "0x56BC75E2D63100000"]);
    const [alice, bob, mallory] = owners.map((account) => createWalletClient({ chain, transport: http(RPC), account }));

    const brainOf = (line: "gentle" | "bold") => {
      const p = STARTERS[line];
      return { fast: fastBrain(compileProgram(p)), nState: stateBits(p), program: p };
    };
    const t0 = Number((await pub.getBlock()).timestamp) * 1000;
    const petA = createPet({ name: "Mochi", line: "gentle", now: t0, tzOffsetMin: 0, brain: brainOf("gentle") });
    const petB = createPet({ name: "Tofu", line: "bold", now: t0, tzOffsetMin: 0, brain: brainOf("bold") });
    const { petId: a } = await hatchOnChain(pub, alice!, d, 0, "gentle", packState(petA, "baby"));
    const { petId: b } = await hatchOnChain(pub, bob!, d, 1, "bold", packState(petB, "baby"));

    // nine days later both are grown, and their checkpoints say so
    await rpc("evm_increaseTime", [9 * 86_400]);
    await rpc("evm_mine", []);
    await checkpointOnChain(pub, alice!, d, a, 9, packState(petA, "adult"), petA.logHash as Hex);
    await checkpointOnChain(pub, bob!, d, b, 9, packState(petB, "adult"), petB.logHash as Hex);
    const [pa, pb] = [await readPet(pub, d, a), await readPet(pub, d, b)];

    const env = Object.fromEntries(readFileSync(RELAY_KEY_FILE!, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
    const relayer = new BrainRelayer({ rpc: RPC!, processor: d.processor as Address, key: (env.K ?? env.LINGXI_RELAYER_KEY) as Hex, storeFile: join(mkdtempSync(join(tmpdir(), "lx-")), "brains.json"), maxPerDay: 50 });
    const child = await relayer.relayChild({ parents: [pa.brainId.toString(), pb.brainId.toString()] });
    expect(child.ok).toBe(true);
    if (!child.ok) return;

    // without consent the Breeder refuses
    await expect(breedOnChain(pub, alice!, d, a, b, d.processor as Address, BigInt(child.brainId), 0)).rejects.toThrow(/NoConsent|reverted/);
    await allowPartnerOnChain(pub, bob!, d, b, alice!.account!.address);
    // a stranger cannot use that consent
    await expect(breedOnChain(pub, mallory!, d, a, b, d.processor as Address, BigInt(child.brainId), 0)).rejects.toThrow(/NotYours|reverted/);
    // a circuit that is not this couple's child is refused
    await expect(breedOnChain(pub, alice!, d, a, b, d.processor as Address, pa.brainId, 0)).rejects.toThrow(/NotAChildOf|reverted/);

    const { childId } = await breedOnChain(pub, alice!, d, a, b, d.processor as Address, BigInt(child.brainId), 0);
    const kid = await readPet(pub, d, childId);
    expect(kid.owner).toBe(alice!.account!.address);
    expect(kid.parentA).toBe(a);
    expect(kid.parentB).toBe(b);
    expect(kid.brainBits).toBe(pa.brainBits + pb.brainBits);

    // the child's thoughts on chain equal the game's child brain, beat after beat
    const family = familyOf({ name: "Mochi", line: "gentle", lessons: [] }, { name: "Tofu", line: "bold", lessons: [] });
    const game = mindBrain({ line: "gentle", lessons: [], family });
    expect(game.nState).toBe(kid.brainBits);
    const mem = new Uint8Array(game.nState);
    let state = 0n;
    let seed = 3;
    for (let i = 0; i < 24; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const word = seed & 0xffff;
      const out = game.fast.step(mem, word);
      const step = await replayStep(pub, d, childId, state, word);
      expect(step.outputs).toBe(out);
      const local = Array.from(mem).reduce((v, bit, k) => v | (BigInt(bit) << BigInt(k)), 0n);
      expect(step.next).toBe(local);
      state = step.next;
    }

    // teaching the child: both halves gain the lesson, a new child circuit REFs them, and the chain agrees
    const share = { when: { event: [1] }, then: { want: 7, mood: 2, nudge: 6 } };
    const taught = await relayer.relayChild({ family, lessons: [share as never] });
    expect(taught.ok).toBe(true);
    if (!taught.ok) return;
    await setBrainOnChain(pub, alice!, d, childId, d.processor as Address, BigInt(taught.brainId));
    const after = mindBrain({ line: "gentle", lessons: [share as never], family });
    const mem2 = new Uint8Array(after.nState);
    let st2 = 0n;
    for (let i = 0; i < 16; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const word = (seed & 0xffff) | (1 << 13); // a friend is near: the lesson's own condition
      const out = after.fast.step(mem2, word);
      const step = await replayStep(pub, d, childId, st2, word);
      expect(step.outputs).toBe(out);
      st2 = step.next;
    }

    // and both parents now rest
    await expect(breedOnChain(pub, alice!, d, a, b, d.processor as Address, BigInt(child.brainId), 0)).rejects.toThrow(/TooSoon|reverted/);
  }, 600_000);
});
