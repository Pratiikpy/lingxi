import { describe, expect, it } from "vitest";
import {
  CHAIN_WEAR,
  DECOR,
  LOOKS_BASE,
  MAX_PLACED,
  NAME_COLOURS,
  PIECES,
  ROOM_MAX,
  type WorldState,
  buyDecor,
  decorOf,
  deleteLook,
  extrasOf,
  lookLimit,
  newWorld,
  outfitOf,
  placeDecor,
  renameLook,
  roomCapacity,
  saveLook,
  savedLooks,
  syncChainWear,
  syncExtras,
  wear,
  wearLook,
} from "../src";

const ok = (r: { ok: true; world: WorldState } | { ok: false; reason: string }): WorldState => {
  if (!r.ok) throw new Error(r.reason);
  return r.world;
};
/** a world that owns every coin-bought decoration and every quest keepsake, as a player who finished the story does */
function furnished(): WorldState {
  let w: WorldState = { ...newWorld("x"), coins: 100_000 };
  for (const d of DECOR.filter((p) => !p.gift && !p.commission)) w = ok(buyDecor(w, d.id));
  return {
    ...w,
    decor: { ...decorOf(w), owned: [...decorOf(w).owned, ...DECOR.filter((p) => p.gift).map((p) => p.id)] },
  };
}
// the shelf's pieces: the Builder's commissions (G6) are made to order, not bought
const sold = DECOR.filter((d) => !d.commission);

describe("room space (plan 4.9)", () => {
  it("a home holds 12 pieces free, 4 more per pack, at most three packs", () => {
    const w = newWorld("r");
    expect(roomCapacity(w)).toBe(MAX_PLACED);
    expect(MAX_PLACED).toBe(12);
    expect(roomCapacity(syncExtras(w, { room: 1, looks: 0 }))).toBe(16);
    expect(roomCapacity(syncExtras(w, { room: 3, looks: 0 }))).toBe(24);
    expect(ROOM_MAX).toBe(24);
    // a reading above the contract's limit, negative or not whole is clamped, never trusted
    expect(roomCapacity(syncExtras(w, { room: 9, looks: 0 }))).toBe(24);
    expect(extrasOf(syncExtras(w, { room: -2, looks: 1.5 }))).toEqual({ room: 0, looks: 0 });
  });

  it("the extra space is real: the 13th piece needs a pack", () => {
    expect(sold.length).toBeGreaterThan(16);
    let w = furnished();
    for (const d of sold.slice(0, 12)) w = ok(placeDecor(w, d.id, 40, 80));
    expect(placeDecor(w, sold[12]!.id, 40, 80)).toEqual({ ok: false, reason: "full" });
    // moving a piece already out is never refused
    expect(placeDecor(w, sold[0]!.id, 70, 90).ok).toBe(true);
    w = syncExtras(w, { room: 1, looks: 0 });
    for (const d of sold.slice(12, 16)) w = ok(placeDecor(w, d.id, 40, 80));
    expect(decorOf(w).placed).toHaveLength(16);
    expect(placeDecor(w, sold[16]!.id, 40, 80)).toEqual({ ok: false, reason: "full" });
  });

  it("losing space puts the newest pieces away, owned and ready to place again, never lost", () => {
    let w = syncExtras(furnished(), { room: 1, looks: 0 });
    for (const d of sold.slice(0, 16)) w = ok(placeDecor(w, d.id, 40, 80));
    const less = syncExtras(w, { room: 0, looks: 0 });
    expect(decorOf(less).placed.map((p) => p.id)).toEqual(sold.slice(0, 12).map((d) => d.id));
    expect(decorOf(less).owned).toEqual(decorOf(w).owned);
    // the same reading twice changes nothing
    expect(syncExtras(less, { room: 0, looks: 0 })).toBe(less);
  });
});

