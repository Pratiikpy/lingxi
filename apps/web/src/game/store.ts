/**
 * The game on this device: the pet, its compiled brain, and the guest save.
 * Progress lives in the browser (guest play); connecting a wallet later keeps
 * the same pet and starts writing daily checkpoints on chain.
 */

import { CARE_METRIC, useBadges } from "./badges";
import { noteEvent, noteTallies, noteTally, questSlots } from "./tally";
import { saveWrite } from "./saveRuntime";
import { MAX_PETS, type Roster, keptName, readRoster, rosterText } from "./roster";
import { dayAtLeast } from "./days";
import { now as gameNow } from "./gameClock";

/** The picture of what was eaten: the item's own art, or the starter food's. */
function foodArt(c: Care, art?: string): string | undefined {
  if (art) return art;
  return c.kind === "feed" && typeof c.food === "string" ? FOODS.find((f) => f.id === c.food)?.art : undefined;
}

/** Stage as the "Growing up" badge counts it: child 2, teen 3, adult 4. */
const STAGE_RANK: Record<string, number> = { baby: 1, child: 2, teen: 3, adult: 4, elder: 4 };

/**
 * What a care counts for: quest and daily tallies, badges, today's care marks. The same whether the care was given
 * at home or on the handheld (plan 4.14), so care given anywhere counts once.
 */
export function countCare(kind: Care["kind"], wasAsleep: boolean, r: CareResult): void {
  // the tally counts what care actually did (plan 4.1), by the rules the simulator counts by too (G11)
  const counted = careTally(kind, wasAsleep, r);
  noteTallies(counted);
  if (counted.some(([, index]) => index === "pet") && takeComfort()) noteEvent("comforted");
  const metric = CARE_METRIC[r.note];
  if (metric) {
    const b = useBadges.getState();
    b.note("care");
    b.note(metric);
    b.note("kinship", kinshipNow(r.pet, r.pet.beat));
    b.note("stage", STAGE_RANK[stageOf(r.pet, gameNow())] ?? 0);
  }
  const g = useGame.getState();
  // a day only moves forward: a clock turned back keeps today's card instead of handing out a fresh one (days.ts)
  const day = dayAtLeast(todayKey(), g.daily.day);
  const d = g.daily.day === day ? { ...g.daily } : { ...freshDaily(), day };
  if (kind === "feed" && r.note !== "overfed") d.fed = true;
  if (kind === "play" && r.note === "played") d.played = true;
  if (kind === "clean") d.cleaned = true;
  if (kind === "pet") d.petted = true;
  saveDaily(d);
  useGame.setState({ daily: d });
}
import { create } from "zustand";
import { type Program, type Rule, STARTERS, WANTS, compileProgram, fastBrain, inputField, stateBits } from "@lingxi/brain";
import { FOODS, careTally, firstThought, lessonTrigger, stagedEvent, type Brain, type Care, type CareResult, type Growth, type Pet, type UpgradeRefusal, arrangeLessons, care, catchUp, composeProgram, createPet, halvesOf, kinshipNow, learnSkill, levelUpPet, liveBeat, mindBrain, respecPet, ruleSkillIds, settleForm, skillRules, stageOf, teach as teachRule, awayEvent, awaySeed, beatOf, watchEvent, instinctBrain, instinctGates, INSTINCT_MAX_GATES, MAX_MIND_STATE, type OutsideInstinct, instinctFits, stripHidden, withSegment, boundLog, ruleGrowth, type Mind } from "@lingxi/game";
import type { StarterLine } from "@lingxi/brain";
import { takeComfort } from "./comfort";

const OLD_KEY = "lingxi.pet.v1";
const SAVE_KEY = "lingxi.pets.v2";
/** the most pets one player keeps on this device */
export { MAX_PETS };

/** An absence: which pet, and the beats it spanned. */
export interface Away {
  petKey: string;
  from: number;
  to: number;
}

const brains = new Map<string, Brain>();
/** The pet's whole program: what it was taught, the instincts it hatched with, its skill rules, then its egg line's starter rules. */
/** The mind a pet ran for a stretch of its log (its lessons, owned instinct and skills then): what Rewind replays with. */
export const mindForPet =
  (pet: Pet) =>
  (lessons: Rule[], outside?: OutsideInstinct, skills?: number[]): Mind => ({
    ...(pet.family ? { halves: halvesOf(pet.family, lessons, skillRules(ruleGrowth(skills))) } : { program: programFor(pet.line, lessons, pet.instincts ?? 0, ruleGrowth(skills)) }),
    ...(outside ? { outside } : {}),
  });

