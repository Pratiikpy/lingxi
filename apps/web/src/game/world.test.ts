// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { WANTS } from "@lingxi/brain";
import { SUB } from "@lingxi/game";
import { COMPOST, FIRST_VISIT_COINS, GARDEN_ROOM, HOME, ITEM, QUEST_BY_ID, type WorldState, localDay, newWorld } from "@lingxi/world";
import { type Storage, leave, visit } from "./testGame";
import { memoryStorage } from "./testStorage";
import { translate } from "../i18n";
import { noticeText } from "../play/WorldPanels";

const MIN = 60_000;
const H = 60 * MIN;
const T0 = Date.UTC(2026, 10, 18, 9, 0, 0);
const WORLD = "lingxi.world.v1";
const PROOF_MADE = "lingxi.proof.checked.v1";
const LANTERN_ROOM = 64;
const SHOP = 4;
const PEBBLE = 1002;
const SCREWDRIVER = 23102;
const BURNER = 23101;
const STONE_CUP = 1102;
const MOCHI = 11130;
const MAPLE_GUM = 11301;
const GOLDEN_APPLE = 11313;
const MOON_TONIC = 11004;
const WILD_JEWEL = 11224;
const STICK = 1001;
const DRIED_STEMS = 1016;
const CLOVER_SEEDS = 7104;
const HONEYDROP = 11312;
const RIVER_BOX = 21007;

/** A world as an earlier visit saved it. */
const savedWorld = (w: Partial<WorldState>): Storage => {
  const s = memoryStorage();
  s.setItem(WORLD, JSON.stringify({ ...newWorld("feedface"), ...w }));
  return s;
};

/** Opens the play page with a pet hatched (most of the world asks for one) and the stores as the page loads them. */
async function open(o: { at?: number; storage?: Storage; hatch?: boolean } = {}) {
  const v = await visit({ at: o.at ?? T0, ...(o.storage ? { storage: o.storage } : {}) });
  const { useGame } = await import("./store");
  const { useWorld } = await import("./world");
  const { useSaveState } = await import("./saveRuntime");
  const quests = await import("./quests");
  if (o.hatch !== false) useGame.getState().hatch("gentle", "Kiri");
  const w = () => useWorld.getState();
  /** puts the world in a state the test needs, as a quest's pure rule does */
  const arrange = (change: (w: WorldState) => WorldState) => w().setWorld(change(w().world));
  return { ...v, useGame, useWorld, useSaveState, quests, w, arrange };
}

/** What the notice on screen says, in English and in Chinese. */
function said(n: Parameters<typeof noticeText>[0] | null): [string | null, string | null] {
  if (!n) throw new Error("no notice");
  return [noticeText(n, (k, vars) => translate("en", k, vars), "en"), noticeText(n, (k, vars) => translate("zh", k, vars), "zh")];
}

const tallyOf = (w: WorldState, key: string) => w.tally?.[key] ?? 0;
const saved = (s: Storage) => JSON.parse(s.getItem(WORLD) ?? "null") as WorldState | null;

afterEach(() => leave());

describe("the world store: loading the world", () => {
  it("a new player starts at home with 30 coins and a few snacks, and nothing is written until something happens", async () => {
    const { w, storage } = await open({ hatch: false });
    expect(w().world).toMatchObject({ version: 1, room: HOME, coins: 30, bag: { [MOCHI]: 3, [GOLDEN_APPLE]: 2, [MAPLE_GUM]: 2 }, claimed: [] });
    expect(w().world.seed).toMatch(/^[0-9a-f]{16}$/);
    expect(storage.getItem(WORLD)).toBeNull();
  });

  it("a saved world comes back as it was and is not rewritten", async () => {
    const storage = savedWorld({ coins: 77, visited: [HOME, LANTERN_ROOM] });
    const before = storage.getItem(WORLD);
    const { w } = await open({ storage, hatch: false });
    expect(w().world).toMatchObject({ coins: 77, visited: [HOME, LANTERN_ROOM], seed: "feedface" });
    expect(storage.getItem(WORLD)).toBe(before);
  });

  it("a save from before tools that already took the pebbles gets the screwdriver once, and the apprentice's burner once", async () => {
    const storage = savedWorld({ claimed: ["q07", "q22"], bag: {} });
    const first = await open({ storage, hatch: false });
    expect(first.w().world.bag).toMatchObject({ [SCREWDRIVER]: 1, [BURNER]: 1 });
    expect(first.w().world.flags).toEqual(expect.arrayContaining(["tools-given", "burner-given"]));
    expect(saved(storage)?.bag).toMatchObject({ [SCREWDRIVER]: 1, [BURNER]: 1 });
    // used up since, they are not handed out again
    first.w().consume(SCREWDRIVER);
    first.w().consume(BURNER);
    window.dispatchEvent(new Event("pagehide"));
    const again = await open({ storage, hatch: false });
    expect(again.w().world.bag[SCREWDRIVER]).toBeUndefined();
    expect(again.w().world.bag[BURNER]).toBeUndefined();
  });

  it("an older save is counted into the lifetime tally once, from what it already records", async () => {
    const storage = savedWorld({ visited: [HOME, 64, 63, 61], foragedCount: 5, crafted: 2, tally: {}, tallied: undefined });
    const { w } = await open({ storage, hatch: false });
    expect(w().world).toMatchObject({ tallied: 1 });
    expect([tallyOf(w().world, "MOVE:0"), tallyOf(w().world, "FORAGE:0"), tallyOf(w().world, "CRAFT:0")]).toEqual([3, 5, 2]);
    expect(saved(storage)?.tallied).toBe(1);
  });

  it("a world saved by a newer Lingxi is held, not loaded, and nothing the player does writes over it", async () => {
    const newer = JSON.stringify({ ...newWorld("feedface"), version: 2, coins: 999 });
    const storage = memoryStorage();
    storage.setItem(WORLD, newer);
    const { w, claimed, useSaveState } = await open({ storage });
    expect(claimed?.damaged).toEqual([{ key: WORLD, why: "newer" }]);
    expect(useSaveState.getState().damaged).toEqual([{ key: WORLD, why: "newer" }]);
    expect(w().world.coins).toBe(30);
    w().reward(5);
    expect(storage.getItem(WORLD)).toBe(newer);
  });

  it("a world save that will not parse leaves the player a new world, and the broken save stays where it is", async () => {
    const storage = memoryStorage();
    storage.setItem(WORLD, '{"version":1,"coins":');
    const { w, claimed } = await open({ storage });
    expect(claimed?.damaged).toEqual([{ key: WORLD, why: "unreadable" }]);
    expect(w().world.coins).toBe(30);
    w().reward(5);
    expect(storage.getItem(WORLD)).toBe('{"version":1,"coins":');
  });
});

