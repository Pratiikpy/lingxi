/**
 * Season keepsakes on an X Layer mainnet fork (skipped unless FORK_RPC points at
 * a local node): the relayer, under a freshly generated key funded only on the
 * fork, tapes the champion's brain out as a circuit of its own, sends it to the
 * winner, and the netlist read back from the chain is the game's brain byte for
 * byte. A second champion with the same brain gets a second circuit; a child's
 * keepsake REFs its two halves.
 */

import { forkHttp } from "./forkRpc";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  encodeAbiParameters,
  erc20Abi,
  keccak256,
  numberToHex,
  pad,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { compileProgram, netlistBytes } from "@lingxi/brain";
import { FACTORY, circuitMatches, xLayer } from "@lingxi/chain";
import { MAX_LESSONS, PET_SCHOOL, composeProgram } from "@lingxi/game";
import { BrainRelayer } from "../src/relayer";

const RPC = process.env.FORK_RPC;
const PROCESSOR: Address = "0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e";
const ownerAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

async function giveToken(pub: ReturnType<typeof createPublicClient>, token: Address, to: Address, amount: bigint) {
  for (let slot = 0n; slot < 60n; slot++) {
    const key = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [to, slot]));
    const before = await pub.getStorageAt({ address: token, slot: key });
    await pub.request({
      method: "anvil_setStorageAt" as never,
      params: [token, key, pad(numberToHex(amount), { size: 32 })] as never,
    });
    if ((await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [to] })) === amount)
      return;
    await pub.request({
      method: "anvil_setStorageAt" as never,
      params: [token, key, (before ?? pad("0x0", { size: 32 })) as Hex] as never,
    });
  }
  throw new Error("balance slot not found");
}

describe.skipIf(!RPC)("season keepsakes, on an X Layer fork", () => {
  it(
    "tape the champion's brain out fresh, send it to the winner, and read back the same bytes",
    { timeout: 300_000 },
    async () => {
      if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(RPC!)) throw new Error("fork tests run only against a local node");
      const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
      const pub = createPublicClient({ chain, transport: forkHttp(RPC) });
      const key = generatePrivateKey();
      const me = privateKeyToAccount(key).address;
      await pub.request({ method: "anvil_setBalance" as never, params: [me, numberToHex(parseEther("10"))] as never });
      const bem = (await pub.readContract({
        address: FACTORY,
        abi: [
          { type: "function", name: "bem", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
        ] as const,
        functionName: "bem",
      })) as Address;
      await giveToken(pub, bem, me, parseEther("1000000"));
      const relayer = new BrainRelayer({
        rpc: RPC!,
        processor: PROCESSOR,
        key,
        storeFile: join(mkdtempSync(join(tmpdir(), "keepsake-")), "relay.json"),
        maxPerDay: 20,
      });

      const winner = privateKeyToAccount(generatePrivateKey()).address;
      const lessons = [PET_SCHOOL[0]!.rule];
      const a = await relayer.keepsake({ line: "bold", lessons, instincts: 1 }, winner);
      if (!a.ok) throw new Error(`${a.reason} ${a.detail}`);
      expect(
        (
          (await pub.readContract({
            address: PROCESSOR,
            abi: ownerAbi,
            functionName: "ownerOf",
            args: [BigInt(a.brainId)],
          })) as Address
        ).toLowerCase(),
      ).toBe(winner.toLowerCase());
      expect(
        await circuitMatches(
          pub,
          PROCESSOR,
          BigInt(a.brainId),
          netlistBytes(compileProgram(composeProgram("bold", lessons, 1))),
        ),
      ).toBe(true);
      expect(a.tapeTx).toMatch(/^0x[0-9a-f]{64}$/);
      expect(a.sendTx).toMatch(/^0x[0-9a-f]{64}$/);

      // the same brain winning again is a new circuit, and the shared copy stays separate
      const second = privateKeyToAccount(generatePrivateKey()).address;
      const b = await relayer.keepsake({ line: "bold", lessons, instincts: 1 }, second);
      if (!b.ok) throw new Error(`${b.reason} ${b.detail}`);
      expect(b.brainId).not.toBe(a.brainId);
      const shared = await relayer.relay("bold", lessons, 1);
      if (!shared.ok) throw new Error(shared.reason);
      expect([a.brainId, b.brainId]).not.toContain(shared.brainId);

      // a child's keepsake: its halves are taped once and REF'd by a glue circuit sent to the winner
      const family = {
        parents: [
          { name: "Mum", line: "gentle" as const, lessons: [], key: "1" },
          { name: "Dad", line: "curious" as const, lessons: [], key: "2" },
        ] as [never, never],
        generation: 1,
      };
      const c = await relayer.keepsake({ line: "gentle", lessons: [], family: family as never }, winner);
      if (!c.ok) throw new Error(`${c.reason} ${c.detail}`);
      expect(
        (
          (await pub.readContract({
            address: PROCESSOR,
            abi: ownerAbi,
            functionName: "ownerOf",
            args: [BigInt(c.brainId)],
          })) as Address
        ).toLowerCase(),
      ).toBe(winner.toLowerCase());

      // a grown champion whose lesson skills let it hold more than eight lessons (plan 4.4) still gets its keepsake
      const many = [
        ...PET_SCHOOL.map((l) => l.rule),
        { label: "eat when hungry", when: { hunger: [3] }, then: { want: 1, mood: 1 } },
      ].slice(0, 9);
      expect(many).toHaveLength(9);
      const growth = { level: 30, points: 0, skills: { 211: 5, 221: 5, 231: 1, 233: 1, 241: 5, 261: 1 } };
      const d = await relayer.keepsake({ line: "curious", lessons: many as never, growth }, winner);
      if (!d.ok) throw new Error(`${d.reason} ${d.detail}`);
      expect(
        (
          (await pub.readContract({
            address: PROCESSOR,
            abi: ownerAbi,
            functionName: "ownerOf",
            args: [BigInt(d.brainId)],
          })) as Address
        ).toLowerCase(),
      ).toBe(winner.toLowerCase());
      // past the most lessons any pet can hold, the relayer refuses before spending anything
      expect(
        await relayer.keepsake(
          { line: "curious", lessons: Array(MAX_LESSONS + 1).fill(many[0]) as never, growth },
          winner,
        ),
      ).toMatchObject({ ok: false, reason: "invalid" });
      // no wallet, no tape-out
      expect(
        await relayer.keepsake({ line: "bold", lessons }, "0x0000000000000000000000000000000000000000"),
      ).toMatchObject({ ok: false, reason: "invalid" });
    },
  );
});
