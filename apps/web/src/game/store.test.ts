// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { REF, type Rule, STARTERS, compileProgram, composeInstinct, encode, fastBrain, inputField, netlistBytes, stateBits, toElements, validateProgram } from "@lingxi/brain";
import { CARD_OUTSIDE_MAX, EVENT, INSTINCT_MAX_GATES, LIGHT_BULB_BEATS, PET_SCHOOL, type OutsideInstinct, type Pet, SUB, type TallyEntry, awaySeed, beatOf, careTally, createPet, familyOf, mindBrain, minuteTally, watchEvent } from "@lingxi/game";
import { COMPOST } from "@lingxi/world";
import { type Key, translate } from "../i18n";
import { type Net, type Storage, json, leave, reload, visit } from "./testGame";
import { memoryStorage } from "./testStorage";

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
const T0 = Date.UTC(2026, 10, 18, 9, 0, 0);
const PETS = "lingxi.pets.v2";
const OLD_PET = "lingxi.pet.v1";

/** The device's time zone at a moment, as the game reads it. */
const deviceTz = (t: number) => -new Date(t).getTimezoneOffset();
const brainOfLine = (line: "gentle" | "bold" | "curious") => ({ fast: fastBrain(compileProgram(STARTERS[line])), nState: stateBits(STARTERS[line]), program: STARTERS[line] });

/** A pet as an earlier visit saved it: born at `bornAt`, last seen at `seenAt`. */
function savedPet(name: string, bornAt: number, seenAt = bornAt, line: "gentle" | "bold" | "curious" = "gentle"): Pet {
  return { ...createPet({ name, line, now: bornAt, tzOffsetMin: deviceTz(seenAt), brain: brainOfLine(line) }), beat: beatOf(seenAt) };
}

/** Storage holding a roster of pets, as the game writes it. */
function storageWith(pets: Pet[], active = 0, extra: Record<string, string> = {}): Storage {
  const s = memoryStorage();
  s.setItem(PETS, JSON.stringify({ active, pets }));
  for (const [k, v] of Object.entries(extra)) s.setItem(k, v);
  return s;
}

/** The roster as it stands in storage. */
const savedRoster = (s: Storage) => JSON.parse(s.getItem(PETS) ?? "null") as { active: number; pets: Pet[]; kept?: unknown[] } | null;

/** Opens the play page and loads the game, the world (which takes the tally) and the badges, as the page does. */
async function open(o: { at?: number; storage?: Storage; net?: Net } = {}) {
  const v = await visit({ at: o.at ?? T0, ...(o.storage ? { storage: o.storage } : {}), ...(o.net ? { net: o.net } : {}) });
  return loaded(v);
}
async function loaded<V extends object>(v: V) {
  const store = await import("./store");
  const { useWorld } = await import("./world");
  const { useBadges } = await import("./badges");
  const clock = await import("./gameClock");
  const { useSaveState } = await import("./saveRuntime");
  return { ...v, ...store, useWorld, useBadges, clock, useSaveState };
}

/** What the toast on screen says, in each language (the play page shows `note.<note>` with the pet's name). */
function toastText(s: { toast: { note: string } | null; pet: Pet | null }, lang: "en" | "zh"): string {
  return translate(lang, `note.${s.toast!.note}` as Key, { name: s.pet!.name });
}

const tallyOf = (w: { tally?: Record<string, number> }, key: string) => w.tally?.[key] ?? 0;

afterEach(() => leave());

describe("the game store: hatching", () => {
  it("hatches a named pet, saves it, and starts today's care card", async () => {
    const { useGame, storage, useBadges } = await open();
    useGame.getState().hatch("gentle", "   Mochi the Great Pet  ");
    const s = useGame.getState();
    expect(s.pet?.name).toBe("Mochi the Gr");
    expect(s.pet?.line).toBe("gentle");
    expect(s.pet?.bornAt).toBe(T0);
    expect(s.pet?.tzOffsetMin).toBe(deviceTz(T0));
    expect(s.pets).toHaveLength(1);
    expect(s.daily).toEqual({ day: new Date(T0).toDateString(), fed: false, played: false, cleaned: false, petted: false });
    expect(savedRoster(storage)?.pets.map((p) => p.name)).toEqual(["Mochi the Gr"]);
    expect(useBadges.getState().ledger.pets).toBe(1);
  });

  it("names a pet given only spaces Mochi, and keeps the instincts chosen at hatching", async () => {
    const { useGame } = await open();
    useGame.getState().hatch("bold", "    ", 5);
    expect(useGame.getState().pet).toMatchObject({ name: "Mochi", line: "bold", instincts: 5 });
  });
});

