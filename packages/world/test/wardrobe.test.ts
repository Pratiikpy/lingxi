import { describe, expect, it } from "vitest";
import { CORNER_SHOP, DECOR_BY_ID, ITEM, MAKE_RECIPES, PIECES, buyPiece, giveLaurel, make, newWorld, outfitOf, ownedPieces, setOf, wear, type WorldState } from "../src";

const rich = (): WorldState => ({ ...newWorld("seedseedseedseed"), coins: 200, bag: { 1016: 9, 1001: 9, 1002: 9, 1003: 9, 1004: 9, 1005: 9, 1006: 9, 1007: 9, 1010: 9, 1011: 9, 1012: 9, 1013: 9, 1014: 9 } });
const ok = (r: { ok: true; world: WorldState } | { ok: false; reason: string }) => {
  if (!r.ok) throw new Error(r.reason);
  return r.world;
};

describe("the wardrobe", () => {
  it("every recipe uses real materials and makes a real piece or piece of furniture", () => {
    for (const r of MAKE_RECIPES) {
      for (const x of r.ins) expect(ITEM[x.item]).toBeTruthy();
      expect(r.kind === "outfit" ? PIECES[r.id] : DECOR_BY_ID[r.id]).toBeTruthy();
    }
    // every piece can be sewn, except the champion's laurel and the keepsakes the story quests give
    for (const [id, p] of Object.entries(PIECES)) if (id !== "laurel" && p.set !== "story" && p.set !== "lane") expect(MAKE_RECIPES.some((r) => r.id === id && r.kind === "outfit"), id).toBe(true);
    for (const [id, p] of Object.entries(PIECES)) if (p.set === "story" || p.set === "lane") expect(MAKE_RECIPES.some((r) => r.id === id), id).toBe(false);
  });

  it("sewing spends the materials once and the piece is owned; it cannot be sewn twice", () => {
    const w = ok(make(rich(), "outfit", "sunhat"));
    expect(ownedPieces(w)).toEqual(["sunhat"]);
    expect(w.bag[1016]).toBe(7);
    expect(make(w, "outfit", "sunhat")).toEqual({ ok: false, reason: "owned" });
    expect(make({ ...newWorld("x"), bag: {} }, "outfit", "bow")).toEqual({ ok: false, reason: "missing" });
  });

  it("building furniture adds it to the decorations to place at home", () => {
    const w = ok(make(rich(), "furniture", "books"));
    expect(w.decor?.owned).toContain("books");
  });

  it("the Corner Shop sells a few pieces, only there", () => {
    const at = { ...rich(), room: CORNER_SHOP };
    expect(ownedPieces(ok(buyPiece(at, "bow")))).toEqual(["bow"]);
    expect(buyPiece(rich(), "bow")).toEqual({ ok: false, reason: "notSold" });
    expect(buyPiece(at, "crown")).toEqual({ ok: false, reason: "notSold" });
    expect(buyPiece({ ...at, coins: 1 }, "bow")).toEqual({ ok: false, reason: "coins" });
  });

  it("each pet wears its own outfit; only owned pieces, only in their slot", () => {
    let w = ok(make(ok(make(ok(make(rich(), "outfit", "sunhat")), "outfit", "hearts")), "outfit", "balloon"));
    expect(wear(w, "pet1", "face", "sunhat")).toEqual({ ok: false, reason: "wrongSlot" });
    expect(wear(w, "pet1", "head", "crown")).toEqual({ ok: false, reason: "notOwned" });
    w = ok(wear(ok(wear(ok(wear(w, "pet1", "head", "sunhat")), "pet1", "face", "hearts")), "pet1", "held", "balloon"));
    expect(outfitOf(w, "pet1")).toEqual({ head: "sunhat", face: "hearts", held: "balloon" });
    expect(outfitOf(w, "pet2")).toEqual({});
    expect(setOf(outfitOf(w, "pet1"))).toBe("picnic");
    w = ok(wear(w, "pet1", "head", null));
    expect(outfitOf(w, "pet1").head).toBeUndefined();
    expect(setOf(outfitOf(w, "pet1"))).toBeNull();
  });

  it("player-made pieces from this device and from both markets pass to the game's own check", () => {
    // "u:" drawn here, "c:" the first (OKB) market, "c2:" the BEM market; the game checks ownership and slot
    for (const id of ["u:mwj3ia1l", "c:1", "c2:1", "c2:12345"]) {
      const r = ok(wear(rich(), "pet1", "head", id));
      expect(outfitOf(r, "pet1").head).toBe(id);
    }
    // anything else must still be a known piece
    for (const id of ["c3:1", "c2:", "x:1", "c2:../1"]) expect(wear(rich(), "pet1", "head", id)).toEqual({ ok: false, reason: "wrongSlot" });
  });

  it("the laurel comes only from a season win, once", () => {
    expect(make(rich(), "outfit", "laurel")).toEqual({ ok: false, reason: "noRecipe" });
    const w = giveLaurel(giveLaurel(rich()));
    expect(ownedPieces(w)).toEqual(["laurel"]);
  });
});