describe("the world store: walking and looking around", () => {
  it("walking next door tires the pet, pays the first visit once, and counts the visit", async () => {
    const { w, useGame, storage } = await open();
    const energy = useGame.getState().pet!.meters.energy;
    expect(w().move(LANTERN_ROOM)).toBe(true);
    expect(w().notice).toMatchObject({ kind: "moved", coins: FIRST_VISIT_COINS });
    expect(said(w().notice)).toEqual(["A new place! +5 coins.", "新地方！+5 金币。"]);
    expect(w().world).toMatchObject({ room: LANTERN_ROOM, coins: 30 + FIRST_VISIT_COINS, visited: [HOME, LANTERN_ROOM] });
    expect(useGame.getState().pet!.meters.energy).toBeLessThanOrEqual(energy - 15 * SUB);
    expect(tallyOf(w().world, `VISIT:${LANTERN_ROOM}`)).toBe(1);
    expect(saved(storage)?.room).toBe(LANTERN_ROOM);
    // back home: a place already known pays nothing and the screen says nothing
    expect(w().move(HOME)).toBe(true);
    expect(w().notice).toMatchObject({ kind: "moved", coins: 0 });
    expect(said(w().notice)).toEqual([null, null]);
    expect(w().world.coins).toBe(30 + FIRST_VISIT_COINS);
  });

  it("a sleeping pet will not walk", async () => {
    const { w, useGame } = await open();
    useGame.getState().act({ kind: "lightsOff" });
    expect(w().move(LANTERN_ROOM)).toBe(false);
    expect(w().notice).toMatchObject({ kind: "fail", reason: "asleep" });
    expect(said(w().notice)).toEqual(["Shh, your pet is asleep.", "嘘，宠物在睡觉。"]);
    expect(w().world.room).toBe(HOME);
  });

  it("a room that is not next door, and a pet too tired to walk, are refused with the reason", async () => {
    const { w, useGame } = await open();
    expect(w().move(SHOP)).toBe(false);
    expect(said(w().notice)).toEqual(["That's too far. Walk there one room at a time.", "太远了，要一个房间一个房间地走过去。"]);
    const pet = useGame.getState().pet!;
    useGame.getState().replace({ ...pet, meters: { ...pet.meters, energy: 5 * SUB } });
    expect(w().move(LANTERN_ROOM)).toBe(false);
    expect(said(w().notice)).toEqual(["Too tired. Let your pet rest first.", "太累了，先让宠物休息一下。"]);
  });

  it("a walk taken wearing something counts what the pet wore", async () => {
    const { w, useGame, arrange } = await open();
    arrange((x) => ({ ...x, wardrobe: { owned: ["bow"], worn: {} } }));
    w().wear(String(useGame.getState().pet!.bornAt), "head", "bow");
    w().move(LANTERN_ROOM);
    expect(tallyOf(w().world, "MOVE_WEARING:bow")).toBe(1);
  });

  it("looking around finds things once an hour, tires the pet, and in time shows the room's secret", async () => {
    const { w, useGame } = await open();
    const energy = useGame.getState().pet!.meters.energy;
    w().forage();
    const found = w().notice!;
    expect(found).toMatchObject({ kind: "found", items: expect.any(Array) });
    for (const f of found.items!) expect(w().world.bag[f.item] ?? 0).toBeGreaterThanOrEqual(f.n);
    expect(said(found)[0]).toMatch(/^Found .+\.$/);
    expect(said(found)[1]).toMatch(/^找到了 .+。$/);
    expect(useGame.getState().pet!.meters.energy).toBeLessThanOrEqual(energy - 10 * SUB);
    // the same hour: nothing more here yet
    w().forage();
    expect(said(w().notice)).toEqual(["You already looked here this hour.", "这一小时已经找过这里了。"]);
    // a new hour each time, until the room knows the pet and shows what it hides
    let secret = false;
    for (let i = 0; i < 8 && !secret; i++) {
      vi.advanceTimersByTime(H);
      useGame.getState().act({ kind: "feed", food: "mochi" });
      w().forage();
      secret = w().notice?.secret === true;
    }
    expect(secret).toBe(true);
    expect(said(w().notice)[0]).toMatch(/This place knows you now, and showed you something hidden!$/);
  });

  it("a room with nothing in it has nothing to find", async () => {
    const { w } = await open();
    w().move(LANTERN_ROOM);
    w().forage();
    expect(said(w().notice)).toEqual(["Nothing to find in this room.", "这个房间里没什么可找的。"]);
  });
});