/**
 * Whether a pet is kept on X Layer, as the chain module knows (it registers this when it loads; the store cannot import
 * it). Until it does, every pet counts as kept, so no log is ever cut on a guess.
 */
let keptOnChain: (p: Pet) => boolean = () => true;
export function whenKeptOnChain(check: (p: Pet) => boolean): void {
  keptOnChain = check;
}

export function programFor(line: StarterLine, lessons: readonly Rule[] = [], instincts = 0, growth?: Growth): Program {
  const rules = skillRules(growth);
  return lessons.length || instincts || rules.length ? composeProgram(line, lessons, instincts, { rules }) : STARTERS[line];
}
export function brainFor(line: StarterLine, lessons: readonly Rule[] = [], instincts = 0, growth?: Growth): Brain {
  const key = line + instincts + JSON.stringify(lessons) + ruleSkillIds(growth).join(",");
  let b = brains.get(key);
  if (!b) {
    const p = programFor(line, lessons, instincts, growth);
    b = { fast: fastBrain(compileProgram(p)), nState: stateBits(p), program: p };
    brains.set(key, b);
  }
  return b;
}
export interface MindPart {
  program: Program;
  /** where this part's memory starts in the pet's memory bits */
  offset: number;
  /** for a child: which parent this half comes from and when it decides */
  from?: { name: string; when: "day" | "night" };
}

/** A pet's mind as the screens show it: one program, or a child's day half and night half. */
export function mindParts(pet: Pet): MindPart[] {
  if (!pet.family) return [{ program: programFor(pet.line, pet.lessons, pet.instincts, pet.growth), offset: 0 }];
  const [a, b] = halvesOf(pet.family, pet.lessons, skillRules(pet.growth));
  return [
    { program: a, offset: 0, from: { name: pet.family.parents[0].name, when: "day" } },
    { program: b, offset: stateBits(a), from: { name: pet.family.parents[1].name, when: "night" } },
  ];
}

/** The part of the mind that made the last decision. */
export function decidingPart(pet: Pet): MindPart {
  const parts = mindParts(pet);
  return parts[pet.last.half ?? 0] ?? parts[0]!;
}

/** Any pet's brain, including a child built from two parents. */
export const brainOf = (p: Pet): Brain => (p.family || p.outside ? mindBrain({ line: p.line, lessons: p.lessons ?? [], family: p.family, instincts: p.instincts, outside: p.outside, growth: p.growth }) : brainFor(p.line, p.lessons ?? [], p.instincts ?? 0, p.growth));

/** Pets this build cannot read, kept exactly as saved and written back with every save (roster.ts, P1). */
let kept: unknown[] = [];
/** The names of the pets kept safe for a newer Lingxi, for the pets screen. */
export const keptPetNames = (): string[] => kept.map(keptName);

function loadRoster(): Roster {
  try {
    // a save from before families (OLD_KEY) becomes the first pet of the roster
    const r = readRoster(localStorage.getItem(SAVE_KEY), localStorage.getItem(OLD_KEY));
    kept = r.kept;
    return r.roster;
  } catch {
    // a save that will not parse was held at start and waits for the player's choice (save.ts); nothing writes over it
    return { active: 0, pets: [] };
  }
}

let roster: Roster = loadRoster();

function persist(): void {
  try {
    saveWrite(SAVE_KEY, rosterText(roster, kept));
  } catch {
    // storage full or blocked: the pets keep living in memory for this visit
  }
}

/** Saves the active pet (or adds the first one). A pet not kept on chain keeps the last thirty days of its log (A148). */
function save(given: Pet | null): void {
  if (!given) return;
  // never while it stays with a sitter or is away: its homecoming is checked against the log it left with
  const p = keptOnChain(given) || given.sitting || given.away ? given : boundLog(given, mindForPet(given));
  const pets = roster.pets.slice();
  if (pets.length === 0) pets.push(p);
  else pets[roster.active] = p;
  roster = { ...roster, pets };
  persist();
}

export interface Toast {
  id: number;
  note: CareResult["note"] | "tooTired" | "asleepTap" | "learned" | "saved";
}