describe("the game store: care", () => {
  it("each care changes the pet, says so in a toast, marks today's card and counts for quests and badges", async () => {
    const { useGame, useWorld, useBadges, storage } = await open();
    useGame.getState().hatch("gentle", "Kiri");

    const toasts: number[] = [];
    const unsubscribe = useGame.subscribe((st, prev) => st.toast !== prev.toast && st.toast && toasts.push(st.toast.id));
    useGame.getState().act({ kind: "feed", food: "mochi" });
    let s = useGame.getState();
    expect(s.toast?.note).toBe("ate");
    expect(toastText(s, "en")).toBe("Kiri ate it all up.");
    expect(toastText(s, "zh")).toBe("Kiri吃得一干二净。");
    expect(s.lastCare).toMatchObject({ kind: "feed", food: "art/items/rice_mochi.png" });

    useGame.getState().act({ kind: "play" });
    s = useGame.getState();
    // a play is a game, a shift or a walk; there is no ball, so the toast names none (G8)
    expect(toastText(s, "en")).toBe("Kiri liked playing with you.");
    expect(toastText(s, "zh")).toBe("Kiri喜欢和你一起玩。");
    expect(s.lastCare).toEqual({ kind: "play", at: expect.any(Number) });

    useGame.getState().act({ kind: "clean" });
    expect(toastText(useGame.getState(), "zh")).toBe("洗干净啦。Kiri打了个喷嚏。");
    useGame.getState().act({ kind: "pet" });
    s = useGame.getState();
    expect(toastText(s, "en")).toBe("Kiri leans into your hand.");

    expect(s.daily).toMatchObject({ fed: true, played: true, cleaned: true, petted: true });
    expect(s.pet?.counts).toMatchObject({ feed: 1, play: 1, clean: 1, pet: 1 });
    // each care raised a toast of its own, so the screen shows every one
    unsubscribe();
    expect(new Set(toasts).size).toBe(4);
    const w = useWorld.getState().world;
    // four cares in all: the finer key by time of day (CARE:feed-morning beside CARE:feed) is not counted twice
    expect([tallyOf(w, "CARE:0"), tallyOf(w, "CARE:feed"), tallyOf(w, "CARE:play"), tallyOf(w, "CARE:clean"), tallyOf(w, "CARE:pet")]).toEqual([4, 1, 1, 1, 1]);
    expect(Object.keys(w.tally ?? {}).filter((k) => /^CARE:feed-/.test(k))).toHaveLength(1);
    expect(useBadges.getState().ledger).toMatchObject({ care: 4, feed: 1, play: 1, clean: 1, petting: 1 });
    expect(savedRoster(storage)?.pets[0]?.counts).toMatchObject({ feed: 1, play: 1, clean: 1, pet: 1 });
  });

  it("a pet too tired to play says so, and today's card stays unplayed", async () => {
    const { useGame, useWorld } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    const pet = useGame.getState().pet!;
    useGame.getState().replace({ ...pet, meters: { ...pet.meters, energy: 100 * SUB } });
    useGame.getState().act({ kind: "play" });
    const s = useGame.getState();
    expect(s.toast?.note).toBe("tooTired");
    expect(toastText(s, "en")).toBe("Kiri is too tired to play. Let it rest a while.");
    expect(toastText(s, "zh")).toBe("Kiri太累了，玩不动。让它歇一会儿吧。");
    expect(s.daily.played).toBe(false);
    expect(s.pet?.counts.play).toBe(0);
    expect(tallyOf(useWorld.getState().world, "CARE:play")).toBe(0);
  });

  it("feeding a pet that is already full makes it grumpy and does not count as today's meal", async () => {
    const { useGame } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    const pet = useGame.getState().pet!;
    useGame.getState().replace({ ...pet, meters: { ...pet.meters, food: 950 * SUB } });
    useGame.getState().act({ kind: "feed", food: "apple" });
    const s = useGame.getState();
    expect(s.toast?.note).toBe("overfed");
    expect(toastText(s, "en")).toBe("Kiri was already full. A little grumpy now.");
    expect(toastText(s, "zh")).toBe("Kiri早就饱了，现在有点不高兴。");
    expect(s.daily.fed).toBe(false);
  });

  it("waking a pet that is awake counts for nothing; putting it to bed and waking it counts both", async () => {
    const { useGame, useWorld } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    useGame.getState().act({ kind: "wake" });
    expect(useGame.getState().toast?.note).toBe("awake");
    expect(tallyOf(useWorld.getState().world, "CARE:wake")).toBe(0);
    useGame.getState().act({ kind: "lightsOff" });
    expect(toastText(useGame.getState(), "en")).toBe("Lights off. Good night, Kiri.");
    expect(useGame.getState().pet?.asleep).toBe(true);
    useGame.getState().act({ kind: "wake" });
    expect(toastText(useGame.getState(), "en")).toBe("Good morning, Kiri.");
    const w = useWorld.getState().world;
    expect([tallyOf(w, "CARE:sleep"), tallyOf(w, "CARE:wake")]).toEqual([1, 1]);
  });

  it("a pat soon after a lost spar counts as comfort, once", async () => {
    const { useGame, useWorld } = await open();
    const { markLoss } = await import("./comfort");
    useGame.getState().hatch("gentle", "Kiri");
    markLoss();
    vi.advanceTimersByTime(2 * MIN);
    useGame.getState().act({ kind: "pet" });
    useGame.getState().act({ kind: "pet" });
    expect(tallyOf(useWorld.getState().world, "EVENT:comforted")).toBe(1);
  });

  it("an item used on the pet shows as a meal with the item's picture", async () => {
    const { useGame } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    useGame.getState().act({ kind: "use", item: { joy: 30 } }, "art/items/tea.png");
    const s = useGame.getState();
    expect(s.toast?.note).toBe("used");
    expect(toastText(s, "en")).toBe("Kiri feels better for it.");
    expect(s.lastCare).toMatchObject({ kind: "feed", food: "art/items/tea.png" });
  });

  it("cleaning up after a messy pet leaves compost for the garden; a clean pet leaves none", async () => {
    const { useGame, useWorld } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    useGame.getState().act({ kind: "clean" });
    await vi.dynamicImportSettled();
    expect(useWorld.getState().world.bag[COMPOST] ?? 0).toBe(0);
    const pet = useGame.getState().pet!;
    useGame.getState().replace({ ...pet, meters: { ...pet.meters, clean: 100 * SUB } });
    useGame.getState().act({ kind: "clean" });
    await vi.dynamicImportSettled();
    expect(useWorld.getState().world.bag[COMPOST]).toBe(1);
    expect(useWorld.getState().notice).toMatchObject({ kind: "compost", items: [{ item: COMPOST, n: 1 }] });
  });

  it("with no pet, care, ticks and lessons do nothing", async () => {
    const { useGame, storage } = await open();
    const s = useGame.getState();
    s.act({ kind: "feed", food: "mochi" });
    s.tick();
    s.wakeUp();
    s.arrange(0, "up");
    s.forgetInstinct();
    s.respec();
    expect(s.learn({ when: { event: [2] }, then: { want: 2, mood: 2 } })).toEqual({ ok: false, reason: "invalid", detail: "no pet" });
    expect(s.teachInstinct({ processor: "0x1", id: "1", owner: "0x2", parts: [] })).toEqual({ ok: false, reason: "badCircuit" });
    expect(s.levelUp()).toEqual({ ok: false, reason: "xp" });
    expect(s.learnSkill(111)).toEqual({ ok: false, reason: "noSkill" });
    expect(useGame.getState()).toMatchObject({ pet: null, toast: null, lastCare: null });
    expect(storage.getItem(PETS)).toBeNull();
  });

  it("a toast can be raised by other screens, each one new", async () => {
    const { useGame } = await open();
    useGame.getState().say("saved");
    const first = useGame.getState().toast!;
    useGame.getState().say("saved");
    expect(useGame.getState().toast?.id).toBe(first.id + 1);
    expect(translate("en", "note.saved")).toBe("Today is saved on X Layer.");
  });
});

