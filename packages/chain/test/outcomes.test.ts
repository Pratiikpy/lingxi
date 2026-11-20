/** A82: what became of a hatch or a birth is "unknown" only when the chain says so, never when it could not be read. */
import { describe, expect, it } from "vitest";
import { TransactionNotFoundError, TransactionReceiptNotFoundError, type PublicClient } from "viem";
import { birthOutcome } from "../src/breeding";
import { hatchOutcome } from "../src/registry";
import type { Deployment } from "../src/registry";

const TX = `0x${"ab".repeat(32)}` as const;
const d = { registry: "0x103d7252eb6b2fec22b3f65a6bb605945f280e99" } as unknown as Deployment;
const owner = "0x0000000000000000000000000000000000000001" as const;

/** A node that fails to answer, or one that answers that it knows no such transaction. */
const down = { getTransactionReceipt: async () => { throw new TypeError("Failed to fetch"); }, getTransaction: async () => { throw new TypeError("Failed to fetch"); } } as unknown as PublicClient;
const unknown = {
  getTransactionReceipt: async () => { throw new TransactionReceiptNotFoundError({ hash: TX }); },
  getTransaction: async () => { throw new TransactionNotFoundError({ hash: TX }); },
} as unknown as PublicClient;
const pending = { getTransactionReceipt: async () => { throw new TransactionReceiptNotFoundError({ hash: TX }); }, getTransaction: async () => ({ hash: TX }) } as unknown as PublicClient;
const receiptOnly = { getTransactionReceipt: async () => { throw new TransactionReceiptNotFoundError({ hash: TX }); }, getTransaction: async () => { throw new TypeError("Failed to fetch"); } } as unknown as PublicClient;

describe("a sent transaction's outcome (A82)", () => {
  it("a node that fails to answer is not a transaction that was never sent", async () => {
    await expect(hatchOutcome(down, d, TX, owner)).rejects.toThrow();
    await expect(birthOutcome(down, TX)).rejects.toThrow();
    await expect(hatchOutcome(receiptOnly, d, TX, owner), "no receipt yet, and the transaction could not be read").rejects.toThrow();
  });

  it("the chain saying it knows no such transaction is unknown, and one it knows but has not mined is pending", async () => {
    expect(await hatchOutcome(unknown, d, TX, owner)).toBe("unknown");
    expect(await birthOutcome(unknown, TX)).toBe("unknown");
    expect(await hatchOutcome(pending, d, TX, owner)).toBe("pending");
    expect(await birthOutcome(pending, TX)).toBe("pending");
  });
});