export interface Daily {
  day: string;
  fed: boolean;
  played: boolean;
  cleaned: boolean;
  petted: boolean;
}

interface GameState {
  /** the pet on screen */
  pet: Pet | null;
  pets: Pet[];
  active: number;
  /** look after another of your pets */
  switchTo: (index: number) => void;
  /** a newborn joins the family and comes on screen */
  adopt: (child: Pet) => boolean;
  /** a little one adopted from the adoption centre joins the roster (plan 4.8) */
  welcome: (p: Pet) => boolean;
  /** replace the active pet after something outside the store changed it (walking, breeding) */
  replace: (p: Pet) => void;
  /** change one pet, wherever it is in the roster (its log restarted when its hatch lands, A66) */
  rework: (bornAt: number, f: (p: Pet) => Pet) => void;
  /** a friend's pet comes to stay (pet-sitting): added to the roster without counting as a new pet of yours */
  guest: (p: Pet) => boolean;
  /** a pet leaves this device (a sat pet going home) */
  release: (bornAt: number) => void;
  toast: Toast | null;
  /** last care for the scene to animate */
  lastCare: { kind: Care["kind"] | "pet" | "learn"; at: number; food?: string } | null;
  daily: Daily;
  hatch: (line: StarterLine, name: string, instincts?: number) => void;
  /** a care action; `art` is the picture of the food or item used, for the room to show */
  act: (c: Care, art?: string) => void;
  tick: () => void;
  /** the last absence long enough to tell about, until the player has seen it */
  away: Away | null;
  /** the pet's own choices made while the player was away, last return (G8) */
  chose: Chose | null;
  /** G1: the living room's last event while watched (1 a friend, 2 a toy, 3 a noise) and performance.now() it came */
  roomEvent: { event: number; at: number } | null;
  /** B4: the light bulb after a lesson that answers an event: that event, staged in the beats after `from` */
  lightBulb: { event: number; from: number } | null;
  clearAway: () => void;
  wakeUp: () => void;
  say: (note: Toast["note"]) => void;
  /** add a lesson; returns why not when refused */
  /** teach a lesson; it goes on top (asked first) unless placed at the bottom */
  learn: (rule: Rule, at?: "top" | "bottom") => { ok: true } | { ok: false; reason: string; detail: string };
  /** a full pet learns a lesson in place of one it knows (H5): all or nothing, so a refusal changes nothing */
  swapLesson: (index: number, rule: Rule) => { ok: true } | { ok: false; reason: string; detail: string };
  arrange: (index: number, move: "up" | "down" | "forget") => void;
  /** X1: teach an owned circuit as an everyday instinct (ownership is checked by the caller), or forget it */
  teachInstinct: (o: OutsideInstinct) => { ok: true } | { ok: false; reason: "notYours" | "badCircuit" | "tooBig" | "tooLong" } | { ok: false; reason: "tooManyGates"; gates: number };
  forgetInstinct: () => void;
  /** levels and skills (plan 4.4): spend XP for a level and a point, take a skill, or forget them all */
  levelUp: () => { ok: true; level: number } | { ok: false; reason: "xp" | "max" };
  learnSkill: (id: number) => { ok: true } | { ok: false; reason: UpgradeRefusal };
  respec: () => void;
}

const todayKey = () => new Date(gameNow()).toDateString();
const freshDaily = (): Daily => ({ day: todayKey(), fed: false, played: false, cleaned: false, petted: false });
/** Today's four care marks in the header, kept so a reload does not wipe them (B6). */
const CARE_KEY = "lingxi.care.v1";
const isDaily = (v: unknown): v is Daily =>
  !!v && typeof v === "object" && typeof (v as Daily).day === "string" && (["fed", "played", "cleaned", "petted"] as const).every((k) => typeof (v as Daily)[k] === "boolean");
/** The marks kept for today, or a fresh card when they belong to another day or cannot be read. */
function loadDaily(): Daily {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CARE_KEY) ?? "null");
    return isDaily(v) && v.day === todayKey() ? v : freshDaily();
  } catch {
    return freshDaily();
  }
}
const saveDaily = (d: Daily): void => void saveWrite(CARE_KEY, JSON.stringify(d));

/** At least this long away (minutes) before the pet has a "while you were away" to tell. */
const AWAY_STORY_BEATS = 60;

