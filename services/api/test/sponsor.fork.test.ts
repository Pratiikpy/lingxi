/**
 * H4 on an X Layer fork (skipped unless FORK_RPC and RELAY_KEY_FILE are set; `pnpm test:fork --only services/api`):
 * a new player with no wallet asks through the real route, the relayer hatches the pet to their device key and sends
 * it gas, the device key saves a day with that gas alone, and moves the pet to a real wallet in one transfer. Every
 * refusal leaves the relayer's balance as it was.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, custom, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { STARTERS, compileProgram, fastBrain, stateBits } from "@lingxi/brain";
import { checkpointOnChain, petRegistryAbi, readPet, signSponsorRequest, type Deployment, xLayer } from "@lingxi/chain";
import { createPet, packState } from "@lingxi/game";
import { BrainRelayer } from "../src/relayer";
import { SPONSOR_GRANT_WEI, SPONSOR_SET_ASIDE_WEI, SponsorGate } from "../src/sponsor";
import { withSponsor } from "../src/server";

const RPC = process.env.FORK_RPC;
/**
 * X Layer mainnet's fees, read from rpc.xlayer.tech on 2026-11-21: a 0.02 gwei base fee and a 1 wei tip. A fork prices
 * gas at about 1 gwei, fifty times more, so the fork is set to mainnet's base fee and the player's device wallet asks
 * for mainnet's tip, as it does on X Layer; the relayer's own cost is checked in gas at this price.
 */
const MAINNET_BASE_FEE = 20_000_000n;
const MAINNET_TIP = 1n;
const RELAY_KEY_FILE = process.env.RELAY_KEY_FILE;

