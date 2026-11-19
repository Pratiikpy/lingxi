/**
 * An owned instinct on an X Layer fork (skipped unless FORK_RPC and RELAY_KEY_FILE
 * are set): a pet is hatched, a circuit is taped out to serve as its instinct, the
 * relayer tapes the LX-INSTINCT/1 circuit that REFs both, the pet's brain is set
 * to it, and every beat the registry replays on chain matches the game's mind,
 * built from the circuit as read back from the chain.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { STARTERS, validateProgram } from "@lingxi/brain";
import { hatchOnChain, readOutsideCircuit, readPet, replayStep, setBrainOnChain, type Deployment, xLayer } from "@lingxi/chain";
import { createPet, mindBrain, packState } from "@lingxi/game";
import { BrainRelayer } from "../src/relayer";

const RPC = process.env.FORK_RPC;
const RELAY_KEY_FILE = process.env.RELAY_KEY_FILE;

describe.skipIf(!RPC || !RELAY_KEY_FILE)("an owned instinct, proven on an X Layer fork", () => {
  it("the instinct circuit REFs the pet's brain and the owned circuit, and the chain thinks as the game does", async () => {
    const file = process.env.DEPLOYMENT_FILE ?? new URL("../../../packages/chain/deployments/local.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const d = JSON.parse(readFileSync(file, "utf8")) as Deployment;
    const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
    const pub = createPublicClient({ chain, transport: http(RPC) });
    const rpc = (method: string, params: unknown[]) => pub.request({ method: method as never, params: params as never });
    const owner = privateKeyToAccount(generatePrivateKey());
    await rpc("anvil_setBalance", [owner.address, "0x56BC75E2D63100000"]);
    const alice = createWalletClient({ chain, transport: http(RPC), account: owner });

    const t0 = Number((await pub.getBlock()).timestamp) * 1000;
    const pet = createPet({ name: "Mochi", line: "bold", now: t0, tzOffsetMin: 0, brain: { fast: mindBrain({ line: "bold", lessons: [] }).fast, nState: mindBrain({ line: "bold", lessons: [] }).nState, program: STARTERS.bold } });
    const { petId } = await hatchOnChain(pub, alice, d, "bold", packState(pet, "baby"));
    const before = await readPet(pub, d, petId);

    const env = Object.fromEntries(readFileSync(RELAY_KEY_FILE!, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
    const relayer = new BrainRelayer({ rpc: RPC!, processor: d.processor as Address, key: (env.K ?? env.LINGXI_RELAYER_KEY) as Hex, storeFile: join(mkdtempSync(join(tmpdir(), "lx-")), "brains.json"), maxPerDay: 50 });

    // the circuit to be owned: a small brain with memory, taped out as any player could
    const instinct = validateProgram({ version: "LX-PET/1", memory: [{ kind: "counter", name: "friends", bits: 2, inc: [{ event: [1] }] }], rules: [{ when: { friends: [2, 3], event: [1] }, then: { want: 7, mood: 3, nudge: 6 } }, { when: { event: [3] }, then: { want: 4, mood: 0 } }], otherwise: { want: 0, mood: 1 } });
    const taped = await relayer.relayProgram(instinct);
    expect(taped.ok).toBe(true);
    if (!taped.ok) return;

    // a non-pet circuit or a non-processor is refused before any tape-out
    expect((await relayer.relayInstinct({ own: before.brainId.toString(), processor: d.registry as Address, id: taped.brainId })).ok).toBe(false);

    const composed = await relayer.relayInstinct({ own: before.brainId.toString(), processor: d.processor as Address, id: taped.brainId });
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    await setBrainOnChain(pub, alice, d, petId, d.processor as Address, BigInt(composed.brainId));
    const after = await readPet(pub, d, petId);

    // the game builds the same mind from the owned circuit as read back from the chain
    const read = await readOutsideCircuit(pub as never, d.processor as Address, BigInt(taped.brainId));
    const mind = mindBrain({ line: "bold", lessons: [], outside: { processor: read.processor, id: read.id, owner: read.owner, parts: read.parts } });
    expect(after.brainBits).toBe(mind.nState);
    expect(after.brainBits).toBe(before.brainBits + read.nState);

    const mem = new Uint8Array(mind.nState);
    let state = 0n;
    let seed = 5;
    let spoke = 0;
    for (let i = 0; i < 32; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const word = (seed & 0xffff) | (i % 3 === 0 ? 1 << 13 : 0); // a friend comes by now and then
      const out = mind.fast.step(mem, word);
      const step = await replayStep(pub, d, petId, state, word);
      expect(step.outputs).toBe(out);
      const local = Array.from(mem).reduce((v, bit, k) => v | (BigInt(bit) << BigInt(k)), 0n);
      expect(step.next).toBe(local);
      state = step.next;
      if (mind.instinct && (out & 7) === 7) spoke++;
    }
    expect(spoke).toBeGreaterThan(0);
  }, 600_000);
});
