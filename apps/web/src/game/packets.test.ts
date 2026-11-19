// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { type Abi, type Address, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { XLAYER_USDT, redPacketAbi } from "@lingxi/chain";
import xlayer from "../../../../packages/chain/deployments/xlayer.json";
import { leave, offline, reload, settle, visit } from "./testGame";
import { type FakeContract, Revert, fakeWallet, fakeXLayer } from "./testChain";

const T0 = Date.UTC(2026, 10, 20, 9, 0, 0);
const RED_PACKET = xlayer.redPacket as Address;
const SENDER = "0x1111111111111111111111111111111111111111" as Address;
const PENDING = "lingxi.packets.pending.v1";
const SENT = "lingxi.packets.sent.v1";
const lower = (a: string) => a.toLowerCase();

interface Packet {
  sender: Address;
  key: Address;
  total: bigint;
  count: number;
  expiry: bigint;
}

/** The red packet contract and USDT as the game uses them, with the state a test sets; each refuses as deployed. */
function contracts() {
  const packets = new Map<bigint, Packet>();
  const held = new Map<string, bigint>([[lower(SENDER), 100_000_000n]]);
  // a sender who has sent a packet before: the contract may already spend its USDT, so only the packet is sent
  const allowances = new Map<string, bigint>([[`${lower(SENDER)}:${lower(RED_PACKET)}`, 10n ** 30n]]);
  const rules = { revertCreate: false };
  let nextId = 7n;
  const redPacket: FakeContract = {
    abi: redPacketAbi as Abi,
    calls: {
      nextId: () => nextId,
      create: ([, total, count, , lifetime, key, lucky, petOwnersOnly], c) => {
        if (rules.revertCreate) throw new Revert("TooSmall");
        const id = nextId;
        if (!c.dry) {
          const expiry = BigInt(c.now) + (lifetime as bigint);
          packets.set(id, { sender: c.from, key: key as Address, total: total as bigint, count: count as number, expiry });
          held.set(lower(c.from), (held.get(lower(c.from)) ?? 0n) - (total as bigint));
          nextId++;
          c.emit("Created", { id, sender: c.from, token: XLAYER_USDT, total, count, lucky, petOwnersOnly, expiry });
        }
        return id;
      },
      packet: ([id]) => {
        const p = packets.get(id as bigint);
        if (!p) throw new Revert("Unknown");
        return { sender: p.sender, expiry: p.expiry, count: p.count, claimed: 0, paid: 0, lucky: true, petOwnersOnly: false, token: XLAYER_USDT, key: p.key, remaining: p.total, floor: 0n, extra: 0n };
      },
    },
  };
  const usdt: FakeContract = {
    abi: erc20Abi as Abi,
    calls: {
      balanceOf: ([who]) => held.get(lower(who as string)) ?? 0n,
      allowance: ([who, spender]) => allowances.get(`${lower(who as string)}:${lower(spender as string)}`) ?? 0n,
      approve: ([spender, amount], c) => {
        if (!c.dry) allowances.set(`${lower(c.from)}:${lower(spender as string)}`, amount as bigint);
        return true;
      },
    },
  };
  return { packets, rules, contracts: { [RED_PACKET]: redPacket, [XLAYER_USDT]: usdt }, made: (id: bigint) => (nextId = id + 1n) };
}

async function open(o: { storage?: Parameters<typeof reload>[0]; chain?: ReturnType<typeof contracts>; xl?: ReturnType<typeof fakeXLayer> } = {}) {
  const x = o.chain ?? contracts();
  const xl = o.xl ?? fakeXLayer({ contracts: x.contracts, balances: { [SENDER]: 10n ** 18n } });
  const v = o.storage ? await reload(o.storage, { at: T0, net: xl.fetchVia(offline) }) : await visit({ at: T0, net: xl.fetchVia(offline) });
  const wallet = fakeWallet(xl, { account: SENDER });
  Object.defineProperty(window, "ethereum", { value: wallet, configurable: true });
  const { usePackets } = await import("./packets");
  const s = () => usePackets.getState();
  return { ...v, x, xl, wallet, s };
}

const order = { amount: "3", count: 3, lucky: true, petOwnersOnly: false, days: 1, from: { name: "Kiri", line: "gentle" as const }, letter: "Happy new year", origin: "https://lingxi.knole.me/play.html#" };
const keyIn = (link: string) => {
  const code = link.slice(link.indexOf("packet=") + "packet=".length);
  return JSON.parse(atob(code.slice(5).replace(/-/g, "+").replace(/_/g, "/"))) as { id: string; key: string };
};

afterEach(() => leave());