describe("the world store: the bag, coins and the bench", () => {
  it("a shop sells what it stocks for coins, and says so when the coins run short or it does not stock a thing", async () => {
    const { w, arrange, storage } = await open();
    arrange((x) => ({ ...x, room: SHOP }));
    w().buy(MAPLE_GUM);
    expect(w().world).toMatchObject({ coins: 22, bag: { [MAPLE_GUM]: 3 } });
    expect(said(w().notice)).toEqual(["Bought Maple Gum.", "买了 枫糖口香糖。"]);
    expect(saved(storage)?.coins).toBe(22);
    w().buy(11303);
    expect(said(w().notice)).toEqual(["Not enough coins.", "金币不够。"]);
    w().buy(MOCHI);
    expect(said(w().notice)).toEqual(["That isn't sold here.", "这里不卖这个。"]);
    expect(w().world.coins).toBe(22);
  });

  it("coins won in a spar are added and counted", async () => {
    const { w } = await open();
    w().reward(12);
    expect(w().world.coins).toBe(42);
    expect(tallyOf(w().world, "COINS_EARNED:0")).toBe(12);
  });

  it("the bench makes a stone cup from a pebble with the screwdriver: the work tires and teaches the pet", async () => {
    const { w, useGame, arrange } = await open();
    arrange((x) => ({ ...x, bag: { ...x.bag, [PEBBLE]: 1, [SCREWDRIVER]: 1 } }));
    const before = useGame.getState().pet!;
    w().craft(17);
    expect(w().world.bag).toMatchObject({ [STONE_CUP]: 1, [SCREWDRIVER]: 1 });
    expect(w().world.bag[PEBBLE]).toBeUndefined();
    expect(w().notice).toMatchObject({ kind: "made", items: [{ item: STONE_CUP, n: 1 }], xp: 5 });
    expect(said(w().notice)).toEqual(["Made Stone Cup. +5 experience.", "做好了 石杯。经验 +5。"]);
    const after = useGame.getState().pet!;
    expect(after.xp).toBe(before.xp + 5);
    expect(after.meters.energy).toBeLessThanOrEqual(before.meters.energy - 75 * SUB);
    expect(tallyOf(w().world, `CRAFT:${STONE_CUP}`)).toBe(1);
  });

  it("the bench says what is missing: ingredients, the tool, or a pet awake to do the work", async () => {
    const { w, useGame, arrange } = await open();
    arrange((x) => ({ ...x, bag: { ...x.bag, [SCREWDRIVER]: 1 } }));
    w().craft(17);
    expect(said(w().notice)).toEqual(["Missing some ingredients.", "还缺一些材料。"]);
    arrange((x) => ({ ...x, bag: { [PEBBLE]: 1 } }));
    w().craft(17);
    expect(said(w().notice)).toEqual(["You need the right tool for that. Praline's Corner Shop sells them.", "需要合适的工具。糖霜的街角小店有卖。"]);
    useGame.getState().act({ kind: "lightsOff" });
    w().craft(17);
    expect(said(w().notice)).toEqual(["Shh, your pet is asleep.", "嘘，宠物在睡觉。"]);
    expect(w().world.bag[PEBBLE]).toBe(1);
  });

  it("food from the bag is eaten through the game's care rules and counted by kind and food group", async () => {
    const { w, useGame, storage } = await open();
    w().use(MOCHI);
    expect(useGame.getState().toast?.note).toBe("ate");
    expect(useGame.getState().lastCare).toMatchObject({ kind: "feed", food: ITEM[MOCHI]!.art });
    expect(w().world.bag[MOCHI]).toBe(2);
    expect(saved(storage)?.bag[MOCHI]).toBe(2);
    expect(tallyOf(w().world, `FED:${MOCHI}`)).toBe(1);
    const pet = useGame.getState().pet!;
    expect(tallyOf(w().world, `FED_GROUP:${localDay(Date.now(), pet.tzOffsetMin)}-grain`)).toBe(1);
  });

  it("food a full pet will not eat is not counted as eaten", async () => {
    const { w, useGame } = await open();
    const pet = useGame.getState().pet!;
    useGame.getState().replace({ ...pet, meters: { ...pet.meters, food: 950 * SUB } });
    w().use(GOLDEN_APPLE);
    expect(useGame.getState().toast?.note).toBe("overfed");
    expect(tallyOf(w().world, `FED:${GOLDEN_APPLE}`)).toBe(0);
  });

  it("a drink is used on the pet like any item, and a jewel waits for the next spar without touching the pet", async () => {
    const { w, useGame, arrange, storage } = await open();
    arrange((x) => ({ ...x, bag: { ...x.bag, [MOON_TONIC]: 1, [WILD_JEWEL]: 1 } }));
    w().use(MOON_TONIC);
    expect(useGame.getState().toast?.note).toBe("used");
    expect(tallyOf(w().world, `FED:${MOON_TONIC}`)).toBe(0);
    const toast = useGame.getState().toast;
    w().use(WILD_JEWEL);
    expect(useGame.getState().toast).toBe(toast);
    expect(w().notice).toMatchObject({ kind: "readied", items: [{ item: WILD_JEWEL, n: 1 }] });
    expect(said(w().notice)).toEqual(["Wild Jewel is ready for next time.", "野性宝石准备好了，下次会用上。"]);
    expect(w().world.buffs).toMatchObject({ sparPower: 1 });
    // the spar spends it, once
    expect(w().spendSparBuffs()).toEqual({ power: 1, hp: 0, lossCoins: 0 });
    expect(saved(storage)?.buffs).toEqual({});
    const after = storage.getItem(WORLD);
    expect(w().spendSparBuffs()).toEqual({ power: 0, hp: 0, lossCoins: 0 });
    expect(storage.getItem(WORLD)).toBe(after);
  });

  it("using what cannot be used, or what the bag does not hold, is refused and the bag stays as it was", async () => {
    const { w, arrange } = await open();
    arrange((x) => ({ ...x, bag: { ...x.bag, [STICK]: 1 } }));
    w().use(STICK);
    expect(w().notice).toMatchObject({ kind: "fail", reason: "cantUse" });
    expect(said(w().notice)).toEqual(["That didn't work.", "没有成功。"]);
    w().use(MOON_TONIC);
    expect(said(w().notice)).toEqual(["You don't have one of those.", "你没有这个。"]);
    w().use(999_999);
    expect(w().notice).toMatchObject({ kind: "fail", reason: "cantUse" });
    expect(w().world.bag[STICK]).toBe(1);
  });

  it("a river box opens into its finds; a box the bag does not hold, or a thing that is no box, says so", async () => {
    const { w, arrange } = await open();
    w().openBox();
    expect(said(w().notice)).toEqual(["You don't have one of those.", "你没有这个。"]);
    w().openBox(STICK);
    expect(said(w().notice)).toEqual(["That doesn't open.", "这个打不开。"]);
    arrange((x) => ({ ...x, bag: { ...x.bag, [RIVER_BOX]: 1 } }));
    w().openBox();
    const n = w().notice!;
    expect(n.kind).toBe("opened");
    expect(n.items!.reduce((t, f) => t + f.n, 0)).toBeGreaterThanOrEqual(2);
    expect(w().world.bag[RIVER_BOX]).toBeUndefined();
    expect(said(n)[0]).toMatch(/^Inside: .+\.$/);
  });

  it("a gift is wrapped from the bag, a received one goes in, and a tea is used up, each only when there is enough", async () => {
    const { w } = await open();
    expect(w().wrap(MOCHI, 4)).toBe(false);
    expect(w().wrap(MOCHI, 2)).toBe(true);
    expect(w().world.bag[MOCHI]).toBe(1);
    w().receive(HONEYDROP, 2);
    expect(w().world.bag[HONEYDROP]).toBe(2);
    w().receive(999_999, 1);
    expect(w().world.bag[999_999]).toBeUndefined();
    expect(w().consume(HONEYDROP, 3)).toBe(false);
    expect(w().consume(HONEYDROP, 2)).toBe(true);
    expect(HONEYDROP in w().world.bag).toBe(false);
  });

  it("a resident is handed what a quest asks for; a resident who does not exist is refused", async () => {
    const { w, arrange } = await open();
    arrange((x) => ({ ...x, bag: { ...x.bag, [PEBBLE]: 2 } }));
    expect(w().giveTo("wick", PEBBLE, 1)).toBe(true);
    expect(w().world.bag[PEBBLE]).toBe(1);
    expect(w().giveTo("nobody", PEBBLE, 1)).toBe(false);
    expect(w().notice).toMatchObject({ kind: "fail", reason: "noResident" });
    expect(said(w().notice)).toEqual(["That didn't work.", "没有成功。"]);
    expect(w().world.bag[PEBBLE]).toBe(1);
  });
});

