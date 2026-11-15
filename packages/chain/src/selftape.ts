/**
 * A player tapes out their pet's brain with their own wallet (PRD F34): the cost
 * first, in both currencies it takes, against what the wallet holds; then the
 * steps (approve the protocol fee, mint the gates still missing, tape out); then
 * a read-back that the circuit on chain is byte for byte the one compiled here.
 *
 * TapeOut processors from index 415 on take their protocol fee in BEM (approved
 * first, the mint price in OKB as value); older ones take everything in OKB.
 * Which one applies is found by simulating with a generous balance override, so
 * a wallet's own low balance can never be mistaken for the fee mode.
 */

import { type Address, type Hex, type PublicClient, type WalletClient, bytesToHex, erc20Abi, maxUint128 } from "viem";
import { FACTORY, processorAbi, transistorsAbi } from "./tapeout";

const IDS = { nand: 0n, latch: 1n } as const;
const factoryBemAbi = [{ type: "function", name: "bem", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;

export interface TapeQuote {
  nands: number;
  latches: number;
  /** gates this wallet still has to mint (it may already hold some) */
  mint: { nand: bigint; latch: bigint };
  mintPrice: bigint;
  protocolFee: bigint;
  /** what the protocol fee is paid in */
  feeIn: "okb" | "bem";
  tapeoutFee: bigint;
  okbNeeded: bigint;
  bemNeeded: bigint;
  /** network fees for every step, at today's gas price with a quarter's headroom */
  gasEstimate: bigint;
  /** everything in OKB: gates, the tape-out fee and network fees */
  okbTotal: bigint;
  okbBalance: bigint;
  bemBalance: bigint;
  bem: Address;
  enough: boolean;
  /** how many times the wallet will ask to sign */
  signatures: number;
}

async function feeMode(pub: PublicClient, transistors: Address, account: Address, price: bigint, fee: bigint): Promise<"okb" | "bem"> {
  try {
    await pub.simulateContract({
      address: transistors,
      abi: transistorsAbi,
      functionName: "mint",
      args: [IDS.nand, 1n],
      value: price + fee,
      account,
      stateOverride: [{ address: account, balance: maxUint128 }],
    });
    return "okb";
  } catch {
    return "bem";
  }
}

/**
 * Gas per step, measured on an X Layer fork (approve ≈ 46k, each mint ≈ 95-105k,
 * a 2,174-byte tape-out ≈ 1.0M): storing the circuit costs about 460 gas a byte.
 */
const GAS = { approve: 60_000n, mint: 120_000n, tapeoutBase: 80_000n, tapeoutPerByte: 470n } as const;

export async function quoteTapeout(pub: PublicClient, processor: Address, account: Address, nands: number, latches: number, circuitBytes = 0): Promise<TapeQuote> {
  const transistors = (await pub.readContract({ address: processor, abi: processorAbi, functionName: "transistors" })) as Address;
  const [price, fee, tapeoutFee, haveNand, haveLatch, okbBalance, bem] = await Promise.all([
    pub.readContract({ address: transistors, abi: transistorsAbi, functionName: "mintPrice" }) as Promise<bigint>,
    pub.readContract({ address: transistors, abi: transistorsAbi, functionName: "protocolFee" }) as Promise<bigint>,
    pub.readContract({ address: processor, abi: processorAbi, functionName: "TAPEOUT_FEE" }) as Promise<bigint>,
    pub.readContract({ address: transistors, abi: transistorsAbi, functionName: "balanceOf", args: [account, IDS.nand] }) as Promise<bigint>,
    pub.readContract({ address: transistors, abi: transistorsAbi, functionName: "balanceOf", args: [account, IDS.latch] }) as Promise<bigint>,
    pub.getBalance({ address: account }),
    pub.readContract({ address: FACTORY, abi: factoryBemAbi, functionName: "bem" }) as Promise<Address>,
  ]);
  const mint = { nand: BigInt(Math.max(0, nands - Number(haveNand))), latch: BigInt(Math.max(0, latches - Number(haveLatch))) };
  const mintCalls = BigInt((mint.nand > 0n ? 1 : 0) + (mint.latch > 0n ? 1 : 0));
  const feeIn = mintCalls > 0n ? await feeMode(pub, transistors, account, price, fee) : "okb";
  const okbNeeded = price * (mint.nand + mint.latch) + tapeoutFee + (feeIn === "okb" ? fee * mintCalls : 0n);
  const bemNeeded = feeIn === "bem" ? fee * mintCalls : 0n;
  const bemBalance = bemNeeded > 0n ? ((await pub.readContract({ address: bem, abi: erc20Abi, functionName: "balanceOf", args: [account] })) as bigint) : 0n;
  const gas = (bemNeeded > 0n ? GAS.approve : 0n) + GAS.mint * mintCalls + GAS.tapeoutBase + GAS.tapeoutPerByte * BigInt(circuitBytes);
  const gasEstimate = (gas * (await pub.getGasPrice()) * 5n) / 4n;
  const okbTotal = okbNeeded + gasEstimate;
  return {
    nands,
    latches,
    mint,
    mintPrice: price,
    protocolFee: fee,
    feeIn,
    tapeoutFee,
    okbNeeded,
    bemNeeded,
    gasEstimate,
    okbTotal,
    okbBalance,
    bemBalance,
    bem,
    enough: okbBalance >= okbTotal && bemBalance >= bemNeeded,
    signatures: Number(mintCalls) + (bemNeeded > 0n ? 1 : 0) + 1,
  };
}

export type TapeStep = "approve" | "mintNand" | "mintLatch" | "tapeout" | "verify";

/** Runs the steps of a quote; `onStep` reports progress for the screen. */
export async function tapeOutYourself(
  pub: PublicClient,
  wallet: WalletClient,
  processor: Address,
  bytes: Uint8Array,
  q: TapeQuote,
  onStep: (s: TapeStep) => void = () => {},
): Promise<{ brainId: bigint; txs: Hex[] }> {
  const account = wallet.account;
  if (!account) throw new Error("wallet has no account");
  const chain = wallet.chain;
  const txs: Hex[] = [];
  const send = async (hash: Hex) => {
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`transaction failed: ${hash}`);
    txs.push(hash);
  };
  const transistors = (await pub.readContract({ address: processor, abi: processorAbi, functionName: "transistors" })) as Address;
  if (q.bemNeeded > 0n) {
    onStep("approve");
    await send(await wallet.writeContract({ address: q.bem, abi: erc20Abi, functionName: "approve", args: [transistors, q.bemNeeded], account, chain }));
  }
  const perCallFee = q.feeIn === "okb" ? q.protocolFee : 0n;
  if (q.mint.nand > 0n) {
    onStep("mintNand");
    await send(await wallet.writeContract({ address: transistors, abi: transistorsAbi, functionName: "mint", args: [IDS.nand, q.mint.nand], value: q.mintPrice * q.mint.nand + perCallFee, account, chain }));
  }
  if (q.mint.latch > 0n) {
    onStep("mintLatch");
    await send(await wallet.writeContract({ address: transistors, abi: transistorsAbi, functionName: "mint", args: [IDS.latch, q.mint.latch], value: q.mintPrice * q.mint.latch + perCallFee, account, chain }));
  }
  onStep("tapeout");
  const hex = bytesToHex(bytes);
  const { result } = await pub.simulateContract({ address: processor, abi: processorAbi, functionName: "tapeout", args: [hex, 16, 8], value: q.tapeoutFee, account });
  await send(await wallet.writeContract({ address: processor, abi: processorAbi, functionName: "tapeout", args: [hex, 16, 8], value: q.tapeoutFee, account, chain }));
  const brainId = result as bigint;
  onStep("verify");
  if (!(await circuitMatches(pub, processor, brainId, bytes))) throw new Error("the circuit on chain does not match the one compiled here");
  return { brainId, txs };
}

/** The circuit stored on chain is exactly these bytes. */
export async function circuitMatches(pub: PublicClient, processor: Address, id: bigint, bytes: Uint8Array): Promise<boolean> {
  const onChain = (await pub.readContract({ address: processor, abi: processorAbi, functionName: "netlist", args: [id] })) as Hex;
  return onChain.toLowerCase() === bytesToHex(bytes).toLowerCase();
}
