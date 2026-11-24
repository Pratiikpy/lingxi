/**
 * A player's own tape-out against a local fork of X Layer (skipped unless
 * FORK_RPC points at a local node): the quote, the refusal while short of BEM,
 * the steps, and the byte-for-byte read-back. Uses a freshly generated key funded
 * only on the local fork.
 */

import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  erc20Abi,
  http,
  keccak256,
  numberToHex,
  pad,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { compileProgram, netlistBytes } from "@lingxi/brain";
import { composeProgram, PET_SCHOOL } from "@lingxi/game";
import { circuitMatches, quoteTapeout, tapeOutYourself } from "../src/selftape";
import { xLayer } from "../src/tapeout";

const RPC = process.env.FORK_RPC;
const PROCESSOR: Address = "0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e";

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

describe.skipIf(!RPC)("a player's own tape-out, on an X Layer fork", () => {
  it("quotes both currencies, refuses while short, then tapes out and reads back the same bytes", async () => {
    if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(RPC!)) throw new Error("fork tests run only against a local node");
    const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
    const pub = createPublicClient({ chain, transport: http(RPC) });
    // a brand-new key: anvil's well-known test address carries code on the real X Layer and cannot receive gate tokens
    const account = privateKeyToAccount(generatePrivateKey());
    const wallet = createWalletClient({ chain, transport: http(RPC), account });

    const program = composeProgram("curious", [PET_SCHOOL[2]!.rule], 5);
    const net = compileProgram(program);
    const bytes = netlistBytes(net);
    const nands = net.gates.length;
    const latches = net.latches.length;

    await pub.request({
      method: "anvil_setBalance" as never,
      params: [account.address, numberToHex(parseEther("5"))] as never,
    });
    const short = await quoteTapeout(pub, PROCESSOR, account.address, nands, latches, bytes.length);
    expect(short.feeIn).toBe("bem");
    expect(short.bemNeeded).toBeGreaterThan(0n);
    expect(short.enough).toBe(false);
    expect(short.signatures).toBe(4);

    await giveToken(pub, short.bem, account.address, short.bemNeeded);
    const q = await quoteTapeout(pub, PROCESSOR, account.address, nands, latches, bytes.length);
    expect(q.enough).toBe(true);
    expect(q.okbNeeded).toBe(q.mintPrice * BigInt(nands + latches) + q.tapeoutFee);

    const okbBefore = await pub.getBalance({ address: account.address });
    const steps: string[] = [];
    const { brainId, txs } = await tapeOutYourself(pub, wallet, PROCESSOR, bytes, q, (s) => steps.push(s));
    expect(steps).toEqual(["approve", "mintNand", "mintLatch", "tapeout", "verify"]);
    expect(txs).toHaveLength(4);
    expect(await circuitMatches(pub, PROCESSOR, brainId, bytes)).toBe(true);
    const spent = okbBefore - (await pub.getBalance({ address: account.address }));
    // what was spent covers the fees and never exceeds the quoted total with network fees
    expect(spent).toBeGreaterThanOrEqual(q.okbNeeded);
    expect(spent).toBeLessThanOrEqual(q.okbTotal);
    expect(
      await pub.readContract({ address: q.bem, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
    ).toBe(0n);

    // a second tape-out of a brain the wallet already holds gates for mints nothing
    const again = await quoteTapeout(pub, PROCESSOR, account.address, 0, 0);
    expect(again.mint).toEqual({ nand: 0n, latch: 0n });
    expect(again.signatures).toBe(1);
  }, 180_000);
});