describe("the world store: the garden", () => {
  it("a seed planted with compost ripens in half the time and gives one more", async () => {
    const { w, arrange } = await open();
    arrange((x) => ({ ...x, room: GARDEN_ROOM, bag: { ...x.bag, [CLOVER_SEEDS]: 1, [COMPOST]: 1 } }));
    w().plant(0, "clover", true);
    expect(said(w().notice)).toEqual(["Planted. Come back when it's ripe.", "种下了。熟了再回来。"]);
    expect(w().world.bag[CLOVER_SEEDS]).toBeUndefined();
    w().plant(0, "clover", false);
    expect(said(w().notice)).toEqual(["Something is already growing there.", "那里已经种着东西了。"]);
    w().harvest(0);
    expect(said(w().notice)).toEqual(["Not ripe yet.", "还没成熟。"]);
    vi.advanceTimersByTime(2 * H);
    w().harvest(0);
    expect(w().notice).toMatchObject({ kind: "harvested", items: [{ item: HONEYDROP, n: 4 }] });
    expect(said(w().notice)).toEqual(["Harvested Honeydrop ×4.", "收获了蜜露 ×4。"]);
    expect(w().world.bag[HONEYDROP]).toBe(4);
  });

  it("the garden says what is missing: seeds, compost, or being there at all", async () => {
    const { w, arrange } = await open();
    arrange((x) => ({ ...x, room: GARDEN_ROOM, bag: { [CLOVER_SEEDS]: 1 } }));
    w().plant(1, "pepper", false);
    expect(said(w().notice)).toEqual(["No seeds of that kind in the bag.", "包里没有这种种子。"]);
    w().plant(1, "clover", true);
    expect(said(w().notice)).toEqual(["No compost in the bag.", "包里没有堆肥。"]);
    w().harvest(2);
    expect(w().notice).toMatchObject({ kind: "fail", reason: "empty" });
    arrange((x) => ({ ...x, room: HOME }));
    w().plant(1, "clover", false);
    expect(said(w().notice)).toEqual(["Walk to the Mushroom Garden to tend the plots.", "要走到蘑菇园才能照料菜地。"]);
    w().harvest(1);
    expect(said(w().notice)[0]).toBe("Walk to the Mushroom Garden to tend the plots.");
  });

  it("cleaning a messy pet's mess gives compost; a pet not messy enough gives none", async () => {
    const { w } = await open();
    w().compost(900);
    expect(w().world.bag[COMPOST]).toBeUndefined();
    w().compost(100);
    expect(w().world.bag[COMPOST]).toBe(1);
    expect(said(w().notice)).toEqual(["All clean, and the mess made a bag of compost for the garden.", "洗干净了，脏东西还变成了一袋园子用的堆肥。"]);
  });
});

