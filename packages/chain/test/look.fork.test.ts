/**
 * PetLook against X Layer mainnet's own PetRegistry on a fork (skipped unless FORK_RPC
 * is set): deploy it, install the art with the same helpers the deploy script uses,
 * and check that the contract draws every one of the 128 pictures exactly as the game
 * does. Then plug it into the registry as its renderer and check names and metadata.
 */

import { forkHttp } from "./forkRpc";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { EXPRESSIONS } from "@lingxi/art";
import { buildLayers, canvasOfSvg, gameSprite, installCalls, lookOf, lookPalettes } from "../src/look";
import { petRegistryAbi } from "../src/registryAbi";
import { xLayer } from "../src/tapeout";

const RPC = process.env.FORK_RPC;
const here = dirname(fileURLToPath(import.meta.url));
const REGISTRY = "0x103d7252eb6b2fec22b3f65a6bb605945f280e99" as Address;
// read when the fork test runs, not when the file loads: a fresh clone has no compiled contracts until `forge build`
const art = () =>
  JSON.parse(readFileSync(resolve(here, "../../../contracts/out/PetLook.sol/PetLook.json"), "utf8")) as {
    abi: never[];
    bytecode: { object: Hex };
  };

/** A state word that the contract's look rules turn into exactly this stage, face and trace. */
function stateFor(stage: number, expression: (typeof EXPRESSIONS)[number], line = 0): bigint | null {
  const m = (food: number, joy: number, energy: number) =>
    (BigInt(food) << 64n) |
    (BigInt(joy) << 74n) |
    (BigInt(energy) << 84n) |
    (BigInt(stage) << 148n) |
    (BigInt(line) << 152n);
  const byFace: Partial<Record<(typeof EXPRESSIONS)[number], bigint>> = {
    neutral: m(800, 400, 900),
    happy: m(800, 600, 900),
    sparkly: m(800, 900, 900),
    sulk: m(800, 100, 900),
    sleepy: m(800, 400, 100),
    sad: m(100, 400, 900),
    dizzy: m(800, 400, 900) | (1n << 219n),
    asleep: m(800, 400, 900) | (1n << 151n),
  };
  return byFace[expression] ?? null;
}

