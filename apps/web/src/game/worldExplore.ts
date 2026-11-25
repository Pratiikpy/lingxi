/**
 * The world store's actions for going about the world: moving between rooms, foraging, the shops and the market, the
 * village's gifts, crafting, using and giving items, and the boxes (P7: out of world.ts, which composes them).
 */
import {
  buyMarket as buyMarketRule,
  luckyFind as luckyFindRule,
  takeVillageGift as takeVillageGiftRule,
} from "@lingxi/world";
import { useBadges } from "./badges";
import { work, fedTally } from "@lingxi/game";
import {
  ITEM,
  buy as buyItem,
  craft as craftRecipe,
  give as giveItem,
  forage as forageHere,
  move as moveTo,
  openBox as openBoxRule,
  affinitiesOf,
  spendSparBuffs,
  take,
  bump,
  giveTo as giveToRule,
  outfitOf,
} from "@lingxi/world";
import { noteTallies } from "./tally";
import { brainOf, useGame } from "./store";
import { play } from "./sound";
import { now } from "./gameClock";
import { save, happeningRoom, nextId, petEnergy, petMods, tirePet } from "./worldCore";
import type { StoreApi } from "zustand";
import type { WorldStore } from "./world";

export function exploreActions(
  set: StoreApi<WorldStore>["setState"],
  get: () => WorldStore,
): Pick<
  WorldStore,
  | "move"
  | "forage"
  | "buyMarket"
  | "villageGift"
  | "buy"
  | "craft"
  | "use"
  | "openBox"
  | "spendSparBuffs"
  | "wrap"
  | "consume"
  | "giveTo"
  | "receive"
