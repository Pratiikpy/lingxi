/**
 * A34: where today's challenge block comes from. With the live server, from it, same origin, and checked on mainnet
 * with two reads through the server's door; without a server (the on-chain copy), from the public nodes as before.
 */
import { describe, expect, it, vi } from "vitest";
import { DAY_MS } from "@lingxi/game";
import { type DailyBlock, findBlock } from "./daily";

const DAY = 20_411;
const MIDNIGHT = (DAY * DAY_MS) / 1000;
const HASH = `0x${"ab".repeat(32)}`;
/** A chain where block 1000 is the first at or after the day's midnight. */
const chainBlock = async (n: number) => ({ timestamp: MIDNIGHT + (n - 1000) * 2, hash: n === 1000 ? HASH : `0x${n.toString(16).padStart(64, "0")}` });
const searched: DailyBlock = { day: DAY, block: 999_999, hash: `0x${"cd".repeat(32)}` };

describe("today's challenge block (A34)", () => {
  it("comes from the server, checked through its door, and no public node is searched", async () => {
    const search = vi.fn(async () => searched);
    const check = vi.fn(chainBlock);
    const got = await findBlock(DAY, { server: async () => ({ ok: true, day: DAY, block: 1000, hash: HASH }), check, search });
    expect(got).toEqual({ day: DAY, block: 1000, hash: HASH });
    expect(search).not.toHaveBeenCalled();
    expect(check.mock.calls.map((c) => c[0]).sort((x, y) => x - y)).toEqual([999, 1000]);
  });

  it("refuses a server answer the chain does not bear out", async () => {
    const search = vi.fn(async () => searched);
    // another block's hash
    await expect(findBlock(DAY, { server: async () => ({ ok: true, day: DAY, block: 1000, hash: `0x${"ee".repeat(32)}` }), check: chainBlock, search })).rejects.toThrow();
    // a block after the first of the day
    await expect(findBlock(DAY, { server: async () => ({ ok: true, day: DAY, block: 1001, hash: (await chainBlock(1001)).hash }), check: chainBlock, search })).rejects.toThrow();
    // a block before midnight
    await expect(findBlock(DAY, { server: async () => ({ ok: true, day: DAY, block: 999, hash: (await chainBlock(999)).hash }), check: chainBlock, search })).rejects.toThrow();
    // for another day
    await expect(findBlock(DAY, { server: async () => ({ ok: true, day: DAY - 1, block: 1000, hash: HASH }), check: chainBlock, search })).rejects.toThrow();
    // the check cannot be made
    await expect(findBlock(DAY, { server: async () => ({ ok: true, day: DAY, block: 1000, hash: HASH }), check: async () => Promise.reject(new Error("down")), search })).rejects.toThrow();
    expect(search, "a doubtful answer never sends the browser to the public nodes").not.toHaveBeenCalled();
  });

  it("says not yet, or try again, when the server has no block, without searching the public nodes", async () => {
    const search = vi.fn(async () => searched);
    await expect(findBlock(DAY, { server: async () => ({ ok: false, reason: "notYet" }), check: chainBlock, search })).rejects.toThrow("notYet");
    await expect(findBlock(DAY, { server: async () => ({ ok: false, reason: "unavailable" }), check: chainBlock, search })).rejects.toThrow("unavailable");
    await expect(findBlock(DAY, { server: async () => Promise.reject(new TypeError("Failed to fetch")), check: chainBlock, search })).rejects.toThrow();
    expect(search).not.toHaveBeenCalled();
  });

  it("takes the server's answer as it is where mainnet cannot be read through the door (a test build on a fork)", async () => {
    expect(await findBlock(DAY, { server: async () => ({ ok: true, day: DAY, block: 1000, hash: HASH }), check: null, search: async () => searched })).toEqual({ day: DAY, block: 1000, hash: HASH });
  });

  it("searches the public nodes when there is no server (the on-chain copy)", async () => {
    expect(await findBlock(DAY, { server: null, check: null, search: async () => searched })).toEqual(searched);
  });
});