describe.skipIf(!RPC)("PetLook on X Layer's registry", () => {
  it("draws every reachable picture exactly like the game, names pets, and serves the registry's metadata", async () => {
    const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
    const pub = createPublicClient({ chain, transport: forkHttp(RPC) });
    const rpc = (m: string, p: unknown[]) => pub.request({ method: m as never, params: p as never });
    const owner = privateKeyToAccount(generatePrivateKey());
    await rpc("anvil_setBalance", [owner.address, "0x56BC75E2D63100000"]);
    const wallet = createWalletClient({ chain, transport: forkHttp(RPC), account: owner });
    const tx = await wallet.deployContract({
      abi: art().abi,
      bytecode: art().bytecode.object,
      args: [REGISTRY, owner.address],
    });
    const look = (await pub.waitForTransactionReceipt({ hash: tx })).contractAddress!;
    const write = async (functionName: string, args: unknown[], account = owner) => {
      const w = createWalletClient({ chain, transport: forkHttp(RPC), account });
      const h = await w.writeContract({
        address: look,
        abi: art().abi,
        functionName: functionName as never,
        args: args as never,
      });
      const r = await pub.waitForTransactionReceipt({ hash: h });
      expect(r.status).toBe("success");
      return r;
    };
    const read = (functionName: string, args: unknown[]) =>
      pub.readContract({ address: look, abi: art().abi, functionName: functionName as never, args: args as never });

    const built = buildLayers();
    const calls = installCalls(built, lookPalettes().pets, lookPalettes().eggs);
    // freezing before the art is complete is refused
    await expect(
      wallet.writeContract({ address: look, abi: art().abi, functionName: "freezeArt" as never, args: [] as never }),
    ).rejects.toThrow(/ArtIncomplete/);
    // an oversized layer is refused (more than 400 runs)
    await expect(
      wallet.writeContract({
        address: look,
        abi: art().abi,
        functionName: "setLayers" as never,
        args: [[0n], [`0x${"00000105".repeat(401)}`]] as never,
      }),
    ).rejects.toThrow(/BadLayer/);
    let gas = 0n;
    for (const b of calls.batches) gas += (await write("setLayers", [b.keys, b.data])).gasUsed;
    for (const f of calls.faces) gas += (await write("setFaces", [f.slot, f.large, f.at])).gasUsed;
    for (const [i, p] of calls.palettes.entries()) gas += (await write("setPalette", [BigInt(i), p])).gasUsed;
    for (const f of calls.frames) gas += (await write("setFrame", [f.slot, f.x, f.y, f.size])).gasUsed;
    console.log(`art installed in ${calls.batches.length + calls.faces.length + 2} transactions, ${gas} gas`);

    // every face the look rules can reach, at every stage, drawn by the contract
    let checked = 0;
    const MAIN = ["#FF7A59", "#FFC83D", "#7FC0F2"]; // each line's main colour (CORAL, SUNNY, SKY)
    for (let line = 0; line < 3; line++)
      for (let stage = 0; stage <= 4; stage++)
        for (const e of EXPRESSIONS) {
          const state = stateFor(stage, e, line);
          if (state === null || (stage === 0 && e !== "neutral")) continue;
          const want = lookOf(state);
          const svg = (await read("svgOf", [state])) as string;
          expect(canvasOfSvg(svg).px, `${line} ${stage} ${e}`).toEqual(gameSprite(want).px);
          expect(svg).toContain(stage === 0 ? `.c5{fill:#FFF7E8}` : `.c5{fill:${MAIN[line]}}`);
          if (stage === 0) expect(svg).toContain(`.c14{fill:${MAIN[line]}}`); // the egg's spots in the line's colour
          expect(svg).toContain(`.c16{fill:#2B2140;fill-opacity:.20}`); // the ground shadow, 20% ink
          const fr = built.frames.find((x) => x.slot === (stage === 0 ? 0 : 10 * (line + 1) + stage))!;
          expect(svg).toContain(`viewBox="${fr.x} ${fr.y} ${fr.size} ${fr.size}"`);
          checked++;
        }
    expect(checked).toBe(3 * (1 + 4 * 8));
    const [l, s, f, lit] = (await read("lookOf", [stateFor(3, "sparkly", 2)!])) as [bigint, bigint, bigint, boolean];
    expect([Number(l), Number(s), EXPRESSIONS[Number(f)], lit]).toEqual([2, 3, "sparkly", true]);

    // names
    const petOwner = (await pub.readContract({
      address: REGISTRY,
      abi: petRegistryAbi,
      functionName: "ownerOf",
      args: [1n],
    })) as Address;
    await rpc("anvil_impersonateAccount", [petOwner]);
    await rpc("anvil_setBalance", [petOwner, "0x56BC75E2D63100000"]);
    const asOwner = { address: petOwner, type: "json-rpc" } as never;
    // names open once a pet is settled: three days on chain and its third day saved
    const ownerWallet = createWalletClient({ chain, transport: forkHttp(RPC), account: asOwner });
    const settled = (await pub.readContract({
      address: REGISTRY,
      abi: petRegistryAbi,
      functionName: "isSettled",
      args: [1n],
    })) as boolean;
    if (!settled) {
      await expect(
        pub.simulateContract({
          address: look,
          abi: art().abi,
          functionName: "setName" as never,
          args: [1n, "Mochi"] as never,
          account: petOwner,
        }),
      ).rejects.toThrow(/NotSettled/);
      await rpc("evm_increaseTime", [3 * 86_400 + 60]);
      await rpc("evm_mine", []);
      const now = (await pub.readContract({
        address: REGISTRY,
        abi: petRegistryAbi,
        functionName: "pet",
        args: [1n],
      })) as { state: bigint; logHash: Hex };
      await pub.waitForTransactionReceipt({
        hash: await ownerWallet.writeContract({
          address: REGISTRY,
          abi: petRegistryAbi,
          functionName: "checkpoint",
          args: [1n, 3, now.state, now.logHash],
        }),
      });
    }
    await write("setName", [1n, "Mochi"], asOwner);
    expect(await read("nameOf", [1n])).toBe("Mochi");
    await write("setName", [1n, "团子 Mochi"], asOwner);
    expect(await read("nameOf", [1n])).toBe("团子 Mochi");
    const stranger = privateKeyToAccount(generatePrivateKey());
    await rpc("anvil_setBalance", [stranger.address, "0x56BC75E2D63100000"]);
    await expect(
      createWalletClient({ chain, transport: forkHttp(RPC), account: stranger }).writeContract({
        address: look,
        abi: art().abi,
        functionName: "setName" as never,
        args: [1n, "Thief"] as never,
      }),
    ).rejects.toThrow(/NotPetOwner/);
    for (const bad of [" lead", "trail ", 'qu"ote', "<b>", "a&b", "x".repeat(25), "tab\there"])
      expect(await read("validName", [`0x${Buffer.from(bad).toString("hex")}`]), bad).toBe(false);
    expect(await read("validName", [`0x${Buffer.from([0xc0, 0xaf]).toString("hex")}`])).toBe(false); // overlong
    expect(await read("validName", [`0x${Buffer.from([0xe4, 0xb8]).toString("hex")}`])).toBe(false); // cut short
    expect(await read("validName", [`0x${Buffer.from("小龙 Lóng").toString("hex")}`])).toBe(true);
    // hidden characters: zero-width space, no-break space, right-to-left override, BOM, variation selector
    for (const bad of ["Bo​b", " Bob", "Bob‮", "﻿Bob", "Bob️", "a⁠b"])
      expect(await read("validName", [`0x${Buffer.from(bad).toString("hex")}`]), JSON.stringify(bad)).toBe(false);
    // moderation: only the owner can release a name, and it frees it for others
    await expect(
      createWalletClient({ chain, transport: forkHttp(RPC), account: stranger }).writeContract({
        address: look,
        abi: art().abi,
        functionName: "releaseName" as never,
        args: [1n] as never,
      }),
    ).rejects.toThrow(/Ownable/);
    await write("releaseName", [1n]);
    expect(await read("nameOf", [1n])).toBe("");
    await write("setName", [1n, "团子 Mochi"], asOwner);
    // freezing works once the art is complete, and then nothing can change
    await write("freezeArt", []);
    await expect(
      wallet.writeContract({
        address: look,
        abi: art().abi,
        functionName: "setPalette" as never,
        args: [0n, calls.palettes[0]] as never,
      }),
    ).rejects.toThrow(/ArtIsFrozen/);

    // the registry's owner points it at PetLook; pet #1's metadata is now drawn on chain
    const regOwner = (await pub.readContract({
      address: REGISTRY,
      abi: petRegistryAbi,
      functionName: "owner",
    })) as Address;
    await rpc("anvil_impersonateAccount", [regOwner]);
    await rpc("anvil_setBalance", [regOwner, "0x56BC75E2D63100000"]);
    const rw = createWalletClient({
      chain,
      transport: forkHttp(RPC),
      account: { address: regOwner, type: "json-rpc" } as never,
    });
    await pub.waitForTransactionReceipt({
      hash: await rw.writeContract({
        address: REGISTRY,
        abi: petRegistryAbi,
        functionName: "setRenderer",
        args: [look],
      }),
    });
    const uri = (await pub.readContract({
      address: REGISTRY,
      abi: petRegistryAbi,
      functionName: "tokenURI",
      args: [1n],
    })) as string;
    const meta = JSON.parse(Buffer.from(uri.split(",")[1]!, "base64").toString("utf8")) as {
      name: string;
      image: string;
      attributes: Array<{ trait_type: string; value: unknown }>;
    };
    expect(meta.name).toBe("团子 Mochi");
    const svg = Buffer.from(meta.image.split(",")[1]!, "base64").toString("utf8");
    const pet = (await pub.readContract({
      address: REGISTRY,
      abi: petRegistryAbi,
      functionName: "pet",
      args: [1n],
    })) as { state: bigint; day: number };
    expect(canvasOfSvg(svg).px).toEqual(gameSprite(lookOf(pet.state)).px);
    expect(meta.attributes.find((a) => a.trait_type === "days saved")?.value).toBe(pet.day);
    console.log(`pet #1 on chain: ${JSON.stringify(lookOf(pet.state))}, svg ${svg.length} bytes`);
  }, 300_000);
});
