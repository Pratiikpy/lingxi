/**
 * A13: a wallet whose address runs code that refuses tokens (an EIP-7702 delegation to a contract with no receiver)
 * cannot be sent a pet or an item; the simulation that runs before any wallet prompt says so, and the game must
 * recognise it, from viem's decoded error or from the raw selector a wallet passes back.
 */
import { BaseError, ContractFunctionRevertedError, encodeErrorResult, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { refusesTokens } from "../src/receive";
import { petRegistryAbi } from "../src/registryAbi";

const SOMEONE = "0x00000000000000000000000000000000000000aa";

describe("a wallet that cannot receive tokens (A13)", () => {
  it("is recognised in viem's decoded revert of a pet's mint, wrapped as a simulation wraps it", () => {
    const data = encodeErrorResult({ abi: petRegistryAbi, errorName: "ERC721InvalidReceiver", args: [SOMEONE] });
    const revert = new ContractFunctionRevertedError({ abi: petRegistryAbi, data, functionName: "hatch" });
    const wrapped = new BaseError("The contract function \"hatch\" reverted.", { cause: revert });
    expect(refusesTokens(wrapped)).toBe(true);
  });

  it("is recognised for an item (ERC-1155), by name or by selector in a wallet's message", () => {
    const abi = parseAbi(["error ERC1155InvalidReceiver(address receiver)"]);
    const data = encodeErrorResult({ abi, errorName: "ERC1155InvalidReceiver", args: [SOMEONE] });
    expect(refusesTokens(new BaseError("reverted", { cause: new ContractFunctionRevertedError({ abi, data, functionName: "mint" }) }))).toBe(true);
    expect(refusesTokens(new Error(`execution reverted: 0x57f447ce000000000000000000000000${SOMEONE.slice(2)}`))).toBe(true);
    expect(refusesTokens(new Error("execution reverted with custom error 0x64a0ae92"))).toBe(true);
  });

  it("is not claimed for any other failure, or for something that is not an error", () => {
    const data = encodeErrorResult({ abi: petRegistryAbi, errorName: "NotKeeper" });
    expect(refusesTokens(new BaseError("reverted", { cause: new ContractFunctionRevertedError({ abi: petRegistryAbi, data, functionName: "checkpoint" }) }))).toBe(false);
    expect(refusesTokens(new Error("User rejected the request."))).toBe(false);
    expect(refusesTokens("User denied account access")).toBe(false);
    expect(refusesTokens(undefined)).toBe(false);
  });
});
