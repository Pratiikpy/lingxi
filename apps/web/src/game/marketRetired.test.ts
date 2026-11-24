/**
 * A23: the game never shows or buys an OKB-market (V1) listing that a sale retired. The server's watch says which; the
 * game shows a V1 listing only when it can say, and otherwise only the player's own, so they can still cancel it.
 */
import { describe, expect, it } from "vitest";
import type { OutfitListing } from "@lingxi/chain";
import { retiredOkbListings, shownListings } from "./marketRetired";

const ME = "0x00000000000000000000000000000000000000a1";
const SELLER = "0x00000000000000000000000000000000000000b2";
const listing = (market: 1 | 2, id: number, seller = SELLER): OutfitListing =>
  ({
    market,
    id: BigInt(id),
    seller,
    design: 5n,
    quantity: 1,
    priceEach: 10n,
    expiresAt: null,
    buyer: null,
  }) as OutfitListing;
const answer = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe("OKB-market listings a sale retired (A23)", () => {
  it("are hidden; the others, and every BEM-market listing, are shown", () => {
    const all = [listing(1, 1), listing(1, 2), listing(2, 1)];
    expect(shownListings(all, new Set(["1"]), ME).map((l) => `${l.market}:${l.id}`)).toEqual(["1:2", "2:1"]);
  });

  it("when the server cannot say, only the player's own OKB listings are shown, to cancel", () => {
    const all = [listing(1, 1), listing(1, 2, ME), listing(2, 1)];
    expect(shownListings(all, null, ME).map((l) => `${l.market}:${l.id}`)).toEqual(["1:2", "2:1"]);
    expect(shownListings(all, null, null).map((l) => `${l.market}:${l.id}`)).toEqual(["2:1"]);
  });

  it("the server's answer counts only when its watch has caught up", async () => {
    expect(await retiredOkbListings(answer({ ready: true, retired: ["3"] }))).toEqual(new Set(["3"]));
    expect(await retiredOkbListings(answer({ ready: false, retired: [] }))).toBeNull();
    expect(await retiredOkbListings(answer({}, false))).toBeNull();
    expect(
      await retiredOkbListings((async () =>
        Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch),
    ).toBeNull();
    expect(await retiredOkbListings(answer({ ready: true, retired: "nonsense" }))).toBeNull();
  });
});