describe("saved looks (plan 4.9)", () => {
  const dressed = (): WorldState => {
    let w: WorldState = { ...newWorld("l"), wardrobe: { owned: ["sunhat", "glasses", "balloon", "crown"], worn: {} } };
    w = ok(wear(w, "p1", "head", "sunhat"));
    w = ok(wear(w, "p1", "face", "glasses"));
    return ok(wear(w, "p1", "held", "balloon"));
  };

  it("keeps a whole outfit under a name and puts it on in one go", () => {
    let w = ok(saveLook(dressed(), "Picnic day", outfitOf(dressed(), "p1")));
    expect(savedLooks(w)).toEqual([
      { id: "l1", name: "Picnic day", outfit: { head: "sunhat", face: "glasses", held: "balloon" } },
    ]);
    w = ok(wear(w, "p1", "head", "crown"));
    w = ok(wear(w, "p1", "held", null));
    const r = wearLook(w, "p1", "l1");
    if (!r.ok) throw new Error(r.reason);
    expect(outfitOf(r.world, "p1")).toEqual({ head: "sunhat", face: "glasses", held: "balloon" });
    expect(r.missing).toEqual([]);
    // another pet can wear the same look
    const other = wearLook(r.world, "p2", "l1");
    expect(other.ok && outfitOf(other.world, "p2")).toEqual({ head: "sunhat", face: "glasses", held: "balloon" });
  });

  it("a look sets exactly its outfit: slots it leaves empty are taken off", () => {
    let w = dressed();
    w = ok(saveLook(w, "Just a hat", { head: "crown" }));
    const r = wearLook(w, "p1", "l1");
    expect(r.ok && outfitOf(r.world, "p1")).toEqual({ head: "crown" });
  });

  it("a piece no longer held is skipped and named, the rest goes on", () => {
    let w = ok(saveLook(dressed(), "Picnic", outfitOf(dressed(), "p1")));
    w = { ...w, wardrobe: { ...w.wardrobe!, owned: ["sunhat", "glasses"] } };
    const r = wearLook(w, "p2", "l1");
    if (!r.ok) throw new Error(r.reason);
    expect(outfitOf(r.world, "p2")).toEqual({ head: "sunhat", face: "glasses" });
    expect(r.missing).toEqual(["balloon"]);
  });

  it("player-made pieces go on only when the game says this player may wear them", () => {
    let w = ok(saveLook(dressed(), "Mine", { head: "c2:7", face: "glasses" }));
    const no = wearLook(w, "p1", "l1");
    expect(no.ok && no.missing).toEqual(["c2:7"]);
    const yes = wearLook(w, "p1", "l1", (id) => id === "c2:7");
    expect(yes.ok && outfitOf(yes.world, "p1")).toEqual({ head: "c2:7", face: "glasses" });
    w = yes.ok ? yes.world : w;
  });

  it("three looks are free, three more per pack, at most twelve", () => {
    expect(LOOKS_BASE).toBe(3);
    let w = dressed();
    const fits: Array<{ head: string }> = [{ head: "sunhat" }, { head: "crown" }, { head: "c:1" }, { head: "c:2" }];
    for (let i = 0; i < 3; i++) w = ok(saveLook(w, `Look ${i + 1}`, fits[i]!));
    expect(saveLook(w, "Look 4", fits[3]!)).toEqual({ ok: false, reason: "full" });
    w = syncExtras(w, { room: 0, looks: 1 });
    expect(lookLimit(w)).toBe(6);
    expect(saveLook(w, "Look 4", fits[3]!).ok).toBe(true);
    expect(lookLimit(syncExtras(w, { room: 0, looks: 3 }))).toBe(12);
  });

  it("looks over a lost limit are kept, but locked until space returns or one is deleted", () => {
    let w = syncExtras(dressed(), { room: 0, looks: 1 });
    for (const [i, head] of ["sunhat", "crown", "c:1", "c:2"].entries()) w = ok(saveLook(w, `L${i}`, { head }));
    w = syncExtras(w, { room: 0, looks: 0 });
    expect(savedLooks(w)).toHaveLength(4);
    expect(wearLook(w, "p1", "l4")).toEqual({ ok: false, reason: "locked" });
    expect(wearLook(w, "p1", "l3").ok).toBe(true);
    expect(saveLook(w, "L5", { head: "sunhat", face: "glasses" })).toEqual({ ok: false, reason: "full" });
    w = ok(deleteLook(w, "l1"));
    expect(savedLooks(w).map((l) => l.id)).toEqual(["l2", "l3", "l4"]);
    expect(wearLook(w, "p1", "l4").ok).toBe(true);
  });

  it("names are cleaned and kept short; empty outfits, empty names, twins and unknown looks are refused", () => {
    const w = dressed();
    expect(saveLook(w, "  <b>Party</b>\u0007 time is now here  ", { head: "sunhat" })).toMatchObject({ ok: true });
    const named = ok(saveLook(w, "  <b>Party</b>\u0007 time is now here  ", { head: "sunhat" }));
    expect(savedLooks(named)[0]!.name).toBe("bParty/b time is");
    expect(saveLook(w, "Bare", {})).toEqual({ ok: false, reason: "empty" });
    expect(saveLook(w, "   ", { head: "sunhat" })).toEqual({ ok: false, reason: "name" });
    expect(saveLook(named, "Again", { head: "sunhat" })).toEqual({ ok: false, reason: "same" });
    expect(saveLook(w, "Odd", { head: "glasses" })).toEqual({ ok: false, reason: "wrongSlot" });
    expect(renameLook(named, "l9", "x")).toEqual({ ok: false, reason: "unknown" });
    expect(deleteLook(named, "l9")).toEqual({ ok: false, reason: "unknown" });
    expect(wearLook(named, "p1", "l9")).toEqual({ ok: false, reason: "unknown" });
    expect(savedLooks(ok(renameLook(named, "l1", "Picnic"))).map((l) => l.name)).toEqual(["Picnic"]);
    expect(renameLook(named, "l1", "")).toEqual({ ok: false, reason: "name" });
  });

  it("ids never repeat, even after a delete", () => {
    let w = ok(saveLook(dressed(), "A", { head: "sunhat" }));
    w = ok(deleteLook(w, "l1"));
    w = ok(saveLook(w, "B", { head: "crown" }));
    expect(savedLooks(w).map((l) => l.id)).toEqual(["l2"]);
  });
});

