/**
 * Red packets against a deployment on an X Layer fork (skipped unless FORK_RPC and
 * DEPLOYMENT_FILE are set), through the same helpers the app uses: fund a lucky
 * packet with USDT, open every share from different wallets (reserve, wait two
 * blocks, reveal), collect the top-ups, and check every unit is paid out exactly.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  numberToHex,
  pad,
  type Address,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  XLAYER_USDT,
  claimPacket,
  collectPacket,
  createPacket,
  owedOf,
  readPacket,
  revealPacket,
  signClaim,
  tokenBalance,
} from "../src/redpacket";
import type { Deployment } from "../src/registry";
import { xLayer } from "../src/tapeout";

const RPC = process.env.FORK_RPC;
const FILE = process.env.DEPLOYMENT_FILE;

describe.skipIf(!RPC || !FILE)("a lucky red packet on the deployment under test", () => {
  it("every share opens, the pool is shared by weight, and nothing is left behind", async () => {
    const d = JSON.parse(readFileSync(FILE!, "utf8")) as Deployment;
    const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
    const pub = createPublicClient({ chain, transport: http(RPC) });
    const rpc = (m: string, p: unknown[]) => pub.request({ method: m as never, params: p as never });
    const people = [0, 1, 2, 3].map(() => privateKeyToAccount(generatePrivateKey()));
    for (const a of people) await rpc("anvil_setBalance", [a.address, "0x56BC75E2D63100000"]);
    const [sender, ...friends] = people.map((account) => createWalletClient({ chain, transport: http(RPC), account }));
    // fork-only: give the sender 9 USDT by writing its balance slot (slot 0 for this token)
    const slot = keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [sender!.account!.address, 0n]),
    );
    await rpc("anvil_setStorageAt", [XLAYER_USDT, slot, pad(numberToHex(9_000_000n), { size: 32 })]);
    expect(await tokenBalance(pub, XLAYER_USDT, sender!.account!.address)).toBe(9_000_000n);

    const key = generatePrivateKey();
    const { id } = await createPacket(pub, sender!, d, {
      token: XLAYER_USDT,
      total: 9_000_000n,
      count: 3,
      lifetimeSec: 86_400,
      key: privateKeyToAccount(key).address,
      lucky: true,
      petOwnersOnly: false,
    });
    for (const f of friends) {
      const sig = await signClaim(pub, d, key, id, f.account!.address as Address);
      const r = await claimPacket(pub, f, d, id, sig);
      expect(r.reserved).toBe(true);
    }
    await rpc("evm_mine", []);
    await rpc("evm_mine", []);
    for (const f of friends) await revealPacket(pub, f, d, id);
    const p = await readPacket(pub, d, id);
    expect(p.paid).toBe(3);
    expect(p.remaining).toBe(0n);
    let total = 0n;
    for (const f of friends) {
      const owe = await owedOf(pub, d, id, f.account!.address as Address);
      if (owe > 0n) await collectPacket(pub, f, d, id);
      const bal = await tokenBalance(pub, XLAYER_USDT, f.account!.address as Address);
      expect(bal).toBeGreaterThanOrEqual(p.floor);
      total += bal;
    }
    expect(total).toBe(9_000_000n);
  }, 300_000);
});