describe("the game store: time", () => {
  it("a minute of the page open moves the pet one beat and saves it; within the minute nothing changes", async () => {
    const { useGame, storage } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    const born = useGame.getState().pet!;
    useGame.getState().tick();
    expect(useGame.getState().pet).toBe(born);
    vi.advanceTimersByTime(MIN);
    useGame.getState().tick();
    expect(useGame.getState().pet?.beat).toBe(born.beat + 1);
    expect(savedRoster(storage)?.pets[0]?.beat).toBe(born.beat + 1);
  });

  it("a tab hidden for two hours comes back like a return: the pet catches up and has a story of its time away", async () => {
    const { useGame } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    const from = useGame.getState().pet!.beat;
    vi.advanceTimersByTime(2 * H);
    useGame.getState().tick();
    const s = useGame.getState();
    expect(s.pet?.beat).toBe(from + 120);
    expect(s.away).toEqual({ petKey: String(T0), from, to: from + 120 });
    s.clearAway();
    expect(useGame.getState().away).toBeNull();
  });

  it("a short absence catches the pet up with no story to tell", async () => {
    const { useGame } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    const from = useGame.getState().pet!.beat;
    vi.advanceTimersByTime(15 * MIN);
    useGame.getState().tick();
    expect(useGame.getState().pet?.beat).toBe(from + 15);
    expect(useGame.getState().away).toBeNull();
  });

  it("growing up a stage while the page is open is noted for the Growing up badge", async () => {
    // born a day ago, less half a minute: a baby now, a child one minute from now
    const storage = storageWith([savedPet("Kiri", T0 - DAY + 30_000, T0)]);
    const { useGame, useBadges } = await open({ storage });
    expect(useBadges.getState().ledger.stage).toBeUndefined();
    vi.advanceTimersByTime(MIN);
    useGame.getState().tick();
    expect(useBadges.getState().ledger.stage).toBe(2);
  });

  it("a device clock turned back two days changes neither the pet's time nor today's card", async () => {
    const { useGame, clock } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    useGame.getState().act({ kind: "feed", food: "mochi" });
    vi.advanceTimersByTime(10 * MIN);
    useGame.getState().tick();
    const before = useGame.getState().pet!.beat;
    const gameTime = clock.now();

    vi.setSystemTime(Date.now() - 2 * DAY);
    useGame.getState().tick();
    expect(clock.now()).toBe(gameTime);
    expect(useGame.getState().pet?.beat).toBe(before);
    // and the pet lives on from there, neither frozen nor run backwards
    vi.advanceTimersByTime(MIN);
    useGame.getState().tick();
    expect(useGame.getState().pet?.beat).toBe(before + 1);
    useGame.getState().act({ kind: "pet" });
    expect(useGame.getState().daily).toMatchObject({ day: new Date(T0).toDateString(), fed: true, petted: true });
  });

  it("a reload on a device whose clock was turned back three days, offline, finds the pet where it was", async () => {
    const first = await open();
    first.useGame.getState().hatch("gentle", "Kiri");
    vi.advanceTimersByTime(30 * MIN);
    first.useGame.getState().tick();
    const beat = first.useGame.getState().pet!.beat;

    const again = await loaded(await reload(first.storage, { at: T0 + 30 * MIN - 3 * DAY }));
    const s = again.useGame.getState();
    expect(s.pet?.name).toBe("Kiri");
    expect(s.pet?.beat).toBe(beat);
    expect(s.away).toBeNull();
    expect(again.clock.now()).toBeGreaterThanOrEqual(T0 + 30 * MIN);
  });

  it("a clock that ran a day ahead and is put right by the server keeps today's card rather than handing out a fresh one", async () => {
    let online = false;
    const net: Net = async (url) => {
      if (!online || !url.endsWith("/api/time")) throw new TypeError("Failed to fetch");
      return json({ now: Date.now() - DAY });
    };
    // the device clock reads a day ahead of real time, and the server cannot be reached yet
    const { useGame, clock } = await open({ at: T0 + DAY, net });
    useGame.getState().hatch("gentle", "Kiri");
    useGame.getState().act({ kind: "feed", food: "mochi" });
    const ahead = new Date(T0 + DAY).toDateString();
    expect(useGame.getState().daily).toMatchObject({ day: ahead, fed: true });

    online = true;
    expect(await clock.clock.sync()).toBe(true);
    expect(Math.abs(clock.now() - T0)).toBeLessThan(1_000);
    useGame.getState().act({ kind: "pet" });
    expect(useGame.getState().daily).toMatchObject({ day: ahead, fed: true, petted: true });
    // the pet, whose last beat was a day ahead, lives on from real time at once
    vi.advanceTimersByTime(MIN);
    useGame.getState().tick();
    expect(useGame.getState().pet?.beat).toBe(beatOf(clock.now()));
  });
});