/**
 * Bring a pet up to now after time away: every missed minute runs through its
 * brain, with the small surprises of an absence (see @lingxi/game away.ts).
 */
/** A pet lives by the time zone of the device it is on, as it is now: travel, and its mornings travel with it (P1 S6). */
function zoned(p: Pet): Pet {
  const tz = -new Date(gameNow()).getTimezoneOffset();
  return p.tzOffsetMin === tz ? p : { ...p, tzOffsetMin: tz };
}

/** What a pet chose of its own accord, awake, while the player was away: want → beats (G8). */
export interface Chose {
  id: number;
  petKey: string;
  wants: Record<string, number>;
}
let choseId = 0;

function returnTo(p: Pet): { pet: Pet; away: Away | null; chose: Chose | null } {
  // a pet staying with a friend is frozen here until it comes home
  if (p.away) return { pet: p, away: null, chose: null };
  const now = gameNow();
  const from = p.beat;
  const seed = awaySeed(p);
  // the pet's own choices while away count as its choices while watched do (G8)
  const wants: Record<string, number> = {};
  const pet = settleForm(
    catchUp(zoned(p), now, brainOf(p), (b) => awayEvent(seed, b), (want) => {
      const w = WANTS[want];
      if (w && w !== "idle") wants[w] = (wants[w] ?? 0) + 1;
    }),
    now,
  );
  const to = beatOf(now);
  const chose = Object.keys(wants).length ? { id: ++choseId, petKey: String(p.bornAt), wants } : null;
  return { pet, away: to - from >= AWAY_STORY_BEATS ? { petKey: String(p.bornAt), from, to } : null, chose };
}

let firstAway: Away | null = null;
let firstChose: Chose | null = null;
function initialPet(): Pet | null {
  const p = roster.pets[roster.active];
  if (!p) return null;
  const r = returnTo(p);
  firstAway = r.away;
  firstChose = r.chose;
  save(r.pet);
  return r.pet;
}

let toastId = 0;

