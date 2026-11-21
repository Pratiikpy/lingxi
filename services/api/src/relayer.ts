/**
 * The brain relayer. When a player teaches their pet, its new brain must exist
 * as a TapeOut circuit before the pet can switch to it on chain. We tape it out
 * for them on our processor, once per distinct netlist (pets that learned the
 * same lessons share one circuit), and return its id; the player then calls
 * PetRegistry.setBrain from their own wallet.
 *
 * Abuse limits: the program is rebuilt here from the line and lessons and must
 * pass the same checks as in the game (valid rules, at most 8 lessons, at most
 * 500 gates); identical brains are never paid twice. Who may ask, and how often per pet and per keeper, is decided
 * before this (relayGate.ts). Here: a daily and an hourly ceiling, counted on every tape-out that sends a transaction
 * (a reverted one costs gas too), and a reserve of OKB that only season keepsakes may spend.
 */

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createPublicClient, createWalletClient, erc20Abi, http, maxUint128, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type Program, type Rule, type StarterLine, bytesToHex, compileProgram, composeChild, composeInstinct, gateCount, netlistBytes } from "@lingxi/brain";
import { BrainTooBigError, CircuitTooWideError, FACTORY, type Deployment, type SponsorLine, circuitIdFrom, createNetlistCache, factoryAbi, hatchOnChain, loadCircuitFromChain, processorAbi, transistorsAbi, xLayer } from "@lingxi/chain";
import { type Family, type Growth, INSTINCT_MAX_GATES, MAX_GATES, MAX_GATES_SKILLED, MAX_LESSONS, SKILL_BY_ID, cleanInstincts, composeProgram, gateBudget, halfBudgets, halvesOf, mindExtra, skillRules } from "@lingxi/game";
import { loadJson, saveJson } from "./durable";
import { SPONSOR_GRANT_WEI, SPONSOR_SET_ASIDE_WEI } from "./sponsor";

const NEWLINE = /\r?\n/;

export interface RelayerConfig {
  rpc: string;
  processor: Address;
  key: Hex;
  storeFile: string;
  maxPerDay: number;
  /** tape-outs that send a transaction, at most this many in any hour */
  maxPerHour?: number;
  /** OKB wei kept for season keepsakes: players' tape-outs stop above it */
  reserveWei?: bigint;
  /** a player's tape-out is refused when it could take the balance below the reserve: this much is set aside per try */
  perTapeoutWei?: bigint;
}

interface Store {
  brains: Record<string, string>;
  day: string;
  used: number;
  /** when each tape-out in the last hour sent its transaction (ms) */
  hour?: number[];
}

/** A tape-out costs the processor's fee, transistor mints and gas: about 0.002 OKB, set aside here at 0.004. */
const PER_TAPEOUT_WEI = 4_000_000_000_000_000n;

/** `sent`: how many tape-outs this request sent, each charged against the sponsor's caps (A75); never shown to players. */
export type RelayResult = ({ ok: true; processor: Address; brainId: string; reused: boolean; tx?: string } | { ok: false; reason: "invalid" | "tooBig" | "budget" | "budgetHour" | "relayLow" | "error"; detail?: string; spent?: boolean }) & { sent?: number };

/** A pet kept for a device key (H4): `spent` says whether a refused one still cost gas. */
/** `spentWei`: what the sends cost the relayer, read from their receipts (B9); the set-aside where a fee could not be read. */
export type SponsorResult = { ok: true; petId: string; hatchTx: string; grantTx: string | null; spentWei: bigint } | { ok: false; reason: "relayLow" | "error"; detail: string; spent: boolean; spentWei?: bigint };

export type KeepsakeResult = { ok: true; processor: Address; brainId: string; tapeTx: string; sendTx: string } | { ok: false; reason: "invalid" | "tooBig" | "budget" | "budgetHour" | "relayLow" | "error"; detail?: string };

const erc721TransferAbi = [
  { type: "function", name: "transferFrom", stateMutability: "nonpayable", inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "id", type: "uint256" }], outputs: [] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "address" }] },
] as const;

