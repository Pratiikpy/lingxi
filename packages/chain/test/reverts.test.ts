/**
 * A19: the contract's own reason for refusing a call, wherever it sits in the error. viem puts a decoded custom error
 * on a later line of its message ("The contract function "breed" reverted." comes first), and a wallet may pass back
 * only the error's selector; the game reads the name from the decoded error, then from anywhere in the text.
 */
import { BaseError, ContractFunctionRevertedError, encodeErrorResult, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import { breederV2Abi } from "../src/breederV2Abi";
import { revertName } from "../src/reverts";

const reverted = (errorName: string, args: readonly unknown[]) => {
  const data = encodeErrorResult({ abi: breederV2Abi, errorName: errorName as never, args: args as never });
  return new BaseError('The contract function "breed" reverted.', { cause: new ContractFunctionRevertedError({ abi: breederV2Abi, data, functionName: "breed" }) });
};

describe("the contract's own reason for a refusal (A19)", () => {
  it("is read from viem's decoded error, though its message starts with another line", () => {
    const e = reverted("NotAdult", [41n]);
    expect(e.message.split("\n")[0]).not.toMatch(/NotAdult/);
    expect(revertName(e, breederV2Abi)).toBe("NotAdult");
    expect(revertName(reverted("TooSoon", [41n]), breederV2Abi)).toBe("TooSoon");
  });

  it("is read from a wallet's own message, by name on any line or by the error's selector", () => {
    expect(revertName(new Error("execution reverted\nreason: TooManyChildren(7)"), breederV2Abi)).toBe("TooManyChildren");
    const selector = toFunctionSelector("NoConsent()");
    expect(revertName(new Error(`execution reverted: ${selector}`), breederV2Abi)).toBe("NoConsent");
    expect(revertName({ message: "failed", data: `${toFunctionSelector("FeeMoved(uint256)")}${"00".repeat(32)}` }, breederV2Abi)).toBe("FeeMoved");
  });

  it("is null for a failure that is not the contract's, or a name the contract does not have", () => {
    expect(revertName(new Error("User rejected the request."), breederV2Abi)).toBeNull();
    expect(revertName(new Error("NotAdultish thing"), breederV2Abi)).toBeNull();
    expect(revertName(undefined, breederV2Abi)).toBeNull();
    expect(revertName("TooSoon", breederV2Abi)).toBe("TooSoon");
  });
});
