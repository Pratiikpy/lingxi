/**
 * The world store's actions for outings and coins: walks and trips, rewards, gifts paid for, spars paid for, and claims (P7: out of world.ts, which composes them).
 */
import {
  payReward as payRewardRule,
  startWalk as startWalkRule,
  stepWalk as stepWalkRule,
  endWalk as endWalkRule,
  startTrip as startTripRule,
  endTrip as endTripRule,
} from "@lingxi/world";
import { stageOf } from "@lingxi/game";
import { claim as claimQuest, earn, paySpar as paySparWin } from "@lingxi/world";
import { useChain } from "./chain";
import { useGame } from "./store";
import { play } from "./sound";
import { now } from "./gameClock";
import { save, nextId, petMods } from "./worldCore";
import type { StoreApi } from "zustand";
import type { WorldStore } from "./world";

export function outingsActions(
  set: StoreApi<WorldStore>["setState"],
  get: () => WorldStore,
): Pick<
  WorldStore,
  "startWalk" | "addSteps" | "endWalk" | "startTrip" | "endTrip" | "reward" | "payGifts" | "paySpar" | "claim"
> {
  return {
    startWalk: (sensor) => {
      const r = startWalkRule(get().world, now(), sensor);
      if (!r.ok) return set({ notice: { id: nextId(), kind: "fail", reason: r.reason } });
      save(r.world);
      set({ world: r.world, lastOuting: null });
    },
    addSteps: (steps) => {
      const r = stepWalkRule(get().world, steps, now(), petMods());
      if (!r.ok) return;
      save(r.world);
      if (r.found.length) play("pop");
      set({ world: r.world });
    },
    endWalk: () => {
      const r = endWalkRule(get().world, now(), petMods());
      if (!r.ok) return;
      save(r.world);
      set({
        world: r.world,
        lastOuting: { kind: "walk", steps: r.steps, minutes: r.minutes, found: r.finds, capped: r.capped },
      });
      // a walk together is play: joy for the pet, and it tires
      if (r.minutes >= 5) useGame.getState().act({ kind: "play" });
    },
    startTrip: (to) => {
      const r = startTripRule(get().world, to, now());
      if (!r.ok) return set({ notice: { id: nextId(), kind: "fail", reason: r.reason } });
      save(r.world);
      set({ world: r.world, lastOuting: null });
    },
    endTrip: () => {
      const r = endTripRule(get().world, now(), petMods());
      if (!r.ok) return set({ notice: { id: nextId(), kind: "fail", reason: r.reason } });
      save(r.world);
      set({ world: r.world, lastOuting: { kind: "trip", to: r.to, found: r.found, learned: r.learned } });
    },
    reward: (coins) => {
      const w = earn(get().world, coins);
      save(w);
      set({ world: w });
    },
    payGifts: (gifts) => {
      if (!gifts.length) return;
      let w = get().world;
      for (const g of gifts) w = payRewardRule(w, g);
      save(w);
      set({ world: w });
    },
    paySpar: (coins) => {
      const r = paySparWin(get().world, now(), coins);
      if (r.paid > 0) {
        save(r.world);
        set({ world: r.world });
      }
      return r.paid;
    },
    claim: (id) => {
      const p = useGame.getState().pet;
      if (!p) return;
      const r = claimQuest(get().world, id, {
        counts: p.counts,
        stage: stageOf(p, now()),
        onChain: useChain.getState().record !== null,
      });
      if (!r.ok) return set({ notice: { id: nextId(), kind: "fail", reason: r.reason } });
      save(r.world);
      play("success");
      set({ world: r.world, notice: { id: nextId(), kind: "claimed", coins: r.coins, items: r.items } });
    },
  };
}
