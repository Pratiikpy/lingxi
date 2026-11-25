/**
 * H8 on a fork of X Layer mainnet, against the real deployed markets: the two fee rails, bought as a real buyer through
 * the game's own chain helpers and read back from the chain. A BEM piece's 3% arrives at the dead address; an OKB
 * piece's 3% (on a creator's sale and on a resale) is owed to the treasury, which is the project wallet; and the live
 * numbers' counter reports exactly what the chain owes the project.
 */
import { forkHttp } from "./forkRpc";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  erc20Abi,
  parseAbi,
  parseEther,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encodeDesign } from "@lingxi/art";
import {
  buyDesign,
  buyListing,
  listCopies,
  parseBem,
  proceedsOwed,
  publishDesign,
  xLayer,
  type Deployment,
} from "@lingxi/chain";
import { giveToken } from "../../../packages/chain/scripts/lib/forkFund";
import { createSalesCounter } from "../src/numbers";

const RPC = process.env.FORK_RPC;
const FILE = process.env.DEPLOYMENT_FILE;
const d = FILE ? (JSON.parse(readFileSync(FILE, "utf8")) as Deployment) : null;
const DEAD: Address = "0x000000000000000000000000000000000000dEaD";
const views = parseAbi([
  "function bem() view returns (address)",
  "function totalBurned() view returns (uint256)",
  "function treasury() view returns (address)",
  "function feeBps() view returns (uint16)",
  "function owed(address) view returns (uint256)",
]);
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

describe.skipIf(!RPC || !d?.outfitMarket || !d?.outfitMarketV2 || !d?.deployer)(
  "the two fee rails on the real markets (H8)",
  () => {
    it(
      "BEM: the 3% is burned; OKB: the 3% is owed to the project wallet, and the counter says so",
      { timeout: 300_000 },
      async () => {
        const V1 = { v: 1 as const, address: d!.outfitMarket! };
        const V2 = { v: 2 as const, address: d!.outfitMarketV2! };
        const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
        const pub = createPublicClient({ chain, transport: forkHttp(RPC) }) as PublicClient;
        const rpc = (m: string, p: unknown[]) => pub.request({ method: m as never, params: p as never });
        const [c, a, b] = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()));
        for (const x of [c, a, b]) await rpc("anvil_setBalance", [x!.address, "0x56BC75E2D63100000"]);
        const [creator, alice, bob] = [c, a, b].map((account) =>
          createWalletClient({ chain, transport: forkHttp(RPC), account }),
        );
        const read = <T>(
          address: Address,
          functionName: "bem" | "totalBurned" | "treasury" | "feeBps" | "owed",
          args?: readonly [Address],
        ) => pub.readContract({ address, abi: views, functionName, ...(args ? { args } : {}) } as never) as Promise<T>;

        // the rails as deployed: BEM market 3% to the dead address; OKB market 3% to the project wallet
        const bem = await read<Address>(V2.address, "bem");
        expect(await read<number>(V2.address, "feeBps")).toBe(300);
        expect(await read<number>(V1.address, "feeBps")).toBe(300);
        const treasury = await read<Address>(V1.address, "treasury");
        expect(treasury.toLowerCase()).toBe(d!.deployer!.toLowerCase());

        // BEM rail: Alice buys three copies of a 0.5 BEM piece with real BEM
        await giveToken(pub, bem, a!.address, parseBem("10")!);
        const priceBem = parseBem("0.5")!;
        const { id: bemPiece } = await publishDesign(pub, creator!, V2, {
          pixels: encodeDesign(drawing),
          name: "Ember staff",
          price: priceBem,
          maxSupply: 10,
          royaltyBps: 500,
        });
        const deadBefore = await pub.readContract({
          address: bem,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [DEAD],
        });
        const burnedBefore = await read<bigint>(V2.address, "totalBurned");
        await buyDesign(pub, alice!, V2, bemPiece, 3, priceBem);
        const totalBem = priceBem * 3n;
        const feeBem = (totalBem * 300n + 9_999n) / 10_000n; // OutfitMarketV2 rounds its burn up
        expect(
          (await pub.readContract({ address: bem, abi: erc20Abi, functionName: "balanceOf", args: [DEAD] })) -
            deadBefore,
          "at the dead address",
        ).toBe(feeBem);
        expect((await read<bigint>(V2.address, "totalBurned")) - burnedBefore).toBe(feeBem);
        expect(await proceedsOwed(pub, V2, c!.address)).toBe(totalBem - feeBem);

        // OKB rail: Alice buys three copies of a 0.002 OKB piece, lists one, Bob buys it
        const from = Number(await pub.getBlockNumber()) + 1;
        const owedBefore = await read<bigint>(V1.address, "owed", [treasury]);
        const priceOkb = parseEther("0.002");
        const { id: okbPiece } = await publishDesign(pub, creator!, V1, {
          pixels: encodeDesign(drawing),
          name: "Ember crown",
          price: priceOkb,
          maxSupply: 10,
          royaltyBps: 500,
        });
        await buyDesign(pub, alice!, V1, okbPiece, 3, priceOkb);
        const { listingId } = await listCopies(pub, alice!, V1, okbPiece, 1, parseEther("0.01"));
        await buyListing(pub, bob!, V1, listingId, 1, parseEther("0.01"));
        // OutfitMarket rounds each fee down
        const feeMint = (priceOkb * 3n * 300n) / 10_000n;
        const feeResale = (parseEther("0.01") * 300n) / 10_000n;
        expect((await read<bigint>(V1.address, "owed", [treasury])) - owedBefore, "owed to the project wallet").toBe(
          feeMint + feeResale,
        );
        expect(await proceedsOwed(pub, V1, c!.address)).toBe(
          priceOkb * 3n - feeMint + (parseEther("0.01") * 500n) / 10_000n,
        );
        expect(await proceedsOwed(pub, V1, a!.address)).toBe(
          parseEther("0.01") - feeResale - (parseEther("0.01") * 500n) / 10_000n,
        );

        // the live numbers' counter, walking these blocks, reports exactly what the chain now owes the project for them, and
        // (C2) tells the team's own buying apart: Bob is named as a team wallet here, so the resale he bought is the team
        // paying itself, while Alice's three copies of Carol's design are a player's
        const counter = createSalesCounter({
          rpc: RPC!,
          markets: [
            {
              address: V1.address,
              fromBlock: from,
              earns: { project: d!.deployer!, feeBps: 300, treasury: d!.deployer! },
            },
          ],
          team: [bob!.account!.address],
          client: pub,
          paceMs: 0,
        });
        await counter.catchUp();
        expect(counter.earned(V1.address)).toEqual({
          okb: (feeMint + feeResale).toString(),
          feeBps: 300,
          treasury,
          toProject: true,
          fromTeam: feeResale.toString(),
        });
        expect(counter.totals(V1.address)).toEqual({
          copies: 4,
          paid: (priceOkb * 3n + parseEther("0.01")).toString(),
          sales: 2,
          byTeam: { copies: 1, paid: parseEther("0.01").toString() },
          selfBuys: { copies: 0, paid: "0" },
          byPlayers: { copies: 3, paid: (priceOkb * 3n).toString(), buyers: 1 },
        });
      },
    );
  },
);