describe("limited outfits on X Layer (plan 4.9)", () => {
  it("three pieces, one per slot, a full set of their own, never sewn or sold for coins", () => {
    expect(CHAIN_WEAR).toHaveLength(3);
    expect(new Set(CHAIN_WEAR.map((p) => PIECES[p.id]!.slot))).toEqual(new Set(["head", "face", "held"]));
    for (const p of CHAIN_WEAR) {
      expect(PIECES[p.id]!.set).toBe("drop");
      expect(p.supply).toBeGreaterThan(0);
    }
  });

  it("can be worn only while a wallet holds them, and come off when sold", () => {
    const [hat] = CHAIN_WEAR;
    let w = newWorld("d");
    expect(wear(w, "p1", PIECES[hat!.id]!.slot, hat!.id)).toEqual({ ok: false, reason: "notOwned" });
    w = syncChainWear(w, [hat!.id, "star-lamp", "nope"]);
    expect(w.wardrobe?.chainHeld).toEqual([hat!.id]);
    w = ok(wear(w, "p1", PIECES[hat!.id]!.slot, hat!.id));
    w = ok(wear(w, "p2", PIECES[hat!.id]!.slot, hat!.id));
    const gone = syncChainWear(w, []);
    expect(outfitOf(gone, "p1")).toEqual({});
    expect(outfitOf(gone, "p2")).toEqual({});
    expect(syncChainWear(gone, [])).toBe(gone);
  });
});

describe("name colours (plan 4.9)", () => {
  it("eight colours, numbered 1 to 8 as on chain, each named in both languages", () => {
    expect(NAME_COLOURS.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const c of NAME_COLOURS) {
      expect(c.name.en.length * c.name.zh.length).toBeGreaterThan(0);
      expect(c.light).toMatch(/^#[0-9A-F]{6}$/i);
      expect(c.dark).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("every colour reads clearly on the game's light and dark backgrounds (contrast at least 4.5:1)", () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const contrast = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x! + 0.05) / (y! + 0.05);
    };
    // every surface a name sits on: page, card, tint and band, light (tokens.css :root) and dark
    for (const c of NAME_COLOURS) {
      for (const bg of ["#FFF7E8", "#FFFDF8", "#EDE4FA", "#FFE3EA"])
        expect(contrast(c.light, bg), `${c.name.en} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      for (const bg of ["#1B1630", "#231C3D", "#33295A", "#2A2147"])
        expect(contrast(c.dark, bg), `${c.name.en} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
