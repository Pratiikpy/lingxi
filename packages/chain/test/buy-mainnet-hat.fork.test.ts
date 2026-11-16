/**
 * The complete purchase flow against the REAL mainnet contracts and the REAL published hat.
 * Forks X Layer at the current block (which already holds design #1, "Hundred-day party hat",
 * published by the deployer), funds three throwaway buyers on the fork only, and runs the whole
 * flow a real player would: buy the live design, confirm the copy belongs to the buyer, resell it,
 * see the creator's royalty and the market fee, and withdraw. Nothing here spends real money; the
 * one step a fork cannot cover is broadcasting settlement to the live sequencer.
 *
 * Run: anvil --fork-url https://rpc.xlayer.tech --port 8555, then
 *   FORK_RPC=http://127.0.0.1:8555 DEPLOYMENT_FILE=.../deployments/xlayer.json vitest run test/buy-mainnet-hat.fork.test.ts
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buyDesign, buyListing, cancelListing, copiesHeld, listCopies, marketFeeBps, proceedsOwed, readDesign, withdrawProceeds, xLayer, type Deployment } from "../src/index";

const RPC = process.env.FORK_RPC;
const file = process.env.DEPLOYMENT_FILE ?? new URL("../deployments/xlayer.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const d = JSON.parse(readFileSync(file, "utf8")) as Deployment;
const HAT = 1n; // the design the deployer published on mainnet

describe.skipIf(!RPC)("buying the real party hat on a mainnet fork", () => {
  it("a stranger buys it, owns the copy, resells it, and the creator earns a royalty", { timeout: 300_000 }, async () => {
    const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
    const pub = createPublicClient({ chain, transport: http(RPC) });
    const rpc = (m: string, p: unknown[]) => pub.request({ method: m as never, params: p as never });

    // the hat is real on mainnet, read through the same helper the game uses
    const hat = await readDesign(pub, d, HAT);
    expect(hat.name).toBe("Hundred-day party hat");
    expect(hat.price).toBe(parseEther("0.001"));
    const creator = hat.creator;
    const feeBps = await marketFeeBps(pub, d);

    // three throwaway buyers, funded only on the fork
    const [a, b] = [0, 1].map(() => privateKeyToAccount(generatePrivateKey()));
    for (const x of [a, b]) await rpc("anvil_setBalance", [x.address, "0x3635C9ADC5DEA00000"]);
    const [alice, bob] = [a, b].map((account) => createWalletClient({ chain, transport: http(RPC), account }));

    // Alice buys two copies at the real price; they are hers
    expect((await copiesHeld(pub, d, a.address, [HAT]))[0]).toBe(0n);
    await buyDesign(pub, alice, d, HAT, 2, hat.price);
    expect((await copiesHeld(pub, d, a.address, [HAT]))[0]).toBe(2n);

    // the creator is owed their share of the primary sale (total minus the market fee)
    const total = hat.price * 2n;
    const fee = (total * BigInt(feeBps)) / 10_000n;
    expect(await proceedsOwed(pub, d, creator)).toBeGreaterThanOrEqual(total - fee);

    // Alice lists one copy; Bob buys it; the copy moves to Bob
    const { listingId } = await listCopies(pub, alice, d, HAT, 1, parseEther("0.003"));
    await buyListing(pub, bob, d, listingId, 1, parseEther("0.003"));
    expect((await copiesHeld(pub, d, b.address, [HAT]))[0]).toBe(1n);
    expect((await copiesHeld(pub, d, a.address, [HAT]))[0]).toBe(1n);

    // the creator earned a royalty on the resale, and Alice is owed the rest
    const royalty = (parseEther("0.003") * BigInt(hat.royaltyBps)) / 10_000n;
    const resaleFee = (parseEther("0.003") * BigInt(feeBps)) / 10_000n;
    expect(await proceedsOwed(pub, d, creator)).toBeGreaterThanOrEqual(total - fee + royalty);
    expect(await proceedsOwed(pub, d, a.address)).toBe(parseEther("0.003") - royalty - resaleFee);

    // Alice withdraws what she is owed, and it reaches her wallet
    const owed = await proceedsOwed(pub, d, a.address);
    const before = await pub.getBalance({ address: a.address });
    await withdrawProceeds(pub, alice, d);
    const after = await pub.getBalance({ address: a.address });
    expect(after).toBeGreaterThan(before);
    expect(await proceedsOwed(pub, d, a.address)).toBe(0n);

    console.log(`hat "${hat.name}" by ${creator.slice(0, 8)}…: price ${formatEther(hat.price)} OKB, market fee ${feeBps / 100}%, royalty ${hat.royaltyBps / 100}%; Alice withdrew ${formatEther(owed)} OKB; flow OK against the live contract ${d.outfitMarket}`);
  });
});
