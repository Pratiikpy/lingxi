/**
 * The fashion market from the game's helpers, on a local chain or fork with the
 * market deployed (skipped unless FORK_RPC and a deployment with outfitMarket):
 * a creator publishes a design drawn with the game's encoder, a buyer buys a copy,
 * lists it, a third player buys it, and everyone withdraws exactly what is owed.
 */

import { forkHttp } from "./forkRpc";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeDesign, encodeDesign } from "@lingxi/art";
import {
  buyDesign,
  buyListing,
  copiesHeld,
  listCopies,
  proceedsOwed,
  publishDesign,
  readDesign,
  readListings,
  withdrawProceeds,
  xLayer,
  type Deployment,
} from "../src/index";

const RPC = process.env.FORK_RPC;
const file =
  process.env.DEPLOYMENT_FILE ??
  new URL("../deployments/local.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const d = JSON.parse(readFileSync(file, "utf8")) as Deployment;
const V1 = { v: 1 as const, address: d.outfitMarket! };

describe.skipIf(!RPC || !d.outfitMarket)("the first (OKB) fashion market through the game's helpers", () => {
  it("publish, buy, resell with royalty, withdraw", async () => {
    const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
    const pub = createPublicClient({ chain, transport: forkHttp(RPC) });
    const rpc = (m: string, p: unknown[]) => pub.request({ method: m as never, params: p as never });
    const [c, a, b] = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()));
    for (const x of [c, a, b]) await rpc("anvil_setBalance", [x!.address, "0x56BC75E2D63100000"]);
    const [creator, alice, bob] = [c, a, b].map((account) =>
      createWalletClient({ chain, transport: forkHttp(RPC), account }),
    );

    const drawing = {
      slot: "held" as const,
      cells: [
        [0, 1, 0],
        [1, 2, 1],
        [0, 3, 0],
        [0, 3, 0],
      ],
      colours: ["#2b2140", "#ffc83d", "#7a5236"],
    };
    const { id } = await publishDesign(pub, creator!, V1, {
      pixels: encodeDesign(drawing),
      name: "Sun staff",
      price: parseEther("0.001"),
      maxSupply: 50,
      royaltyBps: 500,
    });
    const onChain = await readDesign(pub, V1, id);
    expect(onChain.name).toBe("Sun staff");
    expect(decodeDesign(Uint8Array.from(Buffer.from(onChain.pixels.slice(2), "hex"))).cells).toEqual(drawing.cells);

    await buyDesign(pub, alice!, V1, id, 2, onChain.price);
    expect((await copiesHeld(pub, V1, a!.address, [id]))[0]).toBe(2n);
    const { listingId } = await listCopies(pub, alice!, V1, id, 2, parseEther("0.004"));
    expect((await readListings(pub, V1)).some((l) => l.id === listingId)).toBe(true);
    await buyListing(pub, bob!, V1, listingId, 1, parseEther("0.004"));
    expect((await copiesHeld(pub, V1, b!.address, [id]))[0]).toBe(1n);

    // creator: 2 × 0.001 × 97% + royalty 5% of 0.004; alice: 0.004 × (100 − 3 − 5)%
    expect(await proceedsOwed(pub, V1, c!.address)).toBe(parseEther("0.00194") + parseEther("0.0002"));
    expect(await proceedsOwed(pub, V1, a!.address)).toBe(parseEther("0.00368"));
    const before = await pub.getBalance({ address: a!.address });
    await withdrawProceeds(pub, alice!, V1);
    expect(await proceedsOwed(pub, V1, a!.address)).toBe(0n);
    expect((await pub.getBalance({ address: a!.address })) > before).toBe(true);
  }, 300_000);
});