describe("the world store: the wardrobe and the home", () => {
  it("an outfit is sewn and furniture built from materials, once each; missing materials are named", async () => {
    const { w, arrange } = await open();
    w().make("outfit", "sunhat");
    expect(said(w().notice)).toEqual(["Missing some ingredients.", "还缺一些材料。"]);
    arrange((x) => ({ ...x, bag: { ...x.bag, [DRIED_STEMS]: 9, [STICK]: 5 } }));
    w().make("outfit", "sunhat");
    expect(w().notice).toMatchObject({ kind: "sewn", text: "sunhat" });
    expect(said(w().notice)).toEqual(["New outfit: Straw sunhat. Put it on from the pet page.", "新衣服：草编遮阳帽。去宠物页穿上吧。"]);
    w().make("outfit", "sunhat");
    expect(said(w().notice)).toEqual(["You already have that one.", "这件已经有了。"]);
    w().make("furniture", "books");
    expect(w().notice).toMatchObject({ kind: "built", text: "books" });
    expect(said(w().notice)[0]).toMatch(/^Built a .+ for the home\.$/);
  });

  it("the corner shop sells a piece once; elsewhere it is not sold, and coins must cover it", async () => {
    const { w, arrange } = await open();
    w().buyPiece("bow");
    expect(said(w().notice)).toEqual(["That isn't sold here.", "这里不卖这个。"]);
    arrange((x) => ({ ...x, room: SHOP }));
    w().buyPiece("bow");
    expect(said(w().notice)).toEqual(["Not enough coins.", "金币不够。"]);
    w().reward(100);
    w().buyPiece("bow");
    expect(said(w().notice)).toEqual(["New outfit: Big ribbon bow. Put it on from the pet page.", "新衣服：大蝴蝶结。去宠物页穿上吧。"]);
    expect(w().world.coins).toBe(130 - 40);
    w().buyPiece("bow");
    expect(said(w().notice)).toEqual(["You already have that one.", "这件已经有了。"]);
  });

  it("a piece goes on in its own slot only when owned, and comes off again; a design this player cannot wear is never put on", async () => {
    const { w, useGame, arrange } = await open();
    const petKey = String(useGame.getState().pet!.bornAt);
    w().wear(petKey, "head", "bow");
    expect(said(w().notice)).toEqual(["You don't have that piece yet.", "你还没有这件。"]);
    arrange((x) => ({ ...x, wardrobe: { owned: ["bow"], worn: {} } }));
    w().wear(petKey, "face", "bow");
    expect(said(w().notice)).toEqual(["That doesn't go there.", "这件不能穿在这里。"]);
    w().wear(petKey, "head", "bow");
    expect(w().world.wardrobe?.worn[petKey]).toEqual({ head: "bow" });
    w().wear(petKey, "head", null);
    expect(w().world.wardrobe?.worn[petKey]).toEqual({});
    const before = w().world;
    w().wear(petKey, "head", "u:abc123");
    expect(w().world).toBe(before);
  });

  it("a saved look is kept, put back on, renamed and deleted; an empty or repeated look is refused", async () => {
    const { w, useGame, arrange } = await open();
    const petKey = String(useGame.getState().pet!.bornAt);
    expect(w().saveLook("Plain", petKey)).toEqual({ ok: false, reason: "empty" });
    arrange((x) => ({ ...x, wardrobe: { owned: ["bow"], worn: {} } }));
    w().wear(petKey, "head", "bow");
    expect(w().saveLook("Party", petKey)).toEqual({ ok: true });
    expect(w().saveLook("Party again", petKey)).toEqual({ ok: false, reason: "same" });
    const id = w().world.looks![0]!.id;
    w().wear(petKey, "head", null);
    expect(w().wearLook(petKey, id)).toEqual({ ok: true, missing: [] });
    expect(w().world.wardrobe?.worn[petKey]).toEqual({ head: "bow" });
    expect(w().wearLook(petKey, "l99")).toEqual({ ok: false, reason: "unknown" });
    expect(w().renameLook(id, "Gala")).toBe(true);
    expect(w().world.looks![0]!.name).toBe("Gala");
    expect(w().renameLook("l99", "Gala")).toBe(false);
    expect(w().deleteLook(id)).toBe(true);
    expect(w().deleteLook(id)).toBe(false);
    expect(w().world.looks).toEqual([]);
  });

  it("the champion's laurel is given once", async () => {
    const { w } = await open();
    w().giveLaurel();
    expect(said(w().notice)).toEqual(["New outfit: Champion's laurel. Put it on from the pet page.", "新衣服：冠军桂冠。去宠物页穿上吧。"]);
    const after = w().world;
    w().giveLaurel();
    expect(w().world).toBe(after);
  });

  it("decorations are bought once with coins, placed in the room and put away", async () => {
    const { w } = await open();
    w().reward(20);
    expect(w().buyDecor("fern")).toBe(true);
    expect(w().world.coins).toBe(10);
    expect(w().world.decor?.owned).toEqual(["fern"]);
    expect(w().buyDecor("fern")).toBe(false);
    expect(said(w().notice)).toEqual(["You already have that one.", "这件已经有了。"]);
    expect(w().buyDecor("lantern")).toBe(false);
    expect(said(w().notice)).toEqual(["Not enough coins.", "金币不够。"]);
    w().placeDecor("fern", 10, 12);
    expect(w().world.decor?.placed).toEqual([{ id: "fern", x: expect.any(Number), y: expect.any(Number) }]);
    w().placeDecor("lantern", 10, 12);
    expect(said(w().notice)).toEqual(["You don't have that piece yet.", "你还没有这件。"]);
    w().removeDecor("fern");
    expect(w().world.decor?.placed).toEqual([]);
    const after = w().world;
    w().removeDecor("fern");
    expect(w().world).toBe(after);
  });
});

