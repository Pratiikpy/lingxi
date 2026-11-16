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
import { type Program, type Rule, type StarterLine, bytesToHex, compileProgram, composeChild, composeInstinct, gateCount, netlistBytes } from "@lingxi/brain";
import { FACTORY, factoryAbi, processorAbi, transistorsAbi, xLayer } from "@lingxi/chain";
import { type Family, type Growth, MAX_GATES, MAX_GATES_SKILLED, MAX_LESSONS, SKILL_BY_ID, cleanInstincts, composeProgram, gateBudget, halfBudgets, halvesOf, mindExtra, skillRules } from "@lingxi/game";

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

export type RelayResult = { ok: true; processor: Address; brainId: string; reused: boolean; tx?: string } | { ok: false; reason: "invalid" | "tooBig" | "budget" | "error"; detail?: string };

export type KeepsakeResult = { ok: true; processor: Address; brainId: string; tapeTx: string; sendTx: string } | { ok: false; reason: "invalid" | "tooBig" | "budget" | "error"; detail?: string };

const erc721TransferAbi = [
  { type: "function", name: "transferFrom", stateMutability: "nonpayable", inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "id", type: "uint256" }], outputs: [] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "address" }] },
] as const;

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

  /**
   * A pet's brain from its line, lessons, instinct switches and skills (plan 4.4): the capstone rules it holds.
   * Only rule skills are accepted as rules, and the circuit may be no larger than any skilled pet's budget.
   */
  relay(line: StarterLine, lessons: Rule[], instincts = 0, skills: number[] = []): Promise<RelayResult> {
    return this.serial(async () => {
      if (lessons.length > MAX_LESSONS) return { ok: false, reason: "invalid", detail: "too many lessons" } as const;
      const rules = [...new Set(skills)].sort((a, b) => a - b).map((id) => SKILL_BY_ID[id]?.rule);
      if (rules.some((r) => !r)) return { ok: false, reason: "invalid", detail: "not a rule skill" } as const;
      let program: Program;
      try {
        program = composeProgram(line, lessons, cleanInstincts(instincts), { rules: rules as Rule[] });
      } catch (e) {
        return { ok: false, reason: "invalid", detail: (e as Error).message } as const;
      }
      return this.tapeProgram(program, MAX_GATES_SKILLED);
    });
  }

  /**
   * A child's brain: LX-CHILD/1 REFs to two parent circuits plus the glue. At
   * birth the parents are their current circuits; once the child is taught, each
   * half (child's lessons + that parent's) is taped out first and REF'd instead.
   */
  relayChild(input: { parents: [string, string] } | { family: Family; lessons: Rule[]; growth?: Growth }): Promise<RelayResult> {
    return this.serial(async () => {
      let ids: [bigint, bigint];
      if ("parents" in input) {
        ids = [BigInt(input.parents[0]), BigInt(input.parents[1])];
      } else {
        if (input.lessons.length > MAX_LESSONS) return { ok: false, reason: "invalid", detail: "too many lessons" } as const;
        let halves: [Program, Program];
        try {
          // the child's own capstone rules join both halves (plan 4.4)
          halves = halvesOf(input.family, input.lessons, skillRules(input.growth));
        } catch (e) {
          return { ok: false, reason: "invalid", detail: (e as Error).message } as const;
        }
        const got: bigint[] = [];
        // each half may hold its parent's inherited capstone rules on top of the child's own budget
        const budgets = halfBudgets(input.family, input.growth);
        for (const [i, h] of halves.entries()) {
          const r = await this.tapeProgram(h, budgets[i]!);
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
   * An owned circuit taught as an everyday instinct (PRD X1): LX-INSTINCT/1 REFs
   * the pet's own brain circuit (on Lingxi's processor) and the owned circuit (on
   * any processor TapeOut's factory registered), plus the glue. Both must be pet
   * brains (16 in, 8 out) and their memory together must fit the registry's 64 bits.
   */
  relayInstinct(input: { own: string; processor: Address; id: string }): Promise<RelayResult> {
    return this.serial(async () => {
      const read = async (cpu: Address, id: bigint) => (await this.pub.readContract({ address: cpu, abi: processorAbi, functionName: "circuitInfo", args: [id] })) as readonly [bigint, bigint, bigint, bigint];
      let state = 0;
      try {
        if (!(await this.pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "isCPU", args: [input.processor] }))) return { ok: false, reason: "invalid", detail: "not a TapeOut processor" } as const;
        for (const [cpu, id] of [
          [this.cfg.processor, BigInt(input.own)],
          [input.processor, BigInt(input.id)],
        ] as const) {
          const info = await read(cpu, id);
          if (Number(info[0]) !== 16 || Number(info[1]) !== 8) return { ok: false, reason: "invalid", detail: `circuit ${id} is not a pet brain` } as const;
          state += Number(info[2]);
        }
      } catch {
        return { ok: false, reason: "invalid", detail: "no such circuit" } as const;
      }
      if (state > 64) return { ok: false, reason: "tooBig", detail: `${state} memory bits` } as const;
      const c = composeInstinct({ cpu: this.cfg.processor, id: BigInt(input.own) }, { cpu: input.processor, id: BigInt(input.id) });
      return this.tapeBytes(c.bytes, c.elements.filter((e) => e.op === 0).length, 0);
    });
  }

  /**
   * A season champion's keepsake (PRD F26): its brain taped out as a circuit of
   * its own (never a shared, earlier copy) and the circuit sent to the winner.
   * A child's brain REFs its two halves (taped out once and shared) through a
   * glue circuit of its own.
   */
  keepsake(spec: { line: StarterLine; lessons: Rule[]; instincts?: number; family?: Family; growth?: Growth }, to: Address): Promise<KeepsakeResult> {
    return this.serial(async () => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(to) || /^0x0{40}$/.test(to)) return { ok: false, reason: "invalid", detail: "no wallet" } as const;
      if (spec.lessons.length > 8) return { ok: false, reason: "invalid", detail: "too many lessons" } as const;
      let r: RelayResult;
      try {
        if (spec.family) {
          const got: bigint[] = [];
          for (const h of halvesOf(spec.family, spec.lessons, skillRules(spec.growth))) {
            const half = await this.tapeProgram(h);
            if (!half.ok) return half;
            got.push(BigInt(half.brainId));
          }
          const child = composeChild({ cpu: this.cfg.processor, id: got[0]! }, { cpu: this.cfg.processor, id: got[1]! });
          r = await this.tapeBytes(child.bytes, child.elements.filter((e) => e.op === 0).length, 0, true);
        } else {
          const net = compileProgram(composeProgram(spec.line, spec.lessons, cleanInstincts(spec.instincts ?? 0), mindExtra(spec.growth)));
          if (gateCount(net) > gateBudget(spec.growth)) return { ok: false, reason: "tooBig" } as const;
          r = await this.tapeBytes(netlistBytes(net), net.gates.length, net.latches.length, true);
        }
      } catch (e) {
        return { ok: false, reason: "invalid", detail: (e as Error).message } as const;
      }
      if (!r.ok) return r;
      try {
        const id = BigInt(r.brainId);
        const me = this.wallet.account.address;
        const sim = await this.pub.simulateContract({ address: this.cfg.processor, abi: erc721TransferAbi, functionName: "transferFrom", args: [me, to, id], account: this.wallet.account });
        const sendTx = await this.wallet.writeContract(sim.request);
        const rc = await this.pub.waitForTransactionReceipt({ hash: sendTx });
        if (rc.status !== "success") return { ok: false, reason: "error", detail: "transfer reverted" } as const;
        const owner = (await this.pub.readContract({ address: this.cfg.processor, abi: erc721TransferAbi, functionName: "ownerOf", args: [id] })) as Address;
        if (owner.toLowerCase() !== to.toLowerCase()) return { ok: false, reason: "error", detail: "the circuit did not arrive" } as const;
        return { ok: true, processor: this.cfg.processor, brainId: r.brainId, tapeTx: r.tx ?? "", sendTx } as const;
      } catch (e) {
        return { ok: false, reason: "error", detail: (e as Error).message.split(NEWLINE)[0] } as const;
      }
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

  /** Any valid pet-language program as its own circuit (within the gate budget), shared when the same netlist exists. */
  relayProgram(program: Program): Promise<RelayResult> {
    return this.serial(() => this.tapeProgram(program));
  }

  private async tapeProgram(program: Program, maxGates = MAX_GATES): Promise<RelayResult> {
    const net = compileProgram(program);
    if (gateCount(net) > maxGates) return { ok: false, reason: "tooBig" };
    return this.tapeBytes(netlistBytes(net), net.gates.length, net.latches.length);
  }

  /** `fresh` tapes out a new circuit even when the same netlist exists, for a keepsake that is the winner's alone. */
  private async tapeBytes(bytes: Uint8Array, nands: number, latches: number, fresh = false): Promise<RelayResult> {
    const key = createHash("sha256").update(bytes).digest("hex");
    const known = this.store.brains[key];
    if (known && !fresh) return { ok: true, processor: this.cfg.processor, brainId: known, reused: true };

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
      // a keepsake leaves our hands, so it is never offered later as a shared brain
      if (!fresh) this.store.brains[key] = id;
      this.store.used += 1;
      this.save();
      return { ok: true, processor: p, brainId: id, reused: false, tx };
    } catch (e) {
      return { ok: false, reason: "error", detail: (e as Error).message.split(NEWLINE)[0] };
    }
  }
}