> {
  return {
    move: (to) => {
      const p = useGame.getState().pet;
      if (p?.asleep) {
        set({ notice: { id: nextId(), kind: "fail", reason: "asleep" } });
        return false;
      }
      const mods = petMods();
      const r = moveTo(get().world, to, petEnergy(), mods, now());
      if (!r.ok) {
        play("error");
        set({ notice: { id: nextId(), kind: "fail", reason: r.reason } });
        return false;
      }
      tirePet(mods.moveEnergy);
      // a walk taken wearing something ("visit three rooms carrying a lantern"); market ids keep to one word
      let moved = r.world;
      if (p)
        for (const piece of Object.values(outfitOf(moved, String(p.bornAt))))
          if (piece) moved = bump(moved, "MOVE_WEARING", piece.replace(/:/g, "-"));
      save(moved);
      useBadges.getState().visit(to);
      play("tap");
      set({
        world: moved,
        notice: { id: nextId(), kind: "moved", coins: r.coins, ...(r.found ? { items: [r.found] } : {}) },
      });
      return true;
    },
    forage: () => {
      const mods = petMods();
      const p = useGame.getState().pet;
      // at home where its kind lives: twice the familiarity (brave pets are at home in eerie places too)
      const kin = p ? affinitiesOf(p.line, ((p.instincts ?? 0) & 1) === 1) : [];
      const r = forageHere(get().world, now(), petEnergy(), mods, kin);
      if (!r.ok) {
        play("error");
        return set({ notice: { id: nextId(), kind: "fail", reason: r.reason } });
      }
      tirePet(mods.forageEnergy);
      // D2: on the village's lucky day, the first look around in its room finds one more thing
      const lucky = luckyFindRule(r.world, now(), mods);
      const after = lucky.ok ? lucky.world : r.world;
      const found = lucky.ok
        ? [
            ...r.found.filter((f) => f.item !== lucky.item),
            { item: lucky.item, n: (r.found.find((f) => f.item === lucky.item)?.n ?? 0) + 1 },
          ]
        : r.found;
      save(after);
      play("success");
      set({
        world: after,
        notice: {
          id: nextId(),
          kind: "found",
          items: found,
          ...(r.familiar?.filled ? { secret: true } : {}),
          ...(lucky.ok ? { text: get().world.room === happeningRoom(get().world) ? "lucky" : "luckyHome" } : {}),
        },
      });
    },
    buyMarket: () => {
      const r = buyMarketRule(get().world, now());
      if (!r.ok) {
        play("error");
        return set({ notice: { id: nextId(), kind: "fail", reason: r.reason } });
      }
      save(r.world);
      play("pop");
      set({ world: r.world, notice: { id: nextId(), kind: "bought", items: [{ item: r.item, n: 1 }] } });
    },
    villageGift: (who) => {
      const r = takeVillageGiftRule(get().world, who, now());
      if (!r.ok) return null;
      save(r.world);
      play("sparkle");
      set({ world: r.world });
      return r.item;
    },
    buy: (item) => {
      const r = buyItem(get().world, item);
      if (!r.ok) {
        play("error");
        return set({ notice: { id: nextId(), kind: "fail", reason: r.reason } });
      }
      save(r.world);
      play("pop");
      set({ world: r.world, notice: { id: nextId(), kind: "bought", items: [{ item, n: 1 }] } });
    },
    craft: (recipe) => {
      const g = useGame.getState();
      if (g.pet?.asleep) {
        play("error");
        return set({ notice: { id: nextId(), kind: "fail", reason: "asleep" } });
      }
      const r = craftRecipe(get().world, recipe, petEnergy());
      if (!r.ok) {
        play("error");
        return set({ notice: { id: nextId(), kind: "fail", reason: r.reason } });
      }
      // the work tires the pet and teaches it (plan 4.5)
      const p = g.pet;
      if (p) g.replace(work(p, r.energy, r.xp, now(), brainOf(p)));
      save(r.world);
      play("success");
      set({ world: r.world, notice: { id: nextId(), kind: "made", items: [{ item: r.made, n: 1 }], xp: r.xp } });
    },
    use: (item) => {
      const def = ITEM[item];
      const r = take(get().world, item);
      if (!def || !r.ok) {
        play("error");
        return set({ notice: { id: nextId(), kind: "fail", reason: r.ok ? "cantUse" : r.reason } });
      }
      save(r.world);
      set({ world: r.world });
      const g = useGame.getState();
      const before = g.toast?.id;
      // a bonus-only item (a jewel, a tonic) waits for the next look around or spar; the pet itself is not touched
      if (r.buff && !def.use) {
        play("pop");
        return set({ notice: { id: nextId(), kind: "readied", items: [{ item, n: 1 }] } });
      }
      if (def.kind === "food") g.act({ kind: "feed", food: r.use }, def.art);
      else g.act({ kind: "use", item: r.use }, def.art);
      // a food the pet actually ate: which one, and its food group today (for "three foods", "a balanced plate")
      const after = useGame.getState();
      if (
        def.kind === "food" &&
        after.pet &&
        after.toast &&
        after.toast.id !== before &&
        (after.toast.note === "ate" || after.toast.note === "woke")
      ) {
        noteTallies(fedTally(item, r.use.diet, after.pet.tzOffsetMin, now()));
      }
    },
    openBox: (box = 21007) => {
      const r = openBoxRule(get().world, now(), box);
      if (!r.ok) return set({ notice: { id: nextId(), kind: "fail", reason: r.reason } });
      save(r.world);
      play("success");
      set({ world: r.world, notice: { id: nextId(), kind: "opened", items: r.found } });
    },
    spendSparBuffs: () => {
      const r = spendSparBuffs(get().world);
      if (r.power || r.hp || r.lossCoins) {
        save(r.world);
        set({ world: r.world });
      }
      return { power: r.power, hp: r.hp, lossCoins: r.lossCoins };
    },
    wrap: (item, n) => {
      const w = get().world;
      if ((w.bag[item] ?? 0) < n) return false;
      const next = giveItem(w, item, -n);
      save(next);
      set({ world: next });
      return true;
    },
    consume: (item, count = 1) => {
      const w = get().world;
      const had = w.bag[item] ?? 0;
      if (had < count) return false;
      const left = had - count;
      const bag = { ...w.bag, [item]: left };
      if (left <= 0) delete bag[item];
      const next = { ...w, bag };
      save(next);
      set({ world: next });
      return true;
    },
    giveTo: (resident, item, count) => {
      const r = giveToRule(get().world, resident, item, count);
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
    receive: (item, n) => {
      if (!ITEM[item]) return;
      const next = giveItem(get().world, item, n);
      save(next);
      set({ world: next });
    },
  };
}
