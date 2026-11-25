/**
 * The world store's actions for the home: the garden's plots and compost, and the decorations bought, commissioned and placed (P7: out of world.ts, which composes them).
 */
import {
  buyDecor as buyDecorRule,
  commissionDecor as commissionDecorRule,
  digPlot as digPlotRule,
  placeDecor as placeDecorRule,
  removeDecor as removeDecorRule,
  COMPOST,
  compostFromClean,
  harvest as harvestRule,
  plant as plantRule,
} from "@lingxi/world";
import { stageOf } from "@lingxi/game";
import { useGame } from "./store";
import { play } from "./sound";
import { now } from "./gameClock";
import { save, nextId } from "./worldCore";
import type { StoreApi } from "zustand";
import type { WorldStore } from "./world";

export function homeActions(
  set: StoreApi<WorldStore>["setState"],
  get: () => WorldStore,
): Pick<
  WorldStore,
  "plant" | "harvest" | "compost" | "digPlot" | "buyDecor" | "commission" | "placeDecor" | "removeDecor"
> {
  return {
    plant: (plot, crop, withCompost) => {
      const r = plantRule(get().world, plot, crop, withCompost, now());
      if (!r.ok) {
        play("error");
        return set({ notice: { id: nextId(), kind: "fail", reason: r.reason } });
      }
      save(r.world);
      play("pop");
      set({ world: r.world, notice: { id: nextId(), kind: "planted" } });
    },
    harvest: (plot) => {
      const r = harvestRule(get().world, plot, now());
      if (!r.ok) {
        play("error");
        return set({ notice: { id: nextId(), kind: "fail", reason: r.reason } });
      }
      save(r.world);
      set({ world: r.world, notice: { id: nextId(), kind: "harvested", items: [{ item: r.item, n: r.n }] } });
    },
    compost: (cleanBefore) => {
      const r = compostFromClean(get().world, cleanBefore);
      if (!r.made) return;
      save(r.world);
      set({ world: r.world, notice: { id: nextId(), kind: "compost", items: [{ item: COMPOST, n: 1 }] } });
    },
    digPlot: () => {
      const p = useGame.getState().pet;
      const r = digPlotRule(get().world, p ? stageOf(p, now()) : "baby");
      if (!r.ok) {
        play("error");
        set({ notice: { id: nextId(), kind: "fail", reason: r.reason } });
        return false;
      }
      save(r.world);
      play("success");
      set({ world: r.world });
      return true;
    },
    buyDecor: (id) => {
      const r = buyDecorRule(get().world, id);
      if (!r.ok) {
        play("error");
        set({ notice: { id: nextId(), kind: "fail", reason: r.reason } });
        return false;
      }
      save(r.world);
      play("success");
      set({ world: r.world });
      return true;
    },
    commission: (id) => {
      const p = useGame.getState().pet;
      const r = commissionDecorRule(get().world, id, p ? stageOf(p, now()) : "baby");
      if (!r.ok) {
        play("error");
        set({ notice: { id: nextId(), kind: "fail", reason: r.reason } });
        return false;
      }
      save(r.world);
      play("success");
      set({ world: r.world, notice: { id: nextId(), kind: "built", text: id } });
      return true;
    },
    placeDecor: (id, x, y) => {
      const r = placeDecorRule(get().world, id, x, y);
      if (!r.ok) {
        play("error");
        set({ notice: { id: nextId(), kind: "fail", reason: r.reason } });
        return false;
      }
      save(r.world);
      play("pop");
      set({ world: r.world });
      return true;
    },
    removeDecor: (id) => {
      const r = removeDecorRule(get().world, id);
      if (!r.ok) return;
      save(r.world);
      play("tap");
      set({ world: r.world });
    },
  };
}
