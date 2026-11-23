/**
 * Community goals on a fork of X Layer mainnet, against the contracts deployed there (skipped unless FORK_RPC,
 * RELAY_KEY_FILE and DEPLOYMENT_FILE are set). Three players do what the goals count — hatch, save days, give a
 * pet away, breed a child for BEM, buy an outfit for BEM — on both sides of a goal's start, and the ledger must
 * credit every event to the right wallet and count only what falls inside the window.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Address, type Hex, createPublicClient, createWalletClient, encodeAbiParameters, http, keccak256, pad, parseAbi, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { STARTERS, compileProgram, fastBrain, stateBits } from "@lingxi/brain";
import { encodeDesign } from "@lingxi/art";
import { type Deployment, type Market, allowPartnerOnChain, breedOnChain, buyDesign, checkpointOnChain, hatchOnChain, parseBem, publishDesign, readDesign, readPet, xLayer } from "@lingxi/chain";
import { createPet, packState } from "@lingxi/game";
import { GOALS } from "@lingxi/world";
import { BrainRelayer } from "../src/relayer";
import { createGoalLedger, reportGoals } from "../src/goals";

const RPC = process.env.FORK_RPC;
const RELAY_KEY_FILE = process.env.RELAY_KEY_FILE;
const FILE = process.env.DEPLOYMENT_FILE;

describe.skipIf(!RPC || !RELAY_KEY_FILE || !FILE)("community goals, counted from a fork of X Layer mainnet", () => {
  it("credits saves, new pets, children and burned BEM to the right wallets, inside the window only", { timeout: 600_000 }, async () => {
    const d = JSON.parse(readFileSync(FILE!, "utf8")) as Deployment & { outfitMarketV2: Address; breederBem?: boolean };
    expect(d.breederBem).toBe(true);
    const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
    const pub = createPublicClient({ chain, transport: http(RPC) });
    const rpc = (method: string, params: unknown[]) => pub.request({ method: method as never, params: params as never });
    const keys = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()));
    for (const k of keys) await rpc("anvil_setBalance", [k.address, "0x56BC75E2D63100000"]);
    const [alice, bob, carol] = keys.map((account) => createWalletClient({ chain, transport: http(RPC), account }));
    const [A, B, C] = keys.map((k) => k.address.toLowerCase()) as [string, string, string];
    const BEM = "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952" as Address;
    const fundBem = (who: Address, n: bigint) => rpc("anvil_setStorageAt", [BEM, keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [who, 5n])), pad(toHex(n), { size: 32 })]);
    const brain = (line: "gentle" | "bold") => ({ fast: fastBrain(compileProgram(STARTERS[line])), nState: stateBits(STARTERS[line]), program: STARTERS[line] });
    // the goals' calendar, moved to open an hour after the fork's head: every window keeps its length and its place
    // against the others, so the rules are tested whatever date the fork is from
    const head = Number((await pub.getBlock()).timestamp);
    const shift = head + 3_600 - GOALS.find((g) => g.metric === "saves")!.start;
    const goals = GOALS.map((g) => ({ ...g, start: g.start + shift, end: g.end + shift }));
    const g1 = goals.find((g) => g.metric === "saves")!;
    expect(head).toBeLessThan(g1.start);
    const startBlock = Number(await pub.getBlockNumber()) + 1;

    // before the window: Alice hatches her pet (a new pet that must not count)
    const t0 = head * 1000;
    const petA = createPet({ name: "Mochi", line: "gentle", now: t0, tzOffsetMin: 0, brain: brain("gentle") });
    const { petId: a } = await hatchOnChain(pub, alice!, d, "gentle", packState(petA, "baby"));

    // the window opens: Alice saves day 1, Bob hatches his pet
    await rpc("evm_setNextBlockTimestamp", [g1.start + 600]);
    await rpc("evm_mine", []);
    await checkpointOnChain(pub, alice!, d, a, 1, packState(petA, "baby"), petA.logHash as Hex);
    const petB = createPet({ name: "Tofu", line: "bold", now: (g1.start + 600) * 1000, tzOffsetMin: 0, brain: brain("bold") });
    const { petId: b } = await hatchOnChain(pub, bob!, d, "bold", packState(petB, "baby"));
    // a day later Alice saves again, then gives her pet to Carol
    await rpc("evm_increaseTime", [86_400]);
    await rpc("evm_mine", []);
    await checkpointOnChain(pub, alice!, d, a, 2, packState(petA, "baby"), petA.logHash as Hex);
    const erc721 = parseAbi(["function transferFrom(address from, address to, uint256 tokenId)"]);
    await pub.waitForTransactionReceipt({ hash: await alice!.writeContract({ address: d.registry as Address, abi: erc721, functionName: "transferFrom", args: [alice!.account!.address, carol!.account!.address, a], chain, account: alice!.account! }) });
    expect((await readPet(pub, d, a)).owner).toBe(carol!.account!.address);

    // eight days on, both grown: Carol saves the pet she was given, Bob saves his
    await rpc("evm_increaseTime", [8 * 86_400]);
    await rpc("evm_mine", []);
    await checkpointOnChain(pub, carol!, d, a, 10, packState(petA, "adult"), petA.logHash as Hex);
    await checkpointOnChain(pub, bob!, d, b, 9, packState(petB, "adult"), petB.logHash as Hex);

    // Carol and Bob's pets have a child: Bob consents, Carol pays the BEM fee, which is burned
    const env = Object.fromEntries(readFileSync(RELAY_KEY_FILE!, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
    const relayer = new BrainRelayer({ rpc: RPC!, processor: d.processor as Address, key: (env.K ?? env.LINGXI_RELAYER_KEY) as Hex, storeFile: join(mkdtempSync(join(tmpdir(), "lx-")), "brains.json"), maxPerDay: 50 });
    const [pa, pb] = [await readPet(pub, d, a), await readPet(pub, d, b)];
    const child = await relayer.relayChild({ parents: [pa.brainId.toString(), pb.brainId.toString()] });
    if (!child.ok) throw new Error(`child circuit: ${child.reason} ${"detail" in child ? child.detail : ""}`);
    await allowPartnerOnChain(pub, bob!, d, b, carol!.account!.address);
    await fundBem(carol!.account!.address, parseBem("1")!);
    await breedOnChain(pub, carol!, d, a, b, d.processor as Address, BigInt(child.brainId), 0);

    // Bob draws an outfit and sells it for 0.1 BEM; Alice buys two, and 3% of 0.2 BEM is burned
    const m: Market = { v: 2, address: d.outfitMarketV2 };
    const { id } = await publishDesign(pub, bob!, m, { pixels: encodeDesign({ slot: "held", cells: [[1, 2], [2, 1]], colours: ["#2b2140", "#ffc83d"] }), name: "Goal hat", price: parseBem("0.1")!, maxSupply: 10, royaltyBps: 0 });
    await fundBem(alice!.account!.address, parseBem("1")!);
    await buyDesign(pub, alice!, m, id, 2, (await readDesign(pub, m, id)).price);

    // the ledger, from the fork's first block of ours
    const ledger = createGoalLedger({ rpc: RPC!, registry: d.registry as Address, burners: [d.breeder as Address, d.outfitMarketV2], fromBlock: startBlock, client: pub as never, paceMs: 0 });
    await ledger.catchUp();
    // Carol is credited for the pet she was given. Alice's pet counts as a new pet for Alice, the wallet it was hatched
    // for, when its third different day is saved (Carol's save, in the window); Bob's pet, saved on one day, and the
    // child, never saved, are not settled and do not count
    const by = (m: string) => Object.fromEntries(ledger.entries().filter((e) => e.m === m && e.t >= g1.start).reduce((acc, e) => acc.set(e.w, (acc.get(e.w) ?? 0) + e.n), new Map<string, number>()));
    expect(by("saves")).toEqual({ [A]: 2, [C]: 1, [B]: 1 });
    expect(by("hatched")).toEqual({ [A]: 1 });
    expect(by("children")).toEqual({ [C]: 1 });
    expect(by("burned")).toEqual({ [C]: 10_000_000, [A]: 600_000 });

    const now = Number((await pub.getBlock()).timestamp);
    // the round this test plays in: the first, whose goals all open with the saves goal (later rounds follow it monthly)
    const round = goals.filter((g) => g.start === g1.start);
    expect(round.map((g) => g.metric).sort()).toEqual(["burned", "children", "hatched", "saves"]);
    const r = Object.fromEntries(reportGoals(ledger.entries(), round, now, [A]).map((g) => [g.metric, g]));
    expect(r.saves).toMatchObject({ total: 4, contributors: 3, mine: 2, state: "open" });
    expect(r.hatched).toMatchObject({ total: 1, contributors: 1, mine: 1 });
    expect(r.children).toMatchObject({ total: 1, contributors: 1, tiers: [] });
    expect(r.burned).toMatchObject({ total: 10_600_000, contributors: 2, mine: 600_000 });
    expect(r.burned!.top[0]).toMatchObject({ wallet: C, n: 10_000_000 });
  });
});