describe("a red packet's link key is kept before its money is sent (A42)", () => {
  it("a packet whose receipt does not come in time keeps its key, says so, and its link appears once X Layer tells of it", async () => {
    const p = await open();
    p.xl.node.holdReceipts = true;
    const link = await settle(p.s().send(order), 1_000, 400);
    expect(link).toBeNull();
    expect(p.s().error).toBe("packetPending");
    expect(p.s().pending).toHaveLength(1);
    const kept = JSON.parse(p.storage.getItem(PENDING)!) as Array<{ key: string; tx?: string }>;
    expect(kept[0]!.tx, "the transaction it was sent in is kept with the key").toMatch(/^0x[0-9a-f]{64}$/);
    expect(p.x.packets.size, "the money did reach the contract").toBe(1);

    // the node still has not told of its receipt, but the packet is on X Layer: it is found by its key, and nothing is
    // sent again
    await settle(p.s().recover());
    expect(p.s().pending).toHaveLength(0);
    expect(p.s().sent).toHaveLength(1);
    const found = keyIn(p.s().sent[0]!.link);
    expect(found.id).toBe("7");
    expect(privateKeyToAccount(`0x${found.key}`).address, "the link carries the key the packet was made with").toBe(p.x.packets.get(7n)!.key);
    expect(p.xl.mined.filter((m) => m.functionName === "create"), "and nothing was sent twice").toHaveLength(1);
  });

  it("a tab closed while the packet was being confirmed finds it on the next visit, with its link and letter", async () => {
    const first = await open();
    first.xl.node.holdReceipts = true;
    void first.s().send(order);
    await settle(new Promise((r) => setTimeout(r, 3_000)), 250, 20);
    expect(first.x.packets.size).toBe(1);
    // the tab closes before the receipt; the next visit reads only what storage kept
    first.xl.node.holdReceipts = false;
    const next = await open({ storage: first.storage, chain: first.x, xl: first.xl });
    await settle(next.s().recover());
    expect(next.s().sent).toHaveLength(1);
    expect(next.s().sent[0]).toMatchObject({ id: "7", total: "3", count: 3 });
    expect(next.s().sent[0]!.link).toContain("https://lingxi.knole.me/play.html#packet=lxp1.");
    expect(JSON.parse(next.storage.getItem(SENT)!)).toHaveLength(1);
    expect(next.s().pending).toHaveLength(0);
  });

  it("a key kept before its transaction was known is matched to its packet by the key itself", async () => {
    const p = await open();
    // the page closed after the wallet sent the packet and before it said which transaction: only the key was kept
    const pk = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
    const keyAddress = privateKeyToAccount(pk).address;
    p.storage.setItem(PENDING, JSON.stringify([{ key: pk.slice(2), keyAddress, fromId: "7", sender: SENDER, total: "5", count: 2, from: order.from, letter: "", origin: order.origin, at: T0 }]));
    p.x.packets.set(7n, { sender: SENDER, key: "0x9999999999999999999999999999999999999999", total: 1n, count: 1, expiry: 0n });
    p.x.packets.set(8n, { sender: SENDER, key: keyAddress, total: 5_000_000n, count: 2, expiry: 0n });
    p.x.made(8n);
    const again = await open({ storage: p.storage, chain: p.x, xl: p.xl });
    await settle(again.s().recover());
    expect(again.s().sent.map((x) => x.id)).toEqual(["8"]);
    expect(keyIn(again.s().sent[0]!.link).key).toBe(pk.slice(2));
  });

  it("a packet the wallet refused keeps no key and says it did not go through", async () => {
    const p = await open();
    p.wallet.approves = false;
    expect(await settle(p.s().send(order))).toBeNull();
    expect(p.s().pending).toHaveLength(0);
    expect(p.storage.getItem(PENDING) ?? "[]").toBe("[]");
    expect(p.s().error).toMatch(/rejected/i);
    expect(p.x.packets.size).toBe(0);
  });

  it("a packet refused on chain while it was waiting lets its key go, and says its money stayed", async () => {
    const p = await open();
    p.x.rules.revertCreate = true;
    // the simulation passes, the mined transaction is refused
    const sim = p.x.contracts[RED_PACKET]!.calls.create!;
    p.x.contracts[RED_PACKET]!.calls.create = (args, c) => (c.dry ? 7n : sim(args, c));
    p.xl.node.holdReceipts = true;
    await settle(p.s().send(order), 1_000, 400);
    expect(p.s().pending).toHaveLength(1);
    p.xl.node.holdReceipts = false;
    await settle(p.s().recover());
    expect(p.s().pending).toHaveLength(0);
    expect(p.s().sent).toHaveLength(0);
    expect(p.s().error).toBe("packetFailed");
  });
});