describe("the world store: walks and trips", () => {
  it("a twenty-minute walk counts its steps by the clock, brings its finds home and counts as play", async () => {
    const { w, useGame } = await open();
    w().startWalk(false);
    expect(w().world.walk).toMatchObject({ steps: 0, sensor: false });
    expect(w().lastOuting).toBeNull();
    w().startWalk(false);
    expect(said(w().notice)).toEqual(["You're already out on a walk.", "已经在散步了。"]);
    w().startTrip("seaside");
    expect(w().notice).toMatchObject({ kind: "fail", reason: "walking" });
    vi.advanceTimersByTime(20 * MIN);
    w().addSteps(100);
    w().endWalk();
    const out = w().lastOuting;
    expect(out).toMatchObject({ kind: "walk", steps: 2000, minutes: 20, capped: false });
    const finds = out?.kind === "walk" ? out.found : [];
    expect(finds.reduce((t, f) => t + f.n, 0)).toBe(5);
    for (const f of finds) expect(w().world.bag[f.item] ?? 0).toBeGreaterThanOrEqual(f.n);
    expect(w().world.walk).toBeUndefined();
    expect(useGame.getState().toast?.note).toBe("played");
    // no walk to end: nothing changes
    const after = w().world;
    w().endWalk();
    w().addSteps(50);
    expect(w().world).toBe(after);
  });

  it("a step sensor's steps count as they come, and a walk of a couple of minutes is not play", async () => {
    const { w, useGame } = await open();
    w().startWalk(true);
    vi.advanceTimersByTime(5 * MIN);
    w().addSteps(900);
    expect(w().world.walk?.steps).toBe(900);
    expect(w().world.walk?.finds.reduce((t, f) => t + f.n, 0)).toBe(2);
    w().endWalk();
    expect(w().lastOuting).toMatchObject({ kind: "walk", steps: 900, minutes: 5 });

    w().startWalk(false);
    vi.advanceTimersByTime(2 * MIN);
    const toast = useGame.getState().toast;
    w().endWalk();
    expect(w().lastOuting).toMatchObject({ kind: "walk", minutes: 2 });
    expect(useGame.getState().toast).toBe(toast);
  });

  it("a trip takes its hours: back too early says not yet, back in time brings finds and a recipe", async () => {
    const { w } = await open();
    w().endTrip();
    expect(w().notice).toMatchObject({ kind: "fail", reason: "notTravelling" });
    w().startTrip("moon");
    expect(said(w().notice)).toEqual(["That didn't work.", "没有成功。"]);
    w().startTrip("seaside");
    expect(w().world.trip?.to).toBe("seaside");
    w().startTrip("orchard");
    expect(said(w().notice)).toEqual(["Your pet is away on a trip.", "宠物出门旅行了。"]);
    w().startWalk(false);
    expect(w().notice).toMatchObject({ kind: "fail", reason: "travelling" });
    w().endTrip();
    expect(said(w().notice)).toEqual(["Not back yet.", "还没回来。"]);
    vi.advanceTimersByTime(2 * H);
    w().endTrip();
    const out = w().lastOuting;
    expect(out).toMatchObject({ kind: "trip", to: "seaside", learned: expect.any(Number) });
    expect(out?.kind === "trip" ? out.found.reduce((t, f) => t + f.n, 0) : 0).toBeGreaterThanOrEqual(3);
    expect(w().world.trip).toBeUndefined();
    expect(w().world.recipes).toContain(out?.kind === "trip" ? out.learned : -1);
  });
});

