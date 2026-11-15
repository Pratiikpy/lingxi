/**
 * The brain relayer. When a player teaches their pet, its new brain must exist
 * as a TapeOut circuit before the pet can switch to it on chain. We tape it out
 * for them on our processor, once per distinct netlist (pets that learned the
 * same lessons share one circuit), and return its id; the player then calls
 * PetRegistry.setBrain from their own wallet.
 *
 * Abuse limits: the program is rebuilt here from the line and lessons and must
 * pass the same checks as in the game (valid rules, at most 8 lessons, at most
 * 500 gates); per-caller and per-day caps; identical brains are never paid twice.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createPublicClient, createWalletClient, erc20Abi, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type Program, type Rule, type StarterLine, bytesToHex, compileProgram, composeChild, gateCount, netlistBytes } from "@lingxi/brain";
import { FACTORY, processorAbi, transistorsAbi, xLayer } from "@lingxi/chain";
import { type Family, MAX_GATES, composeProgram, halvesOf } from "@lingxi/game";

const NEWLINE = /\r?\n/;

export interface RelayerConfig {
  rpc: string;
  processor: Address;
  key: Hex;
  storeFile: string;
  maxPerDay: number;
}

interface Store {
  brains: Record<string, string>;
  day: string;
  used: number;
}

export type RelayResult = { ok: true; processor: Address; brainId: string; reused: boolean } | { ok: false; reason: "invalid" | "tooBig" | "budget" | "error"; detail?: string };

export class BrainRelayer {
  private readonly pub;
  private readonly wallet;
  private store: Store;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly cfg: RelayerConfig) {
    const chain = { ...xLayer, rpcUrls: { default: { http: [cfg.rpc] } } };
    const account = privateKeyToAccount(cfg.key);
    this.pub = createPublicClient({ chain, transport: http(cfg.rpc) });
    this.wallet = createWalletClient({ chain, transport: http(cfg.rpc), account });
    try {
      this.store = JSON.parse(readFileSync(cfg.storeFile, "utf8")) as Store;
    } catch {
      this.store = { brains: {}, day: "", used: 0 };
    }
  }

  private save(): void {
    mkdirSync(dirname(this.cfg.storeFile), { recursive: true });
    writeFileSync(this.cfg.storeFile, JSON.stringify(this.store, null, 1));
  }

  /** Serialises tape-outs so nonces never collide and the budget is exact. */
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** A pet's brain from its line and lessons. */
  relay(line: StarterLine, lessons: Rule[]): Promise<RelayResult> {
    return this.serial(async () => {
      if (lessons.length > 8) return { ok: false, reason: "invalid", detail: "too many lessons" } as const;
      let program: Program;
      try {
        program = composeProgram(line, lessons);
      } catch (e) {
        return { ok: false, reason: "invalid", detail: (e as Error).message } as const;
      }
      return this.tapeProgram(program);
    });
  }

  /**
   * A child's brain: LX-CHILD/1 REFs to two parent circuits plus the glue. At
   * birth the parents are their current circuits; once the child is taught, each
   * half (child's lessons + that parent's) is taped out first and REF'd instead.
   */
  relayChild(input: { parents: [string, string] } | { family: Family; lessons: Rule[] }): Promise<RelayResult> {
    return this.serial(async () => {
      let ids: [bigint, bigint];
      if ("parents" in input) {
        ids = [BigInt(input.parents[0]), BigInt(input.parents[1])];
      } else {
        if (input.lessons.length > 8) return { ok: false, reason: "invalid", detail: "too many lessons" } as const;
        let halves: [Program, Program];
        try {
          halves = halvesOf(input.family, input.lessons);
        } catch (e) {
          return { ok: false, reason: "invalid", detail: (e as Error).message } as const;
        }
        const got: bigint[] = [];
        for (const h of halves) {
          const r = await this.tapeProgram(h);
          if (!r.ok) return r;
          got.push(BigInt(r.brainId));
        }
        ids = [got[0]!, got[1]!];
      }
      for (const id of ids) {
        try {
          const info = (await this.pub.readContract({ address: this.cfg.processor, abi: processorAbi, functionName: "circuitInfo", args: [id] })) as readonly [bigint, bigint, bigint, bigint];
          if (Number(info[0]) !== 16 || Number(info[1]) !== 8) return { ok: false, reason: "invalid", detail: `circuit ${id} is not a pet brain` } as const;
        } catch {
          return { ok: false, reason: "invalid", detail: `no circuit ${id}` } as const;
        }
      }
      const child = composeChild({ cpu: this.cfg.processor, id: ids[0] }, { cpu: this.cfg.processor, id: ids[1] });
      const glue = child.elements.filter((e) => e.op === 0).length;
      return this.tapeBytes(child.bytes, glue, 0);
    });
  }

  /**
   * Mints transistors. Processors from index 415 on take TapeOut's protocol fee in
   * BEM (approved first, mint price in OKB as value); older ones take everything in
   * OKB. Which one applies is found by simulating, never assumed.
   */
  private async mint(transistors: Address, id: bigint, amount: bigint): Promise<void> {
    const price = (await this.pub.readContract({ address: transistors, abi: transistorsAbi, functionName: "mintPrice" })) as bigint;
    const fee = (await this.pub.readContract({ address: transistors, abi: transistorsAbi, functionName: "protocolFee" })) as bigint;
    const account = this.wallet.account;
    try {
      const sim = await this.pub.simulateContract({ address: transistors, abi: transistorsAbi, functionName: "mint", args: [id, amount], value: price * amount + fee, account });
      const tx = await this.wallet.writeContract(sim.request);
      await this.pub.waitForTransactionReceipt({ hash: tx });
      return;
    } catch {
      // not an OKB-fee processor: pay the protocol fee in BEM
    }
    const bem = (await this.pub.readContract({ address: FACTORY, abi: [{ type: "function", name: "bem", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const, functionName: "bem" })) as Address;
    const ap = await this.pub.simulateContract({ address: bem, abi: erc20Abi, functionName: "approve", args: [transistors, fee], account });
    await this.pub.waitForTransactionReceipt({ hash: await this.wallet.writeContract(ap.request) });
    const sim = await this.pub.simulateContract({ address: transistors, abi: transistorsAbi, functionName: "mint", args: [id, amount], value: price * amount, account });
    await this.pub.waitForTransactionReceipt({ hash: await this.wallet.writeContract(sim.request) });
  }

  private async tapeProgram(program: Program): Promise<RelayResult> {
    const net = compileProgram(program);
    if (gateCount(net) > MAX_GATES) return { ok: false, reason: "tooBig" };
    return this.tapeBytes(netlistBytes(net), net.gates.length, net.latches.length);
  }

  private async tapeBytes(bytes: Uint8Array, nands: number, latches: number): Promise<RelayResult> {
    const key = createHash("sha256").update(bytes).digest("hex");
    const known = this.store.brains[key];
    if (known) return { ok: true, processor: this.cfg.processor, brainId: known, reused: true };

    const today = new Date().toISOString().slice(0, 10);
    if (this.store.day !== today) {
      this.store.day = today;
      this.store.used = 0;
    }
    if (this.store.used >= this.cfg.maxPerDay) return { ok: false, reason: "budget" };

    try {
      const p = this.cfg.processor;
      const transistors = (await this.pub.readContract({ address: p, abi: processorAbi, functionName: "transistors" })) as Address;
      const me = this.wallet.account.address;
      for (const [id, need] of [
        [0n, BigInt(nands)],
        [1n, BigInt(latches)],
      ] as const) {
        if (need === 0n) continue;
        const have = (await this.pub.readContract({ address: transistors, abi: transistorsAbi, functionName: "balanceOf", args: [me, id] })) as bigint;
        if (have >= need) continue;
        const amount = need - have;
        await this.mint(transistors, id, amount);
      }
      const fee = (await this.pub.readContract({ address: p, abi: processorAbi, functionName: "TAPEOUT_FEE" })) as bigint;
      const hex = bytesToHex(bytes) as Hex;
      const { result } = await this.pub.simulateContract({ address: p, abi: processorAbi, functionName: "tapeout", args: [hex, 16, 8], value: fee, account: this.wallet.account });
      const tx = await this.wallet.writeContract({ address: p, abi: processorAbi, functionName: "tapeout", args: [hex, 16, 8], value: fee });
      const r = await this.pub.waitForTransactionReceipt({ hash: tx });
      if (r.status !== "success") return { ok: false, reason: "error", detail: "tapeout reverted" };
      const id = (result as bigint).toString();
      this.store.brains[key] = id;
      this.store.used += 1;
      this.save();
      return { ok: true, processor: p, brainId: id, reused: false };
    } catch (e) {
      return { ok: false, reason: "error", detail: (e as Error).message.split(NEWLINE)[0] };
    }
  }
}
