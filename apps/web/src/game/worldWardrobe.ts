/**
 * The world store's actions for the wardrobe: outfits and furniture made or bought, what each pet wears, and saved looks (P7: out of world.ts, which composes them).
 */
import {
  deleteLook as deleteLookRule,
  renameLook as renameLookRule,
  saveLook as saveLookRule,
  wearLook as wearLookRule,
  make as makeRule,
  buyPiece as buyPieceRule,
  wear as wearRule,
  giveLaurel as giveLaurelRule,
} from "@lingxi/world";
import { wearableOf } from "@lingxi/art";
import { useDesigns } from "./designs";
import { outfitOf } from "@lingxi/world";
import { play } from "./sound";
import { save, nextId } from "./worldCore";
import type { StoreApi } from "zustand";
import type { WorldStore } from "./world";

export function wardrobeActions(
  set: StoreApi<WorldStore>["setState"],
  get: () => WorldStore,
): Pick<
  WorldStore,
  "make" | "buyPiece" | "wear" | "saveLook" | "wearLook" | "renameLook" | "deleteLook" | "giveLaurel"
> {
  return {
    make: (kind, id) => {
      const r = makeRule(get().world, kind, id);
      if (!r.ok) {
        play("error");
        return set({ notice: { id: nextId(), kind: "fail", reason: r.reason } });
      }
      save(r.world);
      play("success");
      set({ world: r.world, notice: { id: nextId(), kind: kind === "outfit" ? "sewn" : "built", text: id } });
    },
    buyPiece: (id) => {
      const r = buyPieceRule(get().world, id);
      if (!r.ok) {
        play("error");
        return set({ notice: { id: nextId(), kind: "fail", reason: r.reason } });
      }
      save(r.world);
      play("pop");
      set({ world: r.world, notice: { id: nextId(), kind: "sewn", text: id } });
    },
    wear: (petKey, slot, id) => {
      // a player-made piece must be one this player may wear, in the slot it was drawn for
      if (id && /^(u|c2?):/.test(id) && (!useDesigns.getState().canWear(id) || wearableOf(id)?.slot !== slot)) return;
      const r = wearRule(get().world, petKey, slot, id);
      if (!r.ok) return set({ notice: { id: nextId(), kind: "fail", reason: r.reason } });
      save(r.world);
      play("pop");
      set({ world: r.world });
    },
    saveLook: (name, petKey) => {
      const r = saveLookRule(get().world, name, outfitOf(get().world, petKey));
      if (!r.ok) {
        play("error");
        return { ok: false, reason: r.reason };
      }
      save(r.world);
      play("success");
      set({ world: r.world });
      return { ok: true };
    },
    wearLook: (petKey, id) => {
      // a player-made piece goes on only when this player may wear it, in the slot it was drawn for
      const mayWear = (piece: string, slot: string) =>
        useDesigns.getState().canWear(piece) && wearableOf(piece)?.slot === slot;
      const r = wearLookRule(get().world, petKey, id, mayWear);
      if (!r.ok) {
        play("error");
        return { ok: false, reason: r.reason };
      }
      save(r.world);
      play("pop");
      set({ world: r.world });
      return { ok: true, missing: r.missing };
    },
    renameLook: (id, name) => {
      const r = renameLookRule(get().world, id, name);
      if (!r.ok) return false;
      save(r.world);
      set({ world: r.world });
      return true;
    },
    deleteLook: (id) => {
      const r = deleteLookRule(get().world, id);
      if (!r.ok) return false;
      save(r.world);
      play("tap");
      set({ world: r.world });
      return true;
    },
    giveLaurel: () => {
      const next = giveLaurelRule(get().world);
      if (next === get().world) return;
      save(next);
      set({ world: next, notice: { id: nextId(), kind: "sewn", text: "laurel" } });
    },
  };
}
