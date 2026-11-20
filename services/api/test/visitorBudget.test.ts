/** A81: visitor reads that fall back to the jobs' node have a budget. */
import { describe, expect, it } from "vitest";
import { budgetedRequest } from "../src/visitorBudget";

describe("the fallback to the jobs' node is budgeted (A81)", () => {
  it("passes calls up to its budget and refuses the next at once, without reaching the node", async () => {
    let reached = 0;
    const node = async () => (reached++, "0x1");
    const request = budgetedRequest(node, 3, () => 0);
    for (let i = 0; i < 3; i++) expect(await request({ method: "eth_blockNumber" })).toBe("0x1");
    await expect(request({ method: "eth_blockNumber" })).rejects.toThrow(/budget/);
    expect(reached, "the refused call never reached the node").toBe(3);
  });

  it("gives the budget back a minute later", async () => {
    let t = 0;
    const request = budgetedRequest(async () => "0x1", 1, () => t);
    await request({ method: "eth_chainId" });
    await expect(request({ method: "eth_chainId" })).rejects.toThrow(/budget/);
    t += 61_000;
    expect(await request({ method: "eth_chainId" })).toBe("0x1");
  });
});