export class BrainRelayer {
  private readonly pub;
  private readonly wallet;
  private store: Store;
  private queue: Promise<unknown> = Promise.resolve();
  /** set while a season keepsake is being made: only it may spend the reserve */
  private forKeepsake = false;

  /** the relayer's own address, which pays for every tape-out */
  readonly address: `0x${string}`;

  constructor(private readonly cfg: RelayerConfig) {
    const chain = { ...xLayer, rpcUrls: { default: { http: [cfg.rpc] } } };
    const account = privateKeyToAccount(cfg.key);
    this.address = account.address;
    this.pub = createPublicClient({ chain, transport: http(cfg.rpc) });
    this.wallet = createWalletClient({ chain, transport: http(cfg.rpc), account });
    // the store, or its .bak when a crash cut the file short (A139); with neither readable the relayer stops rather
    // than start with a fresh budget, and the server goes on without it (server.ts)
    const got = loadJson(cfg.storeFile);
    if (got.state === "damaged") throw new Error(`the relayer's store ${cfg.storeFile} and its .bak could not be read (both kept aside)`);
    if (got.state === "none") this.store = { brains: {}, day: "", used: 0, hour: [] };
    else {
      if (got.from === "bak") process.stderr.write(`${cfg.storeFile} could not be read: kept aside, read ${cfg.storeFile}.bak instead\n`);
      this.store = got.value as Store;
      this.store.hour ??= [];
    }
  }

  /** Written to a temporary file and renamed, so a crash mid-write never leaves a half store (or a reset budget). */
  private save(): void {
    mkdirSync(dirname(this.cfg.storeFile), { recursive: true });
    saveJson(this.cfg.storeFile, undefined, JSON.stringify(this.store, null, 1));
  }

  /** Today's and this hour's tape-outs, against their ceilings. */
  usage(now = Date.now()): { today: number; maxPerDay: number; lastHour: number; maxPerHour: number } {
    const today = new Date(now).toISOString().slice(0, 10);
    return {
      today: this.store.day === today ? this.store.used : 0,
      maxPerDay: this.cfg.maxPerDay,
      lastHour: (this.store.hour ?? []).filter((t) => now - t < 3_600_000).length,
      maxPerHour: this.cfg.maxPerHour ?? 20,
    };
  }

  /** What the relayer holds now, in OKB wei (read from chain). */
  balance(): Promise<bigint> {
    return this.pub.getBalance({ address: this.address });
  }

  /** The processor's fee currency, as last read (it changes rarely): asked again after ten minutes. */
  private feeIn: { is: "okb" | "bem"; at: number } | null = null;

