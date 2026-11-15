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
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type Rule, type StarterLine, bytesToHex, compileProgram, gateCount, netlistBytes } from "@lingxi/brain";
import { processorAbi, transistorsAbi, xLayer } from "@lingxi/chain";
import { MAX_GATES, composeProgram } from "@lingxi/game";

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
  relay(line: StarterLine, lessons: Rule[]): Promise<RelayResult> {
    const run = this.queue.then(() => this.doRelay(line, lessons));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async doRelay(line: StarterLine, lessons: Rule[]): Promise<RelayResult> {
    if (lessons.length > 8) return { ok: false, reason: "invalid", detail: "too many lessons" };
    let program;
    try {
      program = composeProgram(line, lessons);
    } catch (e) {
      return { ok: false, reason: "invalid", detail: (e as Error).message };
    }
    const net = compileProgram(program);
    if (gateCount(net) > MAX_GATES) return { ok: false, reason: "tooBig" };
    const bytes = netlistBytes(net);
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
        [0n, BigInt(net.gates.length)],
        [1n, BigInt(net.latches.length)],
      ] as const) {
        if (need === 0n) continue;
        const have = (await this.pub.readContract({ address: transistors, abi: transistorsAbi, functionName: "balanceOf", args: [me, id] })) as bigint;
        if (have >= need) continue;
        const price = (await this.pub.readContract({ address: transistors, abi: transistorsAbi, functionName: "mintPrice" })) as bigint;
        const fee = (await this.pub.readContract({ address: transistors, abi: transistorsAbi, functionName: "protocolFee" })) as bigint;
        const amount = need - have;
        const tx = await this.wallet.writeContract({ address: transistors, abi: transistorsAbi, functionName: "mint", args: [id, amount], value: price * amount + fee });
        await this.pub.waitForTransactionReceipt({ hash: tx });
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
      return { ok: false, reason: "error", detail: (e as Error).message.split("\n")[0] };
    }
  }
}
