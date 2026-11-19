/**
 * A23 on a fork of X Layer mainnet: the OKB market (OutfitMarket V1) itself sells a listing that came back, and the
 * server's watch names it. Alice holds one copy and lists it twice; Bob buys the dear listing; Alice buys another copy
 * for herself; the forgotten cheap listing is live on chain again, and the watch says a sale retired it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, http, parseEther, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encodeDesign } from "@lingxi/art";
import { buyDesign, buyListing, listCopies, publishDesign, readListings, xLayer, type Deployment } from "@lingxi/chain";
import { createListingWatch } from "../src/marketV1";

const RPC = process.env.FORK_RPC;
const FILE = process.env.DEPLOYMENT_FILE;
const d = FILE ? (JSON.parse(readFileSync(FILE, "utf8")) as Deployment) : null;

describe.skipIf(!RPC || !d?.outfitMarket)("a listing that came back on the OKB market (A23)", () => {
  it("is still sold by V1, and the watch names it as retired", async () => {
    const V1 = { v: 1 as const, address: d!.outfitMarket! };
    const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
    const pub = createPublicClient({ chain, transport: http(RPC) }) as PublicClient;
    const rpc = (m: string, p: unknown[]) => pub.request({ method: m as never, params: p as never });
    const [c, a, b] = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()));
    for (const x of [c, a, b]) await rpc("anvil_setBalance", [x!.address, "0x56BC75E2D63100000"]);
    const [creator, alice, bob] = [c, a, b].map((account) => createWalletClient({ chain, transport: http(RPC), account }));
    const from = Number(await pub.getBlockNumber());

    const drawing = { slot: "held" as const, cells: [[0, 1, 0], [1, 2, 1], [0, 3, 0], [0, 3, 0]], colours: ["#2b2140", "#ffc83d", "#7a5236"] };
    const { id } = await publishDesign(pub, creator!, V1, { pixels: encodeDesign(drawing), name: "Moon staff", price: parseEther("0.001"), maxSupply: 50, royaltyBps: 0 });
    await buyDesign(pub, alice!, V1, id, 1, parseEther("0.001"));
    const { listingId: cheap } = await listCopies(pub, alice!, V1, id, 1, parseEther("0.0001"));
    const { listingId: dear } = await listCopies(pub, alice!, V1, id, 1, parseEther("0.01"));
    await buyListing(pub, bob!, V1, dear, 1, parseEther("0.01"));
    // the cheap listing cannot be bought while Alice holds nothing; once she buys a copy for herself it is live again
    await buyDesign(pub, alice!, V1, id, 1, parseEther("0.001"));
    expect((await readListings(pub, V1)).some((l) => l.id === cheap), "V1 would sell the forgotten listing").toBe(true);

    const watch = createListingWatch({ rpc: RPC!, market: V1.address, fromBlock: from, client: pub, paceMs: 0 });
    await watch.catchUp();
    expect(watch.state()).toEqual({ ready: true, retired: [cheap.toString()] });
  }, 300_000);
});