  /**
   * A40: the BEM the relayer holds, the transistors' protocol fee, and whether the processor takes that fee in BEM
   * (on mainnet it does: paying it in OKB reverts, 2026-11-20), so a tape-out the relayer cannot pay is refused before
   * anything is sent, and `/api/health` can say how many more it can pay for.
   */
  async fees(): Promise<{ bem: bigint; protocolFee: bigint; feeIn: "okb" | "bem" }> {
    const transistors = (await this.pub.readContract({ address: this.cfg.processor, abi: processorAbi, functionName: "transistors" })) as Address;
    const [price, protocolFee] = (await Promise.all([
      this.pub.readContract({ address: transistors, abi: transistorsAbi, functionName: "mintPrice" }),
      this.pub.readContract({ address: transistors, abi: transistorsAbi, functionName: "protocolFee" }),
    ])) as [bigint, bigint];
    if (!this.feeIn || Date.now() - this.feeIn.at > 10 * 60_000) {
      let is: "okb" | "bem" = "okb";
      try {
        await this.pub.simulateContract({ address: transistors, abi: transistorsAbi, functionName: "mint", args: [0n, 1n], value: price + protocolFee, account: this.address, stateOverride: [{ address: this.address, balance: maxUint128 }] });
      } catch {
        is = "bem";
      }
      this.feeIn = { is, at: Date.now() };
    }
    const bemToken = (await this.pub.readContract({ address: FACTORY, abi: [{ type: "function", name: "bem", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const, functionName: "bem" })) as Address;
    const bem = (await this.pub.readContract({ address: bemToken, abi: erc20Abi, functionName: "balanceOf", args: [this.address] })) as bigint;
    return { bem, protocolFee, feeIn: this.feeIn.is };
  }

  /** How many kinds of transistor (NAND, LATCH) a tape-out must mint: each is one call, and one protocol fee. */
  async mintCalls(nands: number, latches: number): Promise<number> {
    const transistors = (await this.pub.readContract({ address: this.cfg.processor, abi: processorAbi, functionName: "transistors" })) as Address;
    let calls = 0;
    for (const [id, need] of [
      [0n, BigInt(nands)],
      [1n, BigInt(latches)],
    ] as const) {
      if (need === 0n) continue;
      const have = (await this.pub.readContract({ address: transistors, abi: transistorsAbi, functionName: "balanceOf", args: [this.address, id] })) as bigint;
      if (have < need) calls++;
    }
    return calls;
  }

  /** tape-outs sent by the job now running in the serial queue (A75) */
  private sentNow = 0;

  /**
   * Serialises tape-outs so nonces never collide and the budget is exact. A relay's result says how many tape-outs it
   * sent, counted here: one job runs at a time, so the count is exactly that job's.
   */
  /** instinct checks, one at a time and apart from the tape-out queue (A115) */
  private checks: Promise<unknown> = Promise.resolve();
  /** netlists read from the chain; a taped-out netlist never changes (A115) */
  private readonly netlists = createNetlistCache();

  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      this.sentNow = 0;
      const r = await job();
      return r && typeof r === "object" && "ok" in r ? ({ ...r, sent: this.sentNow } as T) : r;
    });
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
  async relayInstinct(input: { own: string; processor: Address; id: string }): Promise<RelayResult> {
    // every read happens before the tape-out queue, in a line of its own, so a circuit that takes many reads holds up
    // only other instinct checks, never a paid tape-out (A115)
    const refused = await this.checkInstinct(input);
    if (refused) return { ...refused, sent: 0 };
    return this.serial(async () => {
      const c = composeInstinct({ cpu: this.cfg.processor, id: BigInt(input.own) }, { cpu: input.processor, id: BigInt(input.id) });
      return this.tapeBytes(c.bytes, c.elements.filter((e) => e.op === 0).length, 0);
    });
  }

  /** An instinct's reads, one check at a time: null when it may be taped, else why not. */
  private checkInstinct(input: { own: string; processor: Address; id: string }): Promise<Extract<RelayResult, { ok: false }> | null> {
    const run = this.checks.then(async (): Promise<Extract<RelayResult, { ok: false }> | null> => {
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
      // the owned circuit must run within an instinct's budget, counted as it runs (A38): REFs may make it small to
      // carry, never big to run, and every friend who meets the pet runs it
      try {
        await loadCircuitFromChain(this.pub, input.processor, BigInt(input.id), INSTINCT_MAX_GATES, { cache: this.netlists });
      } catch (e) {
        if (e instanceof BrainTooBigError) return { ok: false, reason: "tooBig", detail: `${e.gates} gates a beat, past ${e.max}` } as const;
        if (e instanceof CircuitTooWideError) return { ok: false, reason: "tooBig", detail: e.message } as const;
        return { ok: false, reason: "invalid", detail: "the circuit could not be read" } as const;
      }
      return null;
    });
    this.checks = run.catch(() => null);
    return run;
  }

  /**
   * A season keepsake for the week's best-placed proven pet (PRD F26): its brain taped out as a circuit of
   * its own (never a shared, earlier copy) and the circuit sent to the winner.
   * A child's brain REFs its two halves (taped out once and shared) through a
   * glue circuit of its own.
   */
  keepsake(spec: { line: StarterLine; lessons: Rule[]; instincts?: number; family?: Family; growth?: Growth }, to: Address): Promise<KeepsakeResult> {
    return this.serial(async () => {
      this.forKeepsake = true;
      try {
        return await this.makeKeepsake(spec, to);
      } finally {
        this.forKeepsake = false;
      }
    });
  }

