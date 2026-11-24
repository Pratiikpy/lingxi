/**
 * The relay gate on an X Layer fork (skipped unless FORK_RPC and RELAY_KEY_FILE are set): a pet is hatched by its
 * owner, the server checks keepers against the forked PetRegistry, the relayer really tapes out, and the brain it
 * returns is the circuit that was minted (read from the receipt) and the pet can switch to it. Strangers, unsigned
 * requests and replays are refused, and none of them costs the relayer anything.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { STARTERS, bytesToHex, compileProgram, netlistBytes } from "@lingxi/brain";
import {
  type Deployment,
  hatchOnChain,
  petRegistryAbi,
  processorAbi,
  readPet,
  setBrainOnChain,
  signRelay,
  xLayer,
} from "@lingxi/chain";
import { composeProgram, createPet, mindBrain, packState } from "@lingxi/game";
import { RateLimiter } from "../src/limit";
import { RelayQuota } from "../src/relayGate";
import { BrainRelayer } from "../src/relayer";
import { createApp } from "../src/server";

const RPC = process.env.FORK_RPC;
const RELAY_KEY_FILE = process.env.RELAY_KEY_FILE;

describe.skipIf(!RPC || !RELAY_KEY_FILE)("the relay gate, on an X Layer fork", () => {
  it("tapes out only for the pet's keeper, and the brain it returns is the one minted", async () => {
    const file =
      process.env.DEPLOYMENT_FILE ??
      new URL("../../../packages/chain/deployments/xlayer.json", import.meta.url).pathname.replace(
        /^\/([A-Za-z]:)/,
        "$1",
      );
    const d = JSON.parse(readFileSync(file, "utf8")) as Deployment;
    const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
    const pub = createPublicClient({ chain, transport: http(RPC) });
    const rpc = (method: string, params: unknown[]) =>
      pub.request({ method: method as never, params: params as never });
    const owner = privateKeyToAccount(generatePrivateKey());
    const stranger = privateKeyToAccount(generatePrivateKey());
    await rpc("anvil_setBalance", [owner.address, "0x56BC75E2D63100000"]);
    const wallet = createWalletClient({ chain, transport: http(RPC), account: owner });

    const t0 = Number((await pub.getBlock()).timestamp) * 1000;
    const brain = mindBrain({ line: "gentle", lessons: [] });
    const pet = createPet({
      name: "Sora",
      line: "gentle",
      now: t0,
      tzOffsetMin: 0,
      brain: { fast: brain.fast, nState: brain.nState, program: STARTERS.gentle },
    });
    const { petId } = await hatchOnChain(pub, wallet, d, "gentle", packState(pet, "baby"));
    expect((await readPet(pub, d, petId)).owner.toLowerCase()).toBe(owner.address.toLowerCase());

    const env = Object.fromEntries(
      readFileSync(RELAY_KEY_FILE!, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
    );
    const relayer = new BrainRelayer({
      rpc: RPC!,
      processor: d.processor as Address,
      key: (env.K ?? env.LINGXI_RELAYER_KEY) as Hex,
      storeFile: join(mkdtempSync(join(tmpdir(), "lx-")), "brains.json"),
      maxPerDay: 50,
      maxPerHour: 50,
      reserveWei: 0n,
    });
    const isKeeper = async (id: string, who: Address) =>
      (await pub.readContract({
        address: d.registry,
        abi: petRegistryAbi,
        functionName: "isKeeper",
        args: [BigInt(id), who],
      })) as boolean;
    const app = createApp(
      null,
      undefined,
      relayer,
      new RateLimiter(1000, 3_600_000),
      null,
      undefined,
      isKeeper,
      new RelayQuota({ perPetPerDay: 6, perSignerPerDay: 12, perHour: 12 }),
    );
    const post = (json: unknown) =>
      app.request("/api/tapeout", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" },
        body: JSON.stringify(json),
      });

    // a lesson nobody has taught before, so the relayer must really tape it out
    const lesson = { when: { hunger: [3], joy: [0], time: [Number(BigInt(petId) % 4n)] }, then: { want: 5, mood: 2 } };
    const body = { line: "gentle", lessons: [lesson] };
    const before = await relayer.balance();

    // strangers, unsigned and drained requests cost nothing
    expect((await post(body)).status).toBe(400);
    expect((await post(await signRelay(stranger, "brain", petId.toString(), body))).status).toBe(403);
    for (let i = 0; i < 37; i++)
      await post({
        kind: "brain",
        petId: petId.toString(),
        payload: JSON.stringify(body),
        auth: {
          signer: stranger.address,
          nonce: `${i}`.padStart(16, "0"),
          time: Math.floor(Date.now() / 1000),
          signature: `0x${"11".repeat(65)}`,
        },
      });
    expect(await relayer.balance()).toBe(before);

    // the owner's signed request is taped out, once
    const signed = await signRelay(owner, "brain", petId.toString(), body);
    const res = (await (await post(signed)).json()) as { ok: boolean; brainId?: string; reused?: boolean };
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true, reused: false });
    expect((await post(signed)).status).toBe(401);

    // the id is the circuit that holds exactly this brain, and the pet can switch to it
    const want = bytesToHex(netlistBytes(compileProgram(composeProgram("gentle", [lesson as never], 0))));
    const onChain = (await pub.readContract({
      address: d.processor as Address,
      abi: processorAbi,
      functionName: "netlist",
      args: [BigInt(res.brainId!)],
    })) as Hex;
    expect(onChain.toLowerCase()).toBe(want.toLowerCase());
    await setBrainOnChain(pub, wallet, d, petId, d.processor as Address, BigInt(res.brainId!));
    expect((await readPet(pub, d, petId)).brainId).toBe(BigInt(res.brainId!));
  }, 300_000);
});