describe("the world store: quests", () => {
  it("a quest is handed in once it is done: before then the player is told it did not work", async () => {
    const { w, useGame, useWorld } = await open();
    // playtime, a milestone of its own, opens after the first meal (handed in through the story)
    useWorld.setState({ world: { ...w().world, quests: { active: {}, done: { q02: T0 } } } });
    w().claim("playtime");
    expect(w().notice).toMatchObject({ kind: "fail", reason: "notReady" });
    expect(said(w().notice)).toEqual(["That didn't work.", "没有成功。"]);
    const pet = useGame.getState().pet!;
    useGame.setState({ pet: { ...pet, counts: { ...pet.counts, play: 5 } } });
    const coins = w().world.coins;
    w().claim("playtime");
    expect(w().notice).toMatchObject({ kind: "claimed", coins: 20 });
    expect(said(w().notice)).toEqual(["Reward: 20 coins, Ice Cream.", "奖励：20 枚金币，冰淇淋。"]);
    expect(w().world.coins).toBe(coins + 20);
    w().claim("playtime");
    expect(w().world.coins).toBe(coins + 20);
  });

  // B6: the pats and the first meal are paid for by the story quests that ask for them, not a second time here
  it("a milestone that repeats a story quest is never handed in here", async () => {
    const { w, useGame } = await open();
    for (let i = 0; i < 3; i++) useGame.getState().act({ kind: "pet" });
    useGame.getState().act({ kind: "feed", food: "mochi" });
    const coins = w().world.coins;
    w().claim("hello");
    w().claim("firstMeal");
    expect(w().notice).toMatchObject({ kind: "fail", reason: "notReady" });
    expect(w().world.coins).toBe(coins);
    expect(w().world.claimed).toEqual([]);
  });

  it("with no pet there is nothing to hand in", async () => {
    const { w } = await open({ hatch: false });
    w().claim("hello");
    expect(w().notice).toBeNull();
  });

  it("a story quest is taken, its count starts from then, and handing it in pays its rewards once", async () => {
    const { w, useGame, quests, storage } = await open();
    const q01 = QUEST_BY_ID.q01!;
    expect(quests.statusOf(q01)).toBe("available");
    expect(quests.takeQuest("q01")).toBe(true);
    expect(quests.statusOf(q01)).toBe("active");
    expect(quests.handIn("q01")).toBeNull();
    for (let i = 0; i < 3; i++) useGame.getState().act({ kind: "pet" });
    expect(quests.statusOf(q01)).toBe("ready");
    expect(quests.handIn("q01")).toEqual(q01.rewards);
    expect(w().world).toMatchObject({ coins: 40, bag: { [HONEYDROP]: 1 } });
    expect(w().world.flags).toContain("diary");
    expect(tallyOf(w().world, "QUEST_DONE:q01")).toBe(1);
    expect(saved(storage)?.quests?.done.q01).toBeDefined();
    expect(quests.takeQuest("q01")).toBe(false);
  });

  it("the lifetime tally ignores nothing-counts, and a fact or a world already in place is not written again", async () => {
    const { w, storage } = await open();
    w().flag("met-wick");
    const after = storage.getItem(WORLD);
    w().flag("met-wick");
    w().tally("CARE", "feed", 0);
    w().setWorld(w().world);
    expect(storage.getItem(WORLD)).toBe(after);
    expect(w().world.flags).toEqual(["met-wick"]);
  });
});

