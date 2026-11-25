/**
 * Skills on chain, on a fork of X Layer mainnet (skipped unless FORK_RPC, RELAY_KEY_FILE and DEPLOYMENT_FILE are
 * set). A pet holding capstone rule skills (plan 4.4) has its brain taped out by the relayer with those rules in
 * it; the pet's brain on chain is set to that circuit; and the chain's own replay of the circuit must answer every
 * input exactly as the game's brain with the same skills does, including the inputs where a skill rule decides.
 */

import { forkHttp } from "./forkRpc";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Address, type Hex, createPublicClient, createWalletClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { STARTERS, compileProgram, encodeSenses, fastBrain, stateBits } from "@lingxi/brain";
import { type Deployment, hatchOnChain, readPet, replayStep, setBrainOnChain, xLayer } from "@lingxi/chain";
import { type Growth, createPet, mindBrain, packState, ruleSkillIds, skillRules } from "@lingxi/game";
import { BrainRelayer } from "../src/relayer";

const RPC = process.env.FORK_RPC;
const RELAY_KEY_FILE = process.env.RELAY_KEY_FILE;
const FILE = process.env.DEPLOYMENT_FILE;

describe.skipIf(!RPC || !RELAY_KEY_FILE || !FILE)("a skilled brain, taped out and replayed on an X Layer fork", () => {
  it(
    "the circuit on chain answers exactly as the game's brain with the same capstone rules",
    { timeout: 600_000 },
    async () => {
      const d = JSON.parse(readFileSync(FILE!, "utf8")) as Deployment;
      const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
      const pub = createPublicClient({ chain, transport: forkHttp(RPC) });
      const owner = privateKeyToAccount(generatePrivateKey());
      await pub.request({
        method: "anvil_setBalance" as never,
        params: [owner.address, "0x56BC75E2D63100000"] as never,
      });
      const wallet = createWalletClient({ chain, transport: forkHttp(RPC), account: owner });

      // a pet holding all four rule capstones: Early to Bed, Cuddle Bug, Brave Heart, Thinks Ahead
      const growth: Growth = { level: 60, points: 0, skills: { 132: 1, 162: 1, 232: 1, 262: 1 } };
      expect(ruleSkillIds(growth)).toEqual([132, 162, 232, 262]);
      const game = mindBrain({ line: "gentle", lessons: [], growth });

      // the relayer tapes it out with the same rules, by id, as the game sends them
      const env = Object.fromEntries(
        readFileSync(RELAY_KEY_FILE!, "utf8")
          .split(/\r?\n/)
          .filter((l) => l.includes("="))
          .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
      );
      const relayer = new BrainRelayer({
        rpc: RPC!,
        processor: d.processor as Address,
        key: (env.K ?? env.LINGXI_RELAYER_KEY) as Hex,
        storeFile: join(mkdtempSync(join(tmpdir(), "lx-")), "brains.json"),
        maxPerDay: 50,
      });
      const r = await relayer.relay("gentle", [], 0, ruleSkillIds(growth));
      if (!r.ok) throw new Error(`relay: ${r.reason}`);
      // a forged id is refused, not taped out
      expect(await relayer.relay("gentle", [], 0, [111])).toMatchObject({ ok: false, reason: "invalid" });

      // a pet hatched and moved onto that circuit
      const brain = { fast: fastBrain(compileProgram(STARTERS.gentle)), nState: stateBits(STARTERS.gentle) };
      const pet = createPet({ name: "Skilled", line: "gentle", now: Date.now(), tzOffsetMin: 0, brain });
      const { petId } = await hatchOnChain(pub, wallet, d, "gentle", packState(pet, "baby"));
      await setBrainOnChain(pub, wallet, d, petId, d.processor as Address, BigInt(r.brainId));
      expect((await readPet(pub, d, petId)).brainId).toBe(BigInt(r.brainId));
      expect((await readPet(pub, d, petId)).brainBits).toBe(game.nState);

      // the four situations where a skill rule decides, then a spread of ordinary words, through both brains
      const decisive = [
        encodeSenses({ hunger: 0, joy: 1, energy: 0, clean: 2, time: 3, action: 0, event: 0, owner: 0 }), // tired in the evening
        encodeSenses({ hunger: 0, joy: 3, energy: 2, clean: 2, time: 2, action: 5, event: 0, owner: 1 }), // happy and petted
        encodeSenses({ hunger: 0, joy: 2, energy: 2, clean: 2, time: 2, action: 0, event: 3, owner: 1 }), // frightened, owner near
        encodeSenses({ hunger: 2, joy: 2, energy: 2, clean: 2, time: 2, action: 0, event: 0, owner: 0 }), // getting hungry
      ];
      const wants = decisive.map((w) => game.fast.step(new Uint8Array(game.nState), w) & 7);
      expect(wants).toEqual(skillRules(growth).map((rule) => rule.then.want));
      let seed = 7;
      const words = [...decisive];
      for (let i = 0; i < 28; i++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        words.push(seed & 0xffff);
      }
      const mem = new Uint8Array(game.nState);
      let state = 0n;
      for (const word of words) {
        const out = game.fast.step(mem, word);
        const step = await replayStep(pub, d, petId, state, word);
        expect(step.outputs).toBe(out);
        const local = Array.from(mem).reduce((v, bit, k) => v | (BigInt(bit) << BigInt(k)), 0n);
        expect(step.next).toBe(local);
        state = step.next;
      }
    },
  );
});