describe("the game store: the roster on this device", () => {
  it("a pet saved before families becomes the first pet of the roster, saved the new way", async () => {
    const storage = memoryStorage();
    storage.setItem(OLD_PET, JSON.stringify(savedPet("Old Bun", T0 - 3 * DAY, T0)));
    const { useGame } = await open({ storage });
    expect(useGame.getState().pets.map((p) => p.name)).toEqual(["Old Bun"]);
    expect(savedRoster(storage)?.pets.map((p) => p.name)).toEqual(["Old Bun"]);
  });

  it("a pet from a newer Lingxi is kept aside by name and written back untouched with every save", async () => {
    const fromTheFuture = { version: 2, name: "Nova", line: "gentle", bornAt: 7, wings: 3 };
    const storage = memoryStorage();
    storage.setItem(PETS, JSON.stringify({ active: 0, pets: [savedPet("Kiri", T0 - H, T0), fromTheFuture] }));
    const { useGame, keptPetNames } = await open({ storage });
    expect(keptPetNames()).toEqual(["Nova"]);
    useGame.getState().act({ kind: "pet" });
    expect(savedRoster(storage)?.kept).toEqual([fromTheFuture]);
  });

  it("a pet save that will not parse is held for the player's choice and never written over, even by a new hatch", async () => {
    const storage = memoryStorage();
    const broken = '{"active":0,"pets":[{"na';
    storage.setItem(PETS, broken);
    const v = await visit({ at: T0, storage });
    expect(v.claimed?.damaged).toEqual([{ key: PETS, why: "unreadable" }]);
    const { useGame, useSaveState } = await loaded(v);
    expect(useGame.getState()).toMatchObject({ pet: null, pets: [] });
    useGame.getState().hatch("gentle", "Kiri");
    expect(useGame.getState().pet?.name).toBe("Kiri");
    expect(storage.getItem(PETS)).toBe(broken);
    expect(useSaveState.getState().damaged).toEqual([{ key: PETS, why: "unreadable" }]);
  });

  it("a pet away three hours catches up on return and has a story of the absence", async () => {
    const pet = savedPet("Kiri", T0 - DAY, T0 - 3 * H);
    const storage = storageWith([pet]);
    const { useGame } = await open({ storage });
    const s = useGame.getState();
    expect(s.pet?.beat).toBe(beatOf(T0));
    expect(s.away).toEqual({ petKey: String(pet.bornAt), from: beatOf(T0 - 3 * H), to: beatOf(T0) });
    expect(savedRoster(storage)?.pets[0]?.beat).toBe(beatOf(T0));
  });

  it("a pet lives by the device's time zone: one saved elsewhere takes this one's", async () => {
    const pet = { ...savedPet("Kiri", T0 - H, T0), tzOffsetMin: deviceTz(T0) + 120 };
    const { useGame } = await open({ storage: storageWith([pet]) });
    expect(useGame.getState().pet?.tzOffsetMin).toBe(deviceTz(T0));
  });

  it("switching pets brings the other one up to now and puts it on screen", async () => {
    const a = savedPet("Kiri", T0 - DAY, T0);
    const b = savedPet("Bun", T0 - 2 * DAY, T0 - 2 * H, "bold");
    const { useGame, storage } = await open({ storage: storageWith([a, b]) });
    useGame.getState().act({ kind: "pet" });
    useGame.getState().switchTo(1);
    let s = useGame.getState();
    expect(s.active).toBe(1);
    expect(s.pet?.name).toBe("Bun");
    expect(s.pet?.beat).toBe(beatOf(T0));
    expect(s.lastCare).toBeNull();
    expect(s.away).toMatchObject({ petKey: String(b.bornAt) });
    expect(savedRoster(storage)?.active).toBe(1);
    // the pet already on screen, or one that does not exist: nothing moves
    useGame.getState().switchTo(1);
    useGame.getState().switchTo(7);
    s = useGame.getState();
    expect([s.active, s.pet?.name]).toEqual([1, "Bun"]);
  });

  it("a newborn of two parents joins the family with a mind of a day half and a night half", async () => {
    const { useGame, useWorld, useBadges, mindParts, decidingPart, brainOf } = await open({ storage: storageWith([savedPet("Kiri", T0 - 9 * DAY, T0)]) });
    const family = familyOf({ name: "Kiri", line: "gentle", lessons: [] }, { name: "Bo", line: "bold", lessons: [] });
    const child: Pet = { ...createPet({ name: "Pip", line: "gentle", now: T0, tzOffsetMin: deviceTz(T0), brain: mindBrain({ line: "gentle", lessons: [], family }) }), family };
    expect(useGame.getState().adopt(child)).toBe(true);
    const s = useGame.getState();
    expect([s.active, s.pet?.name, s.pets.length]).toEqual([1, "Pip", 2]);
    const parts = mindParts(child);
    expect(parts.map((p) => p.from)).toEqual([
      { name: "Kiri", when: "day" },
      { name: "Bo", when: "night" },
    ]);
    expect(parts[1]?.offset).toBe(stateBits(parts[0]!.program));
    expect(decidingPart(child)).toEqual(parts[0]);
    expect(decidingPart({ ...child, last: { ...child.last, half: 1 } }).from?.name).toBe("Bo");
    expect(brainOf(child).nState).toBe(child.brain.length);
    expect(useBadges.getState().ledger).toMatchObject({ pets: 1, children: 1 });
    expect(tallyOf(useWorld.getState().world, "EVENT:child-born")).toBe(1);
  });

  it("a pet's mind is its starter brain until it is taught, and the compiled brain is reused", async () => {
    const { programFor, brainFor, mindParts } = await open();
    // the starters as this visit's modules hold them
    const { STARTERS: starters } = await import("@lingxi/brain");
    expect(programFor("curious")).toBe(starters.curious);
    const lesson: Rule = { when: { event: [2] }, then: { want: 2, mood: 3 } };
    expect(programFor("curious", [lesson])).not.toBe(starters.curious);
    expect(programFor("curious", [lesson]).rules).toContainEqual(expect.objectContaining(lesson));
    expect(brainFor("bold", [lesson])).toBe(brainFor("bold", [lesson]));
    expect(mindParts(savedPet("Kiri", T0))).toEqual([{ program: starters.gentle, offset: 0 }]);
  });

  it("an eighth pet fills the device: no more are born, adopted or taken in", async () => {
    const eight = Array.from({ length: 8 }, (_, i) => savedPet(`P${i}`, T0 - (i + 1) * H, T0));
    const { useGame } = await open({ storage: storageWith(eight) });
    const another = savedPet("Nine", T0 - 30 * MIN, T0);
    expect(useGame.getState().adopt(another)).toBe(false);
    expect(useGame.getState().welcome(another)).toBe(false);
    expect(useGame.getState().guest(another)).toBe(false);
    expect(useGame.getState().pets).toHaveLength(8);
  });

  it("a little one from the adoption centre joins the roster, once", async () => {
    const { useGame, useWorld, useBadges } = await open({ storage: storageWith([savedPet("Kiri", T0 - DAY, T0)]) });
    const little = savedPet("Lumi", T0 - 2 * H, T0, "curious");
    expect(useGame.getState().welcome(little)).toBe(true);
    expect(useGame.getState().welcome(little)).toBe(false);
    expect([useGame.getState().active, useGame.getState().pet?.name]).toEqual([1, "Lumi"]);
    expect(useBadges.getState().ledger.pets).toBe(1);
    expect(tallyOf(useWorld.getState().world, "EVENT:adopted")).toBe(1);
  });
});