describe("the world store: what the game counts on its own", () => {
  it("a day checked on the proof page counts, at start and at once from another tab", async () => {
    const storage = memoryStorage();
    storage.setItem(PROOF_MADE, "2");
    const { w } = await open({ storage, hatch: false });
    expect(tallyOf(w().world, "EVENT:proof-checked")).toBe(2);
    storage.setItem(PROOF_MADE, "3");
    window.dispatchEvent(new StorageEvent("storage", { key: "lingxi.lang" }));
    expect(tallyOf(w().world, "EVENT:proof-checked")).toBe(2);
    window.dispatchEvent(new StorageEvent("storage", { key: PROOF_MADE }));
    expect(tallyOf(w().world, "EVENT:proof-checked")).toBe(3);
  });

  it("each minute together with the pet awake and in view counts, by room and time of day, with what it chose", async () => {
    const morning = new Date(2026, 10, 18, 10, 0).getTime();
    const { w, useGame } = await open({ at: morning });
    let chose = 0;
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(MIN);
      useGame.getState().tick();
      if (WANTS[useGame.getState().pet!.last.want] !== "idle") chose++;
    }
    const t = w().world;
    expect(tallyOf(t, `TOGETHER:${HOME}`)).toBe(6);
    expect(tallyOf(t, "TOGETHER_WHEN:morning")).toBe(6);
    expect(tallyOf(t, `TOGETHER_WHEN:morning-${HOME}`)).toBe(6);
    expect(tallyOf(t, "TOGETHER_WHEN:morning-inside")).toBe(6);
    expect(tallyOf(t, "TOGETHER_NIGHT:0")).toBe(0);
    expect(tallyOf(t, "CHOOSE:0")).toBe(chose);
    const pet = useGame.getState().pet!;
    expect(tallyOf(t, `HEALTHY_DAY:${localDay(Date.now(), pet.tzOffsetMin)}`)).toBe(6);
  });

  it("what the pet chose by itself while the player was away counts once, in the room it was left in (G8)", async () => {
    const { w, useGame, arrange } = await open({ at: new Date(2026, 10, 18, 9, 0).getTime() });
    arrange((x) => ({ ...x, room: 56 }));
    const before = { ...(w().world.tally ?? {}) };
    // the game keeps its own clock (gameClock.ts): fake time moves both the wall and the steady clock
    vi.advanceTimersByTime(20 * 60 * MIN);
    useGame.getState().wakeUp();
    const chose = useGame.getState().chose;
    expect(chose, "a pet left twenty hours gets hungry and chooses to eat").not.toBeNull();
    const t = w().world;
    for (const [want, n] of Object.entries(chose!.wants)) {
      expect(tallyOf(t, `CHOOSE:${want}`) - (before[`CHOOSE:${want}`] ?? 0), want).toBe(n);
      expect(tallyOf(t, `CHOOSE:${want}-56`) - (before[`CHOOSE:${want}-56`] ?? 0), `${want} in the forest`).toBe(n);
    }
    // opening the game again with no time gone counts nothing more
    const once = { ...t.tally };
    useGame.getState().wakeUp();
    expect(w().world.tally).toEqual(once);
  });

  it("a minute together at night counts as a night together", async () => {
    const { w, useGame } = await open({ at: new Date(2026, 10, 18, 23, 0).getTime() });
    vi.advanceTimersByTime(MIN);
    useGame.getState().tick();
    expect(tallyOf(w().world, "TOGETHER_NIGHT:0")).toBe(1);
  });

  it("time asleep, out of view, with a friend's pet, or after a long gap is not time together", async () => {
    const { w, useGame } = await open();
    const together = () => tallyOf(w().world, "TOGETHER:0");
    useGame.getState().act({ kind: "lightsOff" });
    vi.advanceTimersByTime(MIN);
    useGame.getState().tick();
    expect(together()).toBe(0);
    useGame.getState().act({ kind: "wake" });

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    try {
      vi.advanceTimersByTime(MIN);
      useGame.getState().tick();
      expect(together()).toBe(0);
    } finally {
      Reflect.deleteProperty(document, "visibilityState");
    }

    vi.advanceTimersByTime(5 * MIN);
    useGame.getState().tick();
    expect(together()).toBe(0);

    vi.advanceTimersByTime(MIN);
    useGame.getState().tick();
    expect(together()).toBe(1);

    const guest = { ...useGame.getState().pet!, bornAt: 1, name: "Dot", sitting: { code: "c0de", key: "k", until: Date.now() + H, owner: null, name: "Dot" } };
    useGame.getState().guest(guest);
    vi.advanceTimersByTime(MIN);
    useGame.getState().tick();
    expect(together()).toBe(1);
  });
});

describe("today's dailies on a new pet's first day (D9)", () => {
  it("offer nothing behind the map or the bag; a player who opened everything gets the full three", async () => {
    const { DAILIES } = await import("@lingxi/world");
    const needs = (id: string) => DAILIES.find((q) => q.id === id)?.needs ?? [];
    const { quests, w, arrange } = await open();
    quests.rollToday();
    const first = w().world.quests?.today?.offered ?? [];
    expect(first.length).toBeGreaterThan(0);
    for (const id of first) expect(needs(id), id).toEqual([]);
    const { useReveal } = await import("./reveal");
    useReveal.getState().openAll();
    arrange((x) => ({ ...x, quests: { ...x.quests!, today: undefined, active: {} } }) as never);
    quests.rollToday();
    expect(w().world.quests?.today?.offered).toHaveLength(3);
  });
});