export const useGame = create<GameState>((set, get) => ({
  pet: initialPet(),
  away: firstAway,
  chose: firstChose,
  roomEvent: null,
  lightBulb: null,
  clearAway: () => set({ away: null }),
  pets: roster.pets,
  active: roster.active,
  switchTo: (index) => {
    const target = roster.pets[index];
    if (!target || index === roster.active) return;
    roster = { ...roster, active: index };
    const r = returnTo(target);
    save(r.pet);
    set({ pet: r.pet, pets: roster.pets, active: index, lastCare: null, away: r.away, ...(r.chose ? { chose: r.chose } : {}) });
  },
  adopt: (child) => {
    if (roster.pets.length >= MAX_PETS) return false;
    roster = { active: roster.pets.length, pets: [...roster.pets, child] };
    persist();
    useBadges.getState().note("pets");
    useBadges.getState().note("children");
    noteEvent("child-born");
    set({ pet: child, pets: roster.pets, active: roster.active, lastCare: null });
    return true;
  },
  replace: (p) => {
    save(p);
    set({ pet: p, pets: roster.pets });
  },
  rework: (bornAt, f) => {
    const i = roster.pets.findIndex((x) => x.bornAt === bornAt);
    if (i < 0) return;
    const pets = roster.pets.slice();
    pets[i] = f(pets[i]!);
    roster = { ...roster, pets };
    persist();
    set({ pets: roster.pets, ...(i === roster.active ? { pet: pets[i]! } : {}) });
  },
  guest: (p) => {
    if (roster.pets.length >= MAX_PETS || roster.pets.some((x) => x.bornAt === p.bornAt)) return false;
    roster = { active: roster.pets.length, pets: [...roster.pets, p] };
    persist();
    set({ pet: p, pets: roster.pets, active: roster.active, lastCare: null });
    return true;
  },
  welcome: (p) => {
    if (roster.pets.length >= MAX_PETS || roster.pets.some((x) => x.bornAt === p.bornAt)) return false;
    roster = { active: roster.pets.length, pets: [...roster.pets, p] };
    persist();
    useBadges.getState().note("pets");
    noteEvent("adopted");
    set({ pet: p, pets: roster.pets, active: roster.active, lastCare: null });
    return true;
  },
  release: (bornAt) => {
    const pets = roster.pets.filter((x) => x.bornAt !== bornAt);
    if (pets.length === roster.pets.length) return;
    const active = Math.min(roster.active, Math.max(0, pets.length - 1));
    roster = { active, pets };
    persist();
    set({ pet: pets[active] ? returnTo(pets[active]!).pet : null, pets, active, lastCare: null });
  },
  toast: null,
  lastCare: null,
  daily: loadDaily(),
  hatch: (line, name, instincts = 0) => {
    const pet = createPet({
      // a character that shows as nothing is taken out: the name stays what the player can see (A16)
      name: stripHidden(name).trim().slice(0, 12) || "Mochi",
      line,
      now: gameNow(),
      tzOffsetMin: -new Date(gameNow()).getTimezoneOffset(),
      brain: brainFor(line, [], instincts),
      instincts,
    });
    // its first thought, so the room and the circuit show a real decision before the first minute ends (B5)
    const thinking = firstThought(pet, gameNow(), brainOf(pet));
    save(thinking);
    useBadges.getState().note("pets");
    const daily = freshDaily();
    saveDaily(daily);
    set({ pet: thinking, pets: roster.pets, daily });
  },
  act: (c, art) => {
    const { pet } = get();
    if (!pet || pet.away) return;
    const cleanBefore = Math.floor(pet.meters.clean / 60);
    const r = care(pet, c, gameNow(), brainOf(pet));
    save(r.pet);
    // cleaning up after a messy pet leaves compost for the garden (C4)
    if (c.kind === "clean" && r.note === "cleaned") void import("./world").then((m) => m.useWorld.getState().compost(cleanBefore));
    countCare(c.kind, pet.asleep, r);
    set({
      pet: r.pet,
      pets: roster.pets,
      lastCare: { kind: c.kind === "use" ? "feed" : c.kind, at: performance.now(), ...(foodArt(c, art) ? { food: foodArt(c, art)! } : {}) },
      toast: { id: ++toastId, note: r.note },
    });
  },
  tick: () => {
    const { pet } = get();
    if (!pet || pet.away) return;
    // a tab left hidden for a while comes back like any return, surprises included
    if (beatOf(gameNow()) - pet.beat > 10) return get().wakeUp();
    // a living room while you watch (G1): a friend, a toy or a noise now and then, the same input words the chain logs
    // right after a lesson that answers an event, that event is staged (B4); the word is logged like any other beat
    const staged = stagedEvent(get().lightBulb, beatOf(gameNow()));
    const next = settleForm(liveBeat(zoned(pet), gameNow(), brainOf(pet), staged ?? watchEvent(awaySeed(pet), beatOf(gameNow()))), gameNow());
    // what the room shows of it: the event this beat brought, from now (performance time, as the scene keeps)
    const event = next !== pet ? (next.last.word >> inputField("event").lo) & 3 : 0;
    if (event) set({ roomEvent: { event, at: performance.now() } });
    if (next !== pet) {
      if (stageOf(next, gameNow()) !== stageOf(pet, gameNow() - 60_000)) useBadges.getState().note("stage", STAGE_RANK[stageOf(next, gameNow())] ?? 0);
      save(next);
      set({ pet: next, pets: roster.pets });
    }
  },
  wakeUp: () => {
    const { pet } = get();
    if (!pet) return;
    const r = returnTo(pet);
    if (r.pet !== pet) {
      save(r.pet);
      set({ pet: r.pet, pets: roster.pets, ...(r.away ? { away: r.away } : {}), ...(r.chose ? { chose: r.chose } : {}) });
    }
  },
  say: (note) => set({ toast: { id: ++toastId, note } }),
  learn: (rule, at = "top") => {
    const { pet } = get();
    if (!pet) return { ok: false, reason: "invalid", detail: "no pet" };
    // a pet away cannot learn here, and a friend's pet is only taught by its owner
    if (pet.away || pet.sitting) return { ok: false, reason: "notYours", detail: "only its owner teaches it" };
    const caught = catchUp(pet, gameNow(), brainOf(pet));
    const r = teachRule(caught, rule, gameNow(), questSlots());
    if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail };
    if (at === "bottom") for (let i = 0; i < r.pet.lessons.length - 1; i++) r.pet = arrangeLessons(r.pet, i, "down");
    // one live beat with "talk" on the pins, so the new mind answers at once
    const after = care(r.pet, { kind: "talk" }, gameNow(), brainOf(r.pet)).pet;
    save(after);
    // the light-bulb moment (B4): a lesson that answers a friend, a toy or a noise has it arrive in the next beats
    const trigger = lessonTrigger(rule);
    set({ pet: after, pets: roster.pets, lastCare: { kind: "learn", at: performance.now() }, toast: { id: ++toastId, note: "learned" }, lightBulb: trigger.kind === "event" ? { event: trigger.event, from: after.beat } : null });
    useBadges.getState().note("lessons");
    noteTally("LESSON");
    return { ok: true };
  },
  swapLesson: (index, rule) => {
    const { pet } = get();
    if (!pet) return { ok: false, reason: "invalid", detail: "no pet" };
    if (index < 0 || index >= pet.lessons.length) return { ok: false, reason: "invalid", detail: "no such lesson" };
    const before = pet;
    set({ pet: arrangeLessons(pet, index, "forget") });
    const r = get().learn(rule, "top");
    if (!r.ok) {
      // the forgotten lesson comes back as it was, and nothing was saved without it
      save(before);
      set({ pet: before, pets: roster.pets });
    }
    return r;
  },
  arrange: (index, move) => {
    const { pet } = get();
    if (!pet) return;
    const next = arrangeLessons(pet, index, move);
    save(next);
    set({ pet: next, pets: roster.pets });
  },
  teachInstinct: (o) => {
    const { pet } = get();
    if (!pet) return { ok: false, reason: "badCircuit" };
    if (pet.away || pet.sitting) return { ok: false, reason: "notYours" };
    // a circuit its card could not carry would leave friends, seasons and duels reading an old card (A26)
    if (!instinctFits(o.parts)) return { ok: false, reason: "tooLong" };
    // a circuit too big to run each beat, counted before it is compiled (A38): every friend who meets the pet runs it too
    const gates = instinctGates(o);
    if (gates !== null && gates > INSTINCT_MAX_GATES) return { ok: false, reason: "tooManyGates", gates };
    const inst = instinctBrain(o);
    if (!inst) return { ok: false, reason: "badCircuit" };
    const caught = catchUp(pet, gameNow(), brainOf(pet));
    const own = brainOf({ ...caught, outside: undefined }).nState;
    if (own + inst.nState > MAX_MIND_STATE) return { ok: false, reason: "tooBig" };
    // the pet's own memory stays; the instinct's starts empty after it
    const taught = withSegment({ ...caught, outside: o, brain: [...caught.brain.slice(0, own), ...new Array(inst.nState).fill(0)] });
    const after = care(taught, { kind: "talk" }, gameNow(), brainOf(taught)).pet;
    save(after);
    set({ pet: after, pets: roster.pets, lastCare: { kind: "learn", at: performance.now() }, toast: { id: ++toastId, note: "learned" } });
    return { ok: true };
  },
  forgetInstinct: () => {
    const { pet } = get();
    if (!pet?.outside || pet.away || pet.sitting) return;
    const caught = catchUp(pet, gameNow(), brainOf(pet));
    const { outside: _gone, ...rest } = caught;
    const own = brainOf(rest as Pet).nState;
    const next = withSegment({ ...(rest as Pet), brain: caught.brain.slice(0, own) });
    save(next);
    set({ pet: next, pets: roster.pets });
  },
  levelUp: () => {
    const pet = get().pet;
    if (!pet) return { ok: false, reason: "xp" };
    const r = levelUpPet(catchUp(pet, gameNow(), brainOf(pet)));
    if (!r.ok) return r;
    save(r.pet);
    set({ pet: r.pet, pets: roster.pets });
    return { ok: true, level: r.level };
  },
  learnSkill: (id) => {
    const pet = get().pet;
    if (!pet) return { ok: false, reason: "noSkill" };
    // the pet is brought up to now on the brain it had, then the skill (which may change that brain) is taken
    const r = learnSkill(catchUp(pet, gameNow(), brainOf(pet)), id);
    if (!r.ok) return r;
    save(r.pet);
    set({ pet: r.pet, pets: roster.pets });
    return { ok: true };
  },
  respec: () => {
    const pet = get().pet;
    if (!pet) return;
    const next = respecPet(catchUp(pet, gameNow(), brainOf(pet)));
    save(next);
    set({ pet: next, pets: roster.pets });
  },
}));
