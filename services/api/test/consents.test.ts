/** A63: every breeding consent on X Layer, read from the breeders' events, so a pet's sheet can list and withdraw them. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { createConsentIndex, withConsents } from "../src/consents";

const V2 = "0x8da8221466de12321e6ee2ea73d62aaf28bb11b0";
const FREE = "0x5e5bbb798c5a2afc89f431debabaa0b889f77dd1";
const W = "0x1111111111111111111111111111111111111111";
const X = "0x2222222222222222222222222222222222222222";

interface FakeLog {
  address: string;
  eventName: "Consent";
  blockNumber: bigint;
  logIndex: number;
  transactionHash: string;
  args: { petId: bigint; partnerOwner: string; allowed: boolean };
}
const consent = (address: string, pet: number, partner: string, allowed: boolean, block: number, logIndex = 0): FakeLog => ({
  address,
  eventName: "Consent",
  blockNumber: BigInt(block),
  logIndex,
  transactionHash: `0x${block.toString(16)}${logIndex}`,
  args: { petId: BigInt(pet), partnerOwner: partner, allowed },
});

/** A node with X Layer's real limit: any log query over more than 100 blocks is refused. */
function strictNode(head: number, logs: FakeLog[]) {
  const asked: Array<[number, number]> = [];
  const client = {
    getBlockNumber: async () => BigInt(head),
    getLogs: async ({ fromBlock, toBlock, address }: { fromBlock: bigint; toBlock: bigint; address: string[] }) => {
      const from = Number(fromBlock);
      const to = Number(toBlock);
      asked.push([from, to]);
      if (to - from + 1 > 100) throw new Error("block range greater than 100 max");
      const at = address.map((a) => a.toLowerCase());
      return logs.filter((l) => Number(l.blockNumber) >= from && Number(l.blockNumber) <= to && at.includes(l.address));
    },
  };
  return { client: client as unknown as PublicClient, asked };
}

describe("the breeding consent index (A63)", () => {
  it("reads both breeders in windows of at most 100 blocks and lists the partners whose latest event allowed them", async () => {
    const { client, asked } = strictNode(1_480, [
      consent(V2, 7, W, true, 1_010),
      consent(V2, 7, X, true, 1_200),
      consent(V2, 7, X, false, 1_300),
      consent(FREE, 7, W, true, 1_050),
      consent(V2, 8, X, true, 1_470, 0),
      consent(V2, 8, X, false, 1_470, 1),
      consent(V2, 8, X, true, 1_470, 2),
    ]);
    const index = createConsentIndex({ breeders: [V2, FREE], fromBlock: 1_000, client, paceMs: 0 });
    await index.catchUp();
    expect(asked.every(([f, t]) => t - f + 1 <= 100)).toBe(true);
    expect(index.head()).toBe(1_480);
    expect(index.of("7")).toEqual([
      { breeder: V2, partner: W, block: 1_010, tx: "0x3f20" },
      { breeder: FREE, partner: W, block: 1_050, tx: "0x41a0" },
    ]);
    // within one block, the last event stands
    expect(index.of("8").map((c) => c.partner)).toEqual([X]);
    expect(index.of("9")).toEqual([]);
  });

  it("keeps its place across a restart", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "consents-")), "consents.json");
    const first = strictNode(1_150, [consent(V2, 7, W, true, 1_010)]);
    await createConsentIndex({ breeders: [V2], fromBlock: 1_000, client: first.client, paceMs: 0, store }).catchUp();
    const second = strictNode(1_250, [consent(V2, 7, W, true, 1_010), consent(V2, 7, W, false, 1_220)]);
    const again = createConsentIndex({ breeders: [V2], fromBlock: 1_000, client: second.client, paceMs: 0, store });
    expect(again.head()).toBe(1_150);
    await again.catchUp();
    expect(second.asked[0]![0], "it carries on from where it stopped").toBe(1_151);
    expect(again.of("7"), "a withdrawn consent is no longer listed").toEqual([]);
  });

  it("answers a pet's consents, and refuses anything but a pet number", async () => {
    const { client } = strictNode(1_050, [consent(V2, 7, W, true, 1_010)]);
    const index = createConsentIndex({ breeders: [V2], fromBlock: 1_000, client, paceMs: 0 });
    await index.catchUp();
    const app = withConsents(new Hono(), index);
    const r = await (await app.request("/api/consents/7")).json();
    expect(r).toEqual({ ok: true, petId: "7", indexedTo: 1_050, consents: [{ breeder: V2, partner: W, block: 1_010, tx: "0x3f20" }] });
    expect((await app.request("/api/consents/abc")).status).toBe(400);
    expect((await app.request("/api/consents/123456789012345678901")).status).toBe(400);
  });
});
