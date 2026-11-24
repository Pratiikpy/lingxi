import { describe, expect, it } from "vitest";
import { CHAIN_DECOR, DECOR, type WorldState, buyDecor, newWorld, placeDecor, wear } from "@lingxi/world";
import { cleanWorld } from "./saveClean";
import live from "./fixtures/world-save-4.8.json";

const ok = (r: { ok: true; world: WorldState } | { ok: false; reason: string }): WorldState => {
  if (!r.ok) throw new Error(r.reason);
  return r.world;
};
/** A JSON round trip, as storage does it. */
const stored = (w: WorldState): WorldState => JSON.parse(JSON.stringify(w)) as WorldState;

/** A save from before the paid extras with a bit of everything: decorations, outfits, quests, counters, a garden. */
function richOldSave(): WorldState {
  let w: WorldState = { ...newWorld("0123456789abcdef"), coins: 5000 };
  for (const d of DECOR.filter((p) => !p.gift).slice(0, 12))
    w = ok(placeDecor(ok(buyDecor(w, d.id)), d.id, 30 + (d.id.length % 50), 90));
  w = { ...w, wardrobe: { owned: ["sunhat", "glasses", "balloon"], worn: {} } };
  w = ok(wear(ok(wear(w, "1790000000000", "head", "sunhat")), "1790000000000", "face", "glasses"));
  return stored({
    ...w,
    claimed: ["q01", "q02", "q07"],
    tally: { "FEED:0": 31, "MOVE:65": 4 },
    flags: ["tools-given", "met-praline"],
    buffs: { forageExtra: 2 },
    familiar: { 65: 7 },
    garden: { plots: [{ crop: "mushroom", at: 1790000000000, compost: false }, null], harvested: 3 },
    trust: { praline: 40 },
  });
}

describe("old saves load with nothing lost (plan 4.9)", () => {
  it("a real save taken from the live game before the extras loads exactly as it was", () => {
    const w = live as unknown as WorldState;
    expect(w.version).toBe(1);
    const clean = cleanWorld(stored(w));
    // the one change, and it predates the extras: a save without flags gets an empty list of them
    expect(clean).toEqual({ ...w, flags: w.flags ?? [] });
    expect("extras" in clean || "looks" in clean || "looksMade" in clean).toBe(false);
  });

  it("a full older save keeps every piece, outfit, quest, counter and plot", () => {
    const w = richOldSave();
    const clean = cleanWorld(stored(w));
    expect(clean).toEqual(w);
    expect(clean.decor?.placed).toHaveLength(12);
    expect(clean.wardrobe?.worn["1790000000000"]).toEqual({ head: "sunhat", face: "glasses" });
  });

  it("a save made after the extras keeps its looks and its last reading of the packs", () => {
    const w = stored({
      ...richOldSave(),
      extras: { room: 2, looks: 1 },
      looks: [
        { id: "l1", name: "Picnic", outfit: { head: "sunhat" } },
        { id: "l4", name: "Mine", outfit: { head: "c2:7" } },
      ],
      looksMade: 4,
    });
    expect(cleanWorld(w)).toEqual(w);
  });
});

describe("an edited save cannot give itself what it never had (plan 4.9)", () => {
  it("packs beyond the contract's limit, negative or not whole, are clamped", () => {
    const w = stored({ ...richOldSave(), extras: { room: 99, looks: -1 } });
    expect(cleanWorld(w).extras).toEqual({ room: 3, looks: 0 });
    expect(cleanWorld(stored({ ...richOldSave(), extras: { room: 1.5, looks: "2" } as never })).extras).toEqual({
      room: 0,
      looks: 0,
    });
  });

  it("a room is cut to the space its packs give, and on-chain pieces are never owned by the game", () => {
    const base = richOldSave();
    const placed = [...base.decor!.placed, ...DECOR.filter((p) => p.gift).map((p) => ({ id: p.id, x: 50, y: 90 }))];
    const owned = [...base.decor!.owned, ...DECOR.filter((p) => p.gift).map((p) => p.id), "star-lamp"];
    const w = stored({ ...base, decor: { owned, placed: [...placed, { id: "star-lamp", x: 40, y: 80 }] } });
    const clean = cleanWorld(w);
    expect(clean.decor!.placed).toHaveLength(12);
    expect(clean.decor!.owned).not.toContain("star-lamp");
    const roomy = cleanWorld(stored({ ...w, extras: { room: 1, looks: 0 } }));
    expect(roomy.decor!.placed).toHaveLength(16);
    expect(roomy.decor!.placed.map((p) => p.id)).not.toContain(CHAIN_DECOR[0]!.id);
  });

  it("looks with bad ids, empty names or no pieces are dropped, names are cleaned, and ids never repeat", () => {
    const w = stored({
      ...richOldSave(),
      looks: [
        { id: "l2", name: "  <i>Party</i>  ", outfit: { head: "sunhat", face: 7, held: "bad id!" } },
        { id: "l2", name: "Twin", outfit: { head: "crown" } },
        { id: "x9", name: "Bad id", outfit: { head: "crown" } },
        { id: "l3", name: "   ", outfit: { head: "crown" } },
        { id: "l5", name: "Bare", outfit: {} },
        ...Array.from({ length: 20 }, (_, i) => ({ id: `l${100 + i}`, name: `L${i}`, outfit: { head: "sunhat" } })),
      ] as never,
      looksMade: 1,
    });
    const clean = cleanWorld(w);
    expect(clean.looks![0]).toEqual({ id: "l2", name: "iParty/i", outfit: { head: "sunhat" } });
    expect(clean.looks!.map((l) => l.id)).not.toContain("x9");
    expect(clean.looks!.length).toBe(12);
    expect(clean.looksMade).toBe(110);
  });

  it("the wardrobe keeps only real limited pieces as held on chain, and never as owned", () => {
    const w = stored({
      ...richOldSave(),
      wardrobe: { owned: ["sunhat", "nand-crown"], worn: {}, chainHeld: ["probe-visor", "sunhat", "nope"] },
    });
    expect(cleanWorld(w).wardrobe).toEqual({ owned: ["sunhat"], worn: {}, chainHeld: ["probe-visor"] });
  });
});
