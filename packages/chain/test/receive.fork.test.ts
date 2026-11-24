/**
 * A13 on an X Layer fork: one of the public test accounts carries an EIP-7702 delegation on mainnet, to a contract
 * with no ERC-721 receiver; keeping a pet for it is refused in the simulation, before any wallet prompt, and the game's
 * check recognises the refusal as viem reports it from the real registry.
 */
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { petRegistryAbi } from "../src/registryAbi";
import { refusesTokens } from "../src/receive";
import d from "../deployments/xlayer.json" with { type: "json" };

const RPC = process.env.FORK_RPC;
/** anvil's first public test key: its address delegates on X Layer to a contract that takes no NFTs */
const DELEGATED = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");

describe.skipIf(!RPC)("a delegated wallet keeping a pet, on an X Layer fork (A13)", () => {
  it("is refused before any wallet prompt, and the refusal is recognised", { timeout: 60_000 }, async () => {
    if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(RPC!)) throw new Error("fork tests run only against a local node");
    const pub = createPublicClient({ transport: http(RPC) });
    const code = await pub.getCode({ address: DELEGATED.address });
    if (!code?.startsWith("0xef0100")) return; // the delegation was lifted on mainnet: nothing to show here
    const failure = await pub
      .simulateContract({
        address: d.registry as `0x${string}`,
        abi: petRegistryAbi,
        functionName: "hatch",
        args: [DELEGATED.address, 0, d.processor as `0x${string}`, BigInt(d.circuits.gentle.id), 0n],
        account: DELEGATED,
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(failure, "the mint is refused").not.toBeNull();
    expect(refusesTokens(failure)).toBe(true);
  });
});