describe("the game store: a pet leaving", () => {
  it("a friend's pet comes to stay without counting as a new pet of yours, and goes home again", async () => {
    const mine = savedPet("Kiri", T0 - DAY, T0);
    const { useGame, useBadges, storage } = await open({ storage: storageWith([mine]) });
    const friends: Pet = { ...savedPet("Dot", T0 - 3 * DAY, T0, "bold"), sitting: { code: "c0de", key: "k", until: T0 + DAY, owner: null, name: "Dot" } };
    expect(useGame.getState().guest(friends)).toBe(true);
    expect(useGame.getState().guest(friends)).toBe(false);
    expect(useGame.getState().pet?.name).toBe("Dot");
    expect(useBadges.getState().ledger.pets).toBeUndefined();
    // a friend's pet is taught only by its owner
    expect(useGame.getState().learn({ when: { event: [2] }, then: { want: 2, mood: 2 } })).toEqual({ ok: false, reason: "notYours", detail: "only its owner teaches it" });

    useGame.getState().release(friends.bornAt);
    const s = useGame.getState();
    expect(s.pets.map((p) => p.name)).toEqual(["Kiri"]);
    expect([s.active, s.pet?.name, s.lastCare]).toEqual([0, "Kiri", null]);
    expect(savedRoster(storage)?.pets.map((p) => p.name)).toEqual(["Kiri"]);
  });

  it("a pet that is not here cannot be sent home; the last pet leaving leaves an empty home", async () => {
    const only = savedPet("Kiri", T0 - DAY, T0);
    const { useGame, storage } = await open({ storage: storageWith([only]) });
    useGame.getState().release(12345);
    expect(useGame.getState().pets).toHaveLength(1);
    useGame.getState().release(only.bornAt);
    expect(useGame.getState()).toMatchObject({ pet: null, pets: [], active: 0 });
    expect(savedRoster(storage)).toEqual({ active: 0, pets: [] });
  });

  it("a pet staying with a friend is frozen here: no care, no time, no lessons, and no story when the page reopens", async () => {
    const { useGame, storage } = await open({ storage: storageWith([savedPet("Kiri", T0 - DAY, T0)]) });
    const pet = useGame.getState().pet!;
    useGame.getState().replace({ ...pet, away: { code: "c0de", key: "k", until: T0 + 3 * DAY, sitter: null } });
    const away = useGame.getState().pet!;
    useGame.getState().act({ kind: "feed", food: "mochi" });
    vi.advanceTimersByTime(5 * MIN);
    useGame.getState().tick();
    expect(useGame.getState().pet).toBe(away);
    expect(useGame.getState().toast).toBeNull();
    expect(useGame.getState().learn({ when: { event: [2] }, then: { want: 2, mood: 2 } })).toMatchObject({ ok: false, reason: "notYours" });
    expect(useGame.getState().teachInstinct({ processor: "0x1", id: "1", owner: "0x2", parts: [] })).toEqual({ ok: false, reason: "notYours" });

    const again = await loaded(await reload(storage, { at: T0 + 6 * H }));
    expect(again.useGame.getState().pet).toMatchObject({ beat: away.beat, away: { code: "c0de" } });
    expect(again.useGame.getState().away).toBeNull();
  });

  it("a pet adopted out from the adoption centre leaves the roster", async () => {
    const a = savedPet("Kiri", T0 - DAY, T0);
    const b = savedPet("Lumi", T0 - 9 * DAY, T0, "curious");
    const { useGame } = await open({ storage: storageWith([a, b], 1) });
    const lumi = useGame.getState().pet!;
    useGame.getState().replace({ ...lumi, away: { code: "centre:42", key: "", until: T0 + 7 * DAY, sitter: null } });
    useGame.getState().release(lumi.bornAt);
    expect(useGame.getState().pets.map((p) => p.name)).toEqual(["Kiri"]);
    expect(useGame.getState().pet?.name).toBe("Kiri");
  });
});