describe.skipIf(!RPC || !RELAY_KEY_FILE)("a pet kept for a player with no wallet, on an X Layer fork (H4)", () => {
  it("is owned by the device key, saved with the granted gas, and moved to a wallet in one tap", async () => {
    const file = process.env.DEPLOYMENT_FILE ?? new URL("../../../packages/chain/deployments/local.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const d = JSON.parse(readFileSync(file, "utf8")) as Deployment;
    const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
    const pub = createPublicClient({ chain, transport: http(RPC) });
    const rpc = (method: string, params: unknown[]) => pub.request({ method: method as never, params: params as never });
    const env = Object.fromEntries(readFileSync(RELAY_KEY_FILE!, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
    const relayer = new BrainRelayer({ rpc: RPC!, processor: d.processor as Address, key: (env.K ?? env.LINGXI_RELAYER_KEY) as Hex, storeFile: join(mkdtempSync(join(tmpdir(), "lx-")), "brains.json"), maxPerDay: 50, reserveWei: 10_000_000_000_000_000n });
    const gate = new SponsorGate({ file: join(mkdtempSync(join(tmpdir(), "lx-")), "sponsored.json"), enabled: true });
    const app = withSponsor(new Hono(), { gate, relayer, deployment: d, who: () => "198.51.100.1" });
    const post = async (body: unknown) => (await app.request("/api/sponsor/hatch", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } })).json() as Promise<Record<string, unknown>>;

    // a new player: a device key holding nothing, and a pet that has lived its first minutes in the game
    const device = privateKeyToAccount(generatePrivateKey());
    expect(await pub.getBalance({ address: device.address })).toBe(0n);
    const program = STARTERS.gentle;
    const brain = { fast: fastBrain(compileProgram(program)), nState: stateBits(program), program };
    const t0 = Number((await pub.getBlock()).timestamp) * 1000;
    const pet = createPet({ name: "Mochi", line: "gentle", now: t0, tzOffsetMin: 0, brain });
    const born = packState(pet, "baby");

    const before = await relayer.balance();
    // refusals first: a request signed by another key, then one of the wrong line; neither may cost the relayer anything
    const forged = await signSponsorRequest(privateKeyToAccount(generatePrivateKey()), { line: "gentle", state: born.toString(), at: Date.now() });
    expect(await post({ ...forged.request, to: device.address, signature: forged.signature })).toMatchObject({ ok: false, reason: "badSignature" });
    const wrongLine = await signSponsorRequest(device, { line: "bold", state: born.toString(), at: Date.now() });
    expect(await post({ ...wrongLine.request, signature: wrongLine.signature })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await relayer.balance()).toBe(before);

    const { request, signature } = await signSponsorRequest(device, { line: "gentle", state: born.toString(), at: Date.now() });
    const got = await post({ ...request, signature });
    expect(got).toMatchObject({ ok: true });
    const petId = BigInt(got.petId as string);
    const onChain = await readPet(pub, d, petId);
    expect(onChain.owner).toBe(device.address);
    expect(onChain.brainId).toBe(BigInt(d.circuits.gentle!.id));
    expect(await pub.getBalance({ address: device.address })).toBe(SPONSOR_GRANT_WEI);
    // what it cost the relayer is the grant and the two transactions' gas, nothing else; and that gas at mainnet's price
    // stays inside what each pet is allowed
    const receipts = await Promise.all([got.hatchTx, got.grantTx].map((hash) => pub.getTransactionReceipt({ hash: hash as Hex })));
    const fees = receipts.reduce((sum, r) => sum + r.gasUsed * r.effectiveGasPrice, 0n);
    expect(before - (await relayer.balance())).toBe(SPONSOR_GRANT_WEI + fees);
    const gas = receipts.reduce((sum, r) => sum + r.gasUsed, 0n);
    expect(SPONSOR_GRANT_WEI + gas * (MAINNET_BASE_FEE + MAINNET_TIP)).toBeLessThanOrEqual(SPONSOR_SET_ASIDE_WEI);

    // asked again: refused, and free
    const spentBefore = await relayer.balance();
    expect(await post({ ...request, signature })).toMatchObject({ ok: false, reason: "had" });
    expect(await relayer.balance()).toBe(spentBefore);

    // the device key saves a day with the gas it was given, no wallet anywhere, at mainnet's fees
    await rpc("anvil_setNextBlockBaseFeePerGas", [`0x${MAINNET_BASE_FEE.toString(16)}`]);
    // the device talks to the fork as it would to X Layer: the node's fee answers are mainnet's, the rest is the fork
    const hex = (n: bigint) => `0x${n.toString(16)}`;
    const mainnetAnswers: Record<string, bigint> = { eth_maxPriorityFeePerGas: MAINNET_TIP, eth_gasPrice: MAINNET_BASE_FEE + MAINNET_TIP };
    const asOnMainnet = custom({
      request: async ({ method, params }) => {
        if (method in mainnetAnswers) return hex(mainnetAnswers[method]!);
        const r = (await pub.request({ method: method as never, params: params as never })) as { tx?: Record<string, unknown> };
        // viem has the node fill a transaction in; X Layer fills in its own fees, so the fork's are replaced by those
        if (method === "eth_fillTransaction" && r?.tx) {
          if (r.tx.maxFeePerGas !== undefined) Object.assign(r.tx, { maxFeePerGas: hex(MAINNET_BASE_FEE * 2n + MAINNET_TIP), maxPriorityFeePerGas: hex(MAINNET_TIP) });
          if (r.tx.gasPrice !== undefined) r.tx.gasPrice = hex(MAINNET_BASE_FEE + MAINNET_TIP);
        }
        return r;
      },
    });
    const deviceWallet = createWalletClient({ chain, transport: asOnMainnet, account: device });
    const pubMain = createPublicClient({ chain, transport: asOnMainnet });
    const saved = await checkpointOnChain(pubMain as never, deviceWallet, d, petId, 1, born, pet.logHash as Hex);
    expect((await readPet(pub, d, petId)).day).toBe(1);
    // the plan's promise: the grant pays for about thirty saves at mainnet's price
    const saveGas = (await pub.getTransactionReceipt({ hash: saved })).gasUsed;
    expect(SPONSOR_GRANT_WEI / (saveGas * (MAINNET_BASE_FEE + MAINNET_TIP))).toBeGreaterThanOrEqual(30n);

    // one tap moves it to a real wallet: a plain transfer signed by the device key
    const wallet = privateKeyToAccount(generatePrivateKey()).address;
    await rpc("anvil_setCode", [wallet, "0x"]);
    const tx = await deviceWallet.writeContract({ address: d.registry, abi: petRegistryAbi, functionName: "transferFrom", args: [device.address, wallet, petId], chain, account: device });
    expect((await pub.waitForTransactionReceipt({ hash: tx })).status).toBe("success");
    expect((await readPet(pub, d, petId)).owner).toBe(wallet);
    // the grant covered a save and the move with room to spare
    expect(await pub.getBalance({ address: device.address })).toBeGreaterThan(SPONSOR_GRANT_WEI / 2n);
  }, 300_000);
});