  private async makeKeepsake(spec: { line: StarterLine; lessons: Rule[]; instincts?: number; family?: Family; growth?: Growth }, to: Address): Promise<KeepsakeResult> {
    if (!/^0x[0-9a-fA-F]{40}$/.test(to) || /^0x0{40}$/.test(to)) return { ok: false, reason: "invalid", detail: "no wallet" } as const;
    // the same limit as every other tape-out: lesson skills let a grown pet hold more than eight (plan 4.4)
    if (spec.lessons.length > MAX_LESSONS) return { ok: false, reason: "invalid", detail: "too many lessons" } as const;
    let r: RelayResult;
    try {
      if (spec.family) {
        const got: bigint[] = [];
        // each half within its own budget, as when the child itself is taped (relayChild)
        const budgets = halfBudgets(spec.family, spec.growth);
        for (const [i, h] of halvesOf(spec.family, spec.lessons, skillRules(spec.growth)).entries()) {
          const half = await this.tapeProgram(h, budgets[i]!);
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
  /**
   * Keeps a pet on X Layer for a player with no wallet (H4): hatches it to their device key, then sends that key the
   * gas for its own saves. In the tape-out queue, so its nonces never collide with a tape-out's, and never into the
   * OKB held for season keepsakes. Who may ask is decided before this (sponsor.ts).
   */
  sponsorHatch(d: Deployment, to: Address, line: SponsorLine, state: bigint): Promise<SponsorResult> {
    return this.serial(async (): Promise<SponsorResult> => {
      const balance = await this.balance().catch(() => 0n);
      if (balance < (this.cfg.reserveWei ?? 0n) + SPONSOR_SET_ASIDE_WEI) return { ok: false, reason: "relayLow", detail: "the relayer's OKB is held for season keepsakes", spent: false };
      let petId: bigint;
      let hatchTx: Hex;
      try {
        ({ petId, tx: hatchTx } = await hatchOnChain(this.pub as never, this.wallet as never, d, line, state, undefined, to));
      } catch (e) {
        // a hatch that failed after it was sent still cost gas; how much is not known here, so the most it may have
        return { ok: false, reason: "error", detail: (e as Error).message.split(NEWLINE)[0] ?? "the hatch failed", spent: true, spentWei: SPONSOR_SET_ASIDE_WEI };
      }
      const hatchFee = await this.feeOf(hatchTx);
      const grant = await this.sendGrant(to);
      const spentWei = hatchFee === null || (grant && grant.feeWei === null) ? SPONSOR_SET_ASIDE_WEI : hatchFee + (grant ? SPONSOR_GRANT_WEI + grant.feeWei! : 0n);
      return { ok: true, petId: petId.toString(), hatchTx, grantTx: grant?.tx ?? null, spentWei };
    });
  }

  /** The gas alone, for a sponsored pet whose grant never went out. */
  sponsorGrant(to: Address): Promise<{ ok: true; grantTx: string; spentWei: bigint } | { ok: false; reason: "relayLow" | "error"; detail: string }> {
    return this.serial(async () => {
      const balance = await this.balance().catch(() => 0n);
      if (balance < (this.cfg.reserveWei ?? 0n) + SPONSOR_SET_ASIDE_WEI) return { ok: false as const, reason: "relayLow" as const, detail: "the relayer's OKB is held for season keepsakes" };
      const g = await this.sendGrant(to);
      return g ? { ok: true as const, grantTx: g.tx, spentWei: SPONSOR_GRANT_WEI + (g.feeWei ?? SPONSOR_SET_ASIDE_WEI - SPONSOR_GRANT_WEI) } : { ok: false as const, reason: "error" as const, detail: "the gas could not be sent" };
    });
  }

  /** What a mined transaction cost in gas, from its receipt; null when the receipt does not say. */
  private async feeOf(hash: Hex): Promise<bigint | null> {
    try {
      const r = (await this.pub.waitForTransactionReceipt({ hash })) as { gasUsed?: bigint; effectiveGasPrice?: bigint };
      return typeof r.gasUsed === "bigint" && typeof r.effectiveGasPrice === "bigint" ? r.gasUsed * r.effectiveGasPrice : null;
    } catch {
      return null;
    }
  }

  /** Sends a sponsored key its gas, with what that send cost; null when it did not go out (the pet is the player's either way). */
  private async sendGrant(to: Address): Promise<{ tx: string; feeWei: bigint | null } | null> {
    try {
      const tx = await this.wallet.sendTransaction({ to, value: SPONSOR_GRANT_WEI } as never);
      const r = (await this.pub.waitForTransactionReceipt({ hash: tx })) as { status: string; gasUsed?: bigint; effectiveGasPrice?: bigint };
      return r.status === "success" ? { tx, feeWei: typeof r.gasUsed === "bigint" && typeof r.effectiveGasPrice === "bigint" ? r.gasUsed * r.effectiveGasPrice : null } : null;
    } catch {
      return null;
    }
  }

  private async tapeBytes(bytes: Uint8Array, nands: number, latches: number, fresh = false): Promise<RelayResult> {
    const key = createHash("sha256").update(bytes).digest("hex");
    const known = this.store.brains[key];
    if (known && !fresh) return { ok: true, processor: this.cfg.processor, brainId: known, reused: true };

    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    if (this.store.day !== today) {
      this.store.day = today;
      this.store.used = 0;
    }
    this.store.hour = (this.store.hour ?? []).filter((t) => now - t < 3_600_000);
    if (this.store.used >= this.cfg.maxPerDay) return { ok: false, reason: "budget", detail: "today's tape-outs are used" };
    if (this.store.hour.length >= (this.cfg.maxPerHour ?? 20)) return { ok: false, reason: "budgetHour", detail: "this hour's tape-outs are used" };
    if (!this.forKeepsake) {
      const balance = await this.balance().catch(() => 0n);
      if (balance < (this.cfg.reserveWei ?? 0n) + (this.cfg.perTapeoutWei ?? PER_TAPEOUT_WEI)) return { ok: false, reason: "relayLow", detail: "the relayer's OKB is held for season keepsakes" };
    }
    // the transistors' fee, per kind minted: a tape-out the relayer's BEM cannot pay is refused before anything is sent,
    // rather than failing at the mint after its approval cost gas (A40)
    const calls = await this.mintCalls(nands, latches).catch(() => 0);
    if (calls > 0) {
      const f = await this.fees().catch(() => null);
      if (f && f.feeIn === "bem" && f.bem < f.protocolFee * BigInt(calls)) return { ok: false, reason: "relayLow", detail: "the relayer's BEM is too low for the transistor fee" };
    }
    // counted before anything is sent: a tape-out that reverts still spent gas
    this.store.used += 1;
    this.sentNow += 1;
    this.store.hour.push(now);
    this.save();

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
      // simulated first so a tape-out that would revert costs nothing; its id is read from the mined receipt
      await this.pub.simulateContract({ address: p, abi: processorAbi, functionName: "tapeout", args: [hex, 16, 8], value: fee, account: this.wallet.account });
      const tx = await this.wallet.writeContract({ address: p, abi: processorAbi, functionName: "tapeout", args: [hex, 16, 8], value: fee });
      const r = await this.pub.waitForTransactionReceipt({ hash: tx });
      if (r.status !== "success") return { ok: false, reason: "error", detail: "tapeout reverted", spent: true };
      const id = circuitIdFrom(r, p, me).toString();
      // a keepsake leaves our hands, so it is never offered later as a shared brain
      if (!fresh) this.store.brains[key] = id;
      this.save();
      return { ok: true, processor: p, brainId: id, reused: false, tx };
    } catch (e) {
      return { ok: false, reason: "error", detail: (e as Error).message.split(NEWLINE)[0], spent: true };
    }
  }
}