const CPU = "0x00000000000000000000000000000000000000cc";
const OWNER = "0x00000000000000000000000000000000000000dd";
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const instinctProgram = validateProgram({ version: "LX-PET/1", memory: [{ kind: "flag", name: "met", set: [{ event: [1] }] }], rules: [{ when: { met: [1], time: [0] }, then: { want: 6, mood: 3 } }], otherwise: { want: 0, mood: 1 } });
const owned: OutsideInstinct = { processor: CPU, id: "9", owner: OWNER, parts: [{ processor: CPU, id: "9", nIn: 16, nOut: 8, hex: hex(netlistBytes(compileProgram(instinctProgram))) }] };

describe("a living room while you watch (G1)", () => {
  it("each watched minute carries the event the pet's schedule brings, and the room is told when one comes", async () => {
    const { useGame } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    const seed = awaySeed(useGame.getState().pet!);
    let seen = 0;
    for (let m = 0; m < 30; m++) {
      vi.advanceTimersByTime(MIN);
      useGame.getState().tick();
      const p = useGame.getState().pet!;
      const event = (p.last.word >> inputField("event").lo) & 3;
      expect(event, `minute ${m}`).toBe(watchEvent(seed, p.beat));
      if (event) {
        seen++;
        expect(useGame.getState().roomEvent?.event).toBe(event);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe("the light-bulb moment (B4)", () => {
  it("a lesson that answers a friend has a friend arrive in the next beats, logged, and the pet does what it was taught", async () => {
    const { useGame } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    const share = PET_SCHOOL.find((l) => l.id === "share")!.rule;
    expect(useGame.getState().learn(share).ok).toBe(true);
    let fired = 0;
    for (let m = 0; m < LIGHT_BULB_BEATS; m++) {
      vi.advanceTimersByTime(MIN);
      useGame.getState().tick();
      const p = useGame.getState().pet!;
      expect((p.last.word >> inputField("event").lo) & 3, `minute ${m}`).toBe(EVENT.friend);
      expect(useGame.getState().roomEvent?.event).toBe(EVENT.friend);
      if (p.last.rule === 0) fired++;
    }
    expect(fired).toBeGreaterThan(0);
    // and then the room goes back to its own schedule
    vi.advanceTimersByTime(MIN);
    useGame.getState().tick();
    const p = useGame.getState().pet!;
    expect((p.last.word >> inputField("event").lo) & 3).toBe(watchEvent(awaySeed(p), p.beat));
  });

  it("a lesson that answers a care or a moment stages nothing", async () => {
    const { useGame } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    useGame.getState().learn(PET_SCHOOL.find((l) => l.id === "thanks")!.rule);
    expect(useGame.getState().lightBulb).toBeNull();
  });
});

describe("the game store: teaching and growing", () => {
  const lesson: Rule = { when: { event: [2] }, then: { want: 2, mood: 3 } };
  const another: Rule = { when: { event: [1] }, then: { want: 6, mood: 2 } };

  it("a lesson is learned at once: the pet answers with its new mind and the toast says so", async () => {
    const { useGame, useWorld, useBadges, storage } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    expect(useGame.getState().learn(lesson)).toEqual({ ok: true });
    const s = useGame.getState();
    expect(s.pet?.lessons).toEqual([lesson]);
    expect(s.pet?.counts.lessons).toBe(1);
    expect(s.lastCare?.kind).toBe("learn");
    expect(toastText(s, "en")).toBe("Kiri learned something new.");
    expect(toastText(s, "zh")).toBe("Kiri学会了新东西。");
    expect(tallyOf(useWorld.getState().world, "LESSON:0")).toBe(1);
    expect(useBadges.getState().ledger.lessons).toBe(1);
    expect(savedRoster(storage)?.pets[0]?.lessons).toEqual([lesson]);
  });

  it("a full pet can swap: it forgets its newest lesson and learns the new one, kept on the device (H5)", async () => {
    const { useGame, storage } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    useGame.getState().learn(lesson);
    expect(useGame.getState().swapLesson(0, another)).toEqual({ ok: true });
    expect(useGame.getState().pet?.lessons).toEqual([another]);
    expect(savedRoster(storage)?.pets[0]?.lessons).toEqual([another]);
  });

  it("a swap the new lesson cannot make leaves the pet exactly as it was", async () => {
    const { useGame } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    useGame.getState().learn(lesson);
    const before = useGame.getState().pet;
    // a rule that is not valid (no such event) is refused, and the forgotten lesson comes back
    expect(useGame.getState().swapLesson(0, { when: { event: [9] }, then: { want: 2, mood: 2 } } as Rule)).toMatchObject({ ok: false });
    expect(useGame.getState().pet).toEqual(before);
  });

  it("a baby holds one lesson; a refused lesson says why and leaves the pet as it was", async () => {
    const { useGame } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    useGame.getState().learn(lesson);
    const before = useGame.getState().pet;
    expect(useGame.getState().learn(another)).toEqual({ ok: false, reason: "full", detail: "a baby can hold 1 lessons" });
    expect(useGame.getState().pet).toBe(before);
  });

  it("the lesson slot a quest gives makes room for one more, and a lesson taught at the bottom is asked last", async () => {
    const { useGame, useWorld } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    useGame.getState().learn(lesson);
    useWorld.getState().flag("lesson-slot");
    expect(useGame.getState().learn(another, "bottom")).toEqual({ ok: true });
    expect(useGame.getState().pet?.lessons).toEqual([lesson, another]);
  });

  it("lessons can be moved up and down, and forgotten", async () => {
    const { useGame, useWorld } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    useWorld.getState().flag("lesson-slot");
    useGame.getState().learn(lesson);
    useGame.getState().learn(another);
    expect(useGame.getState().pet?.lessons).toEqual([another, lesson]);
    useGame.getState().arrange(1, "up");
    expect(useGame.getState().pet?.lessons).toEqual([lesson, another]);
    useGame.getState().arrange(0, "down");
    expect(useGame.getState().pet?.lessons).toEqual([another, lesson]);
    useGame.getState().arrange(0, "forget");
    expect(useGame.getState().pet?.lessons).toEqual([lesson]);
  });

  it("an owned circuit too big to travel with the pet's card is not taught (A26)", async () => {
    const { useGame } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    const before = useGame.getState().pet!;
    const huge = { ...owned, parts: [...owned.parts, { ...owned.parts[0]!, id: "999", hex: "0".repeat(CARD_OUTSIDE_MAX) }] };
    expect(useGame.getState().teachInstinct(huge)).toEqual({ ok: false, reason: "tooLong" });
    expect(useGame.getState().pet).toEqual(before);
  });

  it("an owned circuit that runs more gates each beat than an instinct may is not taught, and says how many (A38)", async () => {
    const { useGame } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    const before = useGame.getState().pet!;
    // eight REFs to a chain of NANDs one more than the budget allows across eight: 8 * 376 = 3,008 gates a beat
    const top = Array.from({ length: 8 }, (_, i) => ({ op: REF, ins: [2], cpu: CPU, id: 2n, nOut: 1, firstOut: 18 + i }));
    const chain = Array.from({ length: INSTINCT_MAX_GATES / 8 + 1 }, (_, i) => ({ op: 0, ins: i === 0 ? [2, 2] : [2 + i, 2 + i], nOut: 1, firstOut: 3 + i }));
    const wide: OutsideInstinct = { ...owned, parts: [{ processor: CPU, id: "1", nIn: 16, nOut: 8, hex: hex(encode(top as never)) }, { processor: CPU, id: "2", nIn: 1, nOut: 1, hex: hex(encode(chain as never)) }] };
    expect(useGame.getState().teachInstinct(wide)).toEqual({ ok: false, reason: "tooManyGates", gates: INSTINCT_MAX_GATES + 8 });
    expect(useGame.getState().pet).toEqual(before);
  });

  it("an owned circuit taught as an instinct answers beside the pet's own mind, and can be forgotten", async () => {
    const { useGame, brainOf, storage } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    const own = useGame.getState().pet!.brain.length;
    expect(useGame.getState().teachInstinct(owned)).toEqual({ ok: true });
    let pet = useGame.getState().pet!;
    expect(pet.outside).toEqual(owned);
    expect(pet.brain).toHaveLength(own + stateBits(instinctProgram));
    expect(brainOf(pet).instinct?.from).toBe(own);
    expect(toastText(useGame.getState(), "en")).toBe("Kiri learned something new.");
    expect(savedRoster(storage)?.pets[0]?.outside).toEqual(owned);

    useGame.getState().forgetInstinct();
    pet = useGame.getState().pet!;
    expect(pet.outside).toBeUndefined();
    expect(pet.brain).toHaveLength(own);
    // nothing left to forget
    useGame.getState().forgetInstinct();
    expect(useGame.getState().pet).toBe(pet);
  });

  it("a circuit that is not pet-shaped, or one whose memory with the pet's passes 64 bits, is refused", async () => {
    const { useGame } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    expect(useGame.getState().teachInstinct({ ...owned, parts: [{ ...owned.parts[0]!, hex: "zz" }] })).toEqual({ ok: false, reason: "badCircuit" });
    const big = validateProgram({ version: "LX-PET/1", memory: Array.from({ length: 12 }, (_, i) => ({ kind: "counter" as const, name: `c${i}`, bits: 4, inc: [{ event: [1] }] })), rules: [], otherwise: { want: 0, mood: 1 } });
    const bigHex = hex(encode(toElements(compileProgram(big))));
    const wrapper = hex(composeInstinct({ cpu: CPU, id: 10n }, { cpu: CPU, id: 11n }).bytes);
    const heavy: OutsideInstinct = {
      ...owned,
      parts: [
        { processor: CPU, id: "9", nIn: 16, nOut: 8, hex: wrapper },
        { processor: CPU, id: "10", nIn: 16, nOut: 8, hex: bigHex },
        { processor: CPU, id: "11", nIn: 16, nOut: 8, hex: bigHex },
      ],
    };
    expect(useGame.getState().teachInstinct(heavy)).toEqual({ ok: false, reason: "tooBig" });
    expect(useGame.getState().pet?.outside).toBeUndefined();
  });

  it("experience buys a level and a point, the point buys a skill, and a respec gives the points back", async () => {
    const { useGame, storage } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    expect(useGame.getState().levelUp()).toEqual({ ok: false, reason: "xp" });
    const pet = useGame.getState().pet!;
    useGame.getState().replace({ ...pet, xp: 9 });
    expect(useGame.getState().levelUp()).toEqual({ ok: true, level: 2 });
    expect(useGame.getState().pet?.growth).toMatchObject({ level: 2, points: 2 });
    expect(useGame.getState().learnSkill(111)).toEqual({ ok: true });
    expect(useGame.getState().learnSkill(112)).toEqual({ ok: true });
    expect(useGame.getState().learnSkill(113)).toEqual({ ok: false, reason: "points" });
    expect(useGame.getState().pet?.growth).toMatchObject({ points: 0, skills: { 111: 1, 112: 1 } });
    useGame.getState().respec();
    expect(useGame.getState().pet?.growth).toMatchObject({ points: 2, skills: {} });
    expect(savedRoster(storage)?.pets[0]?.growth).toMatchObject({ level: 2, points: 2, skills: {} });
  });
});

describe("the game store: care given on the handheld", () => {
  it("counts once, like care at home", async () => {
    const { useGame, useWorld, countCare } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    const pet = useGame.getState().pet!;
    countCare("feed", false, { pet, note: "ate" });
    expect(useGame.getState().daily.fed).toBe(true);
    expect(tallyOf(useWorld.getState().world, "CARE:feed")).toBe(1);
  });
});

describe("the client counts by the shared tally rules (G11)", () => {
  /** every count the world store is asked to add, as the shared rules write them */
  const capture = (useWorld: Awaited<ReturnType<typeof open>>["useWorld"]) => {
    const calls: TallyEntry[] = [];
    useWorld.setState({ tally: (type: string, index: number | string, n: number, opts: { total?: boolean } = {}) => void calls.push([type, index, n, opts.total !== false]) });
    return calls;
  };

  it("a care sends exactly what careTally says, and waking an awake pet sends nothing", async () => {
    const { useGame, useWorld, countCare } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    const pet = useGame.getState().pet!;
    const calls = capture(useWorld);
    for (const note of ["ate", "played", "petted", "listened"] as const) countCare("feed", false, { pet, note });
    countCare("wake", false, { pet, note: "awake" });
    const expected = (["ate", "played", "petted", "listened"] as const).flatMap((note) => careTally("feed", false, { pet, note }));
    expect(calls).toEqual(expected);
    expect(careTally("wake", false, { pet, note: "awake" })).toEqual([]);
  });

  it("a watched minute sends exactly what minuteTally says", async () => {
    const { useGame, useWorld, clock } = await open();
    useGame.getState().hatch("gentle", "Kiri");
    const calls = capture(useWorld);
    const before = useGame.getState().pet!;
    const after = { ...before, beat: before.beat + 1 };
    useGame.setState({ pet: after });
    expect(calls).toEqual(minuteTally(useWorld.getState().world.room, after, clock.now(), 1));
    expect(calls.some(([type]) => type === "TOGETHER")).toBe(true);
  });
});
