import { describe, expect, it } from "vitest";
import { STARTERS, compileProgram, decodeSenses, encodeSenses, fastBrain, gateCount, stateBits } from "@lingxi/brain";
import {
  BASE_GATES,
  type Brain,
  type Growth,
  LESSON_CAPACITY,
  MAX_GATES_SKILLED,
  SKILLS,
  SKILL_BY_ID,
  TIER_GATE,
  TREES,
  care,
  catchUp,
  checkMindLesson,
  composeProgram,
  createPet,
  exploreMods,
  fighterMods,
  fighterOfMind,
  gateBudget,
  growthOf,
  kinshipNow,
  extraLessons,
  learnSkill,
  levelOf,
  legalGrowth,
  levelCost,
  levelUpPet,
  logSegments,
  migrateGrowth,
  mindBrain,
  newGrowth,
  packState,
  parseCard,
  petCard,
  respec,
  respecPet,
  rewind,
  skillRules,
  spar,
  teach,
  treePoints,
  unpackState,
  upgrade,
  upgradeRefusal,
  withGrowth,
  visibleMeters,
  type Pet,
} from "../src";
import { BEAT_MS, DAY_MS, HIBERNATE_AFTER, SICK_AFTER } from "../src/pet";

/** two lesson capstones in different tiers: the most extra lessons a pet can hold */
const extraLessonsMax = SKILLS.filter((s) => s.effect === "LESSONS").reduce((n, s) => n + s.value, 0);

const T0 = Date.UTC(2026, 10, 16, 1, 0, 0); // 09:00 in UTC+8
const brainFor = (line: keyof typeof STARTERS): Brain => {
  const p = STARTERS[line];
  return { fast: fastBrain(compileProgram(p)), nState: stateBits(p), program: p };
};
const gentle = brainFor("gentle");
const newPet = (): Pet => createPet({ name: "Mochi", line: "gentle", now: T0, tzOffsetMin: 480, brain: gentle });
/** a growth with these skills, at the level they need (points all spent) */
const holding = (skills: Record<number, number>): Growth => {
  const spent = Object.values(skills).reduce((a, b) => a + b, 0);
  return { level: Math.max(1, spent), points: Math.max(0, 1 - spent), skills };
};
const withSkills = (p: Pet, skills: Record<number, number>): Pet => ({ ...p, growth: holding(skills) });

describe("the trees, copied from the source", () => {
  it("has four trees of six tiers by three: 72 skills", () => {
    expect(SKILLS).toHaveLength(72);
    for (const tree of TREES) for (let tier = 1; tier <= 6; tier++) expect(SKILLS.filter((s) => s.tree === tree && s.tier === tier)).toHaveLength(3);
    expect(new Set(SKILLS.map((s) => s.id)).size).toBe(72);
  });

  it("makes tiers 1, 2, 4 and 5 rank skills of five points and tiers 3 and 6 one-point capstones", () => {
    for (const s of SKILLS) expect(s.max).toBe(s.tier === 3 || s.tier === 6 ? 1 : 5);
  });

  it("writes every exclusion both ways (the source's 262 excluded itself, letting a pet hold two capstones)", () => {
    for (const s of SKILLS) {
      if (s.max !== 1) {
        expect(s.excludes).toEqual([]);
        continue;
      }
      expect(s.excludes).not.toContain(s.id);
      expect(s.excludes).toHaveLength(2);
      for (const x of s.excludes) expect(SKILL_BY_ID[x]!.excludes).toContain(s.id);
    }
  });

  it("opens tiers from one table", () => {
    expect(TIER_GATE).toEqual([0, 5, 15, 25, 40, 55]);
    let g = { ...newGrowth(), points: 100 };
    expect(upgradeRefusal(g, 121)).toEqual({ reason: "tier", need: 5, have: 0 });
    for (let i = 0; i < 5; i++) g = (upgrade(g, 111) as { growth: Growth }).growth;
    expect(treePoints(g, "care")).toBe(5);
    expect(upgradeRefusal(g, 121)).toBeNull();
    expect(upgradeRefusal(g, 111)).toEqual({ reason: "maxed" });
  });

  it("says why an upgrade is refused: maxed, tier closed, excluded, or no points", () => {
    let g: Growth = { level: 20, points: 20, skills: { 111: 5, 112: 5, 113: 5 } };
    expect(upgradeRefusal(g, 999)).toEqual({ reason: "noSkill" });
    g = (upgrade(g, 131) as { growth: Growth }).growth;
    expect(upgradeRefusal(g, 132)).toEqual({ reason: "excluded", by: 131 });
    expect(upgradeRefusal({ ...g, points: 0 }, 121)).toEqual({ reason: "points" });
  });

  it("never lets a tier hold two capstones, whatever the order of choices (property test)", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) % 1_000_000) / 1_000_000;
    for (let run = 0; run < 400; run++) {
      let g: Growth = { level: 99, points: 99, skills: {} };
      for (let k = 0; k < 160; k++) {
        const s = SKILLS[Math.floor(rnd() * SKILLS.length)]!;
        const r = upgrade(g, s.id);
        if (r.ok) g = r.growth;
      }
      for (const tree of TREES)
        for (const tier of [3, 6]) {
          const held = SKILLS.filter((s) => s.tree === tree && s.tier === tier && (g.skills[s.id] ?? 0) > 0);
          expect(held.length).toBeLessThanOrEqual(1);
        }
      expect(legalGrowth(g)).toBe(true);
    }
  });

  it("returns every point on a respec", () => {
    const g: Growth = { level: 12, points: 2, skills: { 111: 5, 112: 3, 121: 2 } };
    expect(respec(g)).toEqual({ level: 12, points: 12, skills: {} });
  });

  it("knows an allocation the rules could not have made", () => {
    expect(legalGrowth({ level: 3, points: 0, skills: { 111: 3 } })).toBe(true);
    expect(legalGrowth({ level: 3, points: 0, skills: { 121: 3 } })).toBe(false); // tier 2 with nothing below
    expect(legalGrowth({ level: 20, points: 3, skills: { 111: 5, 112: 5, 113: 5, 131: 1, 132: 1 } })).toBe(false); // two capstones
    expect(legalGrowth({ level: 5, points: 5, skills: { 111: 5 } })).toBe(false); // points do not add up
    expect(legalGrowth({ level: 6, points: 0, skills: { 111: 6 } })).toBe(false); // over the max
  });
});

describe("levels", () => {
  it("spends XP for a level and a point, as the source does", () => {
    const p = { ...newPet(), xp: levelCost(1) + 3 };
    const r = levelUpPet(p);
    if (!r.ok) throw new Error(r.reason);
    expect(r.pet.xp).toBe(3);
    expect(r.pet.growth).toEqual({ level: 2, points: 2, skills: {} });
    expect(levelUpPet(r.pet)).toEqual({ ok: false, reason: "xp" });
  });

  it("keeps the level an older pet showed, migrating its XP once", () => {
    // the old curve showed level 6 from 375 XP (25, 75, 150, 250, 375 were its thresholds)
    expect(migrateGrowth(400)).toEqual({ growth: { level: 6, points: 6, skills: {} }, xp: 25 });
    for (const xp of [0, 24, 25, 74, 75, 400, 5000, 65535]) expect(migrateGrowth(xp).growth.level).toBe(levelOf(xp).level);
    const old = { ...newPet(), xp: 400, growth: undefined };
    const p = withGrowth(old);
    expect(p.growth!.level).toBe(6);
    expect(withGrowth(p)).toBe(p);
  });

  it("is tuned by real play: a pet cared for every day reaches the last tier in weeks, and a first level on day one", () => {
    // a caring player's day, through the game's own care rules
    let p = newPet();
    let firstLevelDay = 0;
    let days = 0;
    let level = 1;
    let xp = 0;
    const day = (d: number) => {
      const at = (h: number, m = 0) => T0 + d * DAY_MS + (h - 9) * 3_600_000 + m * 60_000;
      const plan: Array<[number, number, Parameters<typeof care>[1]]> = [
        [9, 0, { kind: "feed", food: "sundae" }],
        [9, 2, { kind: "medicine" }],
        [9, 5, { kind: "play", stars: 2 }],
        [9, 10, { kind: "pet" }],
        [13, 0, { kind: "feed", food: "sundae" }],
        [13, 5, { kind: "play", stars: 2 }],
        [19, 0, { kind: "feed", food: "sundae" }],
        [19, 5, { kind: "clean" }],
        [19, 10, { kind: "play", stars: 3 }],
        [19, 15, { kind: "pet" }],
        [19, 20, { kind: "talk" }],
        [21, 50, { kind: "feed", food: "sundae" }],
        [22, 0, { kind: "lightsOff" }],
      ];
      for (const [h, m, c] of plan) p = care(p, c, at(h, m), gentle).pet;
    };
    const perDay: number[] = [];
    while (level < 56 && days < 365) {
      const before = p.xp;
      day(days);
      perDay.push(p.xp - before);
      xp += p.xp - before;
      while (level < 99 && xp >= levelCost(level)) {
        xp -= levelCost(level);
        level++;
        if (!firstLevelDay) firstLevelDay = days + 1;
      }
      days++;
    }
    expect(firstLevelDay).toBe(1);
    expect(perDay.every((x) => x === perDay[0])).toBe(true);
    expect(perDay[0]).toBe(27);
    // the last tier in weeks (the source's curve needs about 12 million XP by level 50)
    expect(days).toBeGreaterThanOrEqual(60);
    expect(days).toBeLessThanOrEqual(80);
  });

  it("keeps the level in the state word (bits 234-240)", () => {
    const p = { ...newPet(), growth: { level: 37, points: 0, skills: {} } };
    expect(unpackState(packState(p, "baby"), p.brain.length).level).toBe(37);
  });
});

describe("Care skills change the pet's life", () => {
  const hours = (p: Pet, h: number) => catchUp(p, T0 + h * 3_600_000, gentle);

  it("Full Belly, Good Spirits, Tidy Habits, Stamina and Evergreen slow each meter", () => {
    const base = visibleMeters(hours(newPet(), 6));
    for (const [id, meter] of [[111, "food"], [112, "joy"], [113, "clean"], [122, "energy"]] as const) {
      const m = visibleMeters(hours(withSkills(newPet(), { [id]: 5 }), 6));
      expect(m[meter]).toBeGreaterThan(base[meter]);
    }
    const ever = visibleMeters(hours(withSkills(newPet(), { 161: 1 }), 6));
    for (const k of ["food", "joy", "clean"] as const) expect(ever[k]).toBeGreaterThan(base[k]);
  });

  it("Deep Sleeper restores more energy while asleep", () => {
    const asleep = (p: Pet) => ({ ...p, asleep: true, meters: { ...p.meters, energy: 100 * 60 } });
    expect(visibleMeters(hours(asleep(withSkills(newPet(), { 121: 5 })), 3)).energy).toBeGreaterThan(visibleMeters(hours(asleep(newPet()), 3)).energy);
  });

  it("Hearty Eater fills more from food, Sunny Nature brings more joy from play, Bath Lover a bath's joy", () => {
    const hungry = (p: Pet) => ({ ...p, meters: { ...p.meters, food: 100 * 60, joy: 100 * 60 } });
    const fed = (p: Pet) => visibleMeters(care(hungry(p), { kind: "feed", food: "sundae" }, T0, gentle).pet);
    expect(fed(withSkills(newPet(), { 123: 5 })).food).toBeGreaterThan(fed(newPet()).food);
    const played = (p: Pet) => visibleMeters(care(hungry(p), { kind: "play", stars: 2 }, T0, gentle).pet).joy;
    expect(played(withSkills(newPet(), { 133: 1 }))).toBeGreaterThan(played(newPet()));
    const bath = (p: Pet) => visibleMeters(care(hungry(p), { kind: "clean" }, T0, gentle).pet).joy;
    expect(bath(withSkills(newPet(), { 141: 5 })) - bath(newPet())).toBe(50);
  });

  it("Iron Stomach and Hardy give more time before illness and hibernation", () => {
    const neglected = (p: Pet) => ({ ...p, meters: { ...p.meters, food: 0, clean: 0 } });
    const sickAt = (p: Pet) => {
      for (let h = 1; h < 48; h++) if (hours(neglected(p), h).sick) return h;
      return 99;
    };
    expect(sickAt(withSkills(newPet(), { 131: 1 }))).toBeGreaterThan(sickAt(newPet()));
    expect(sickAt(newPet())).toBe(SICK_AFTER / 60);
    const starved = (p: Pet) => ({ ...p, meters: { ...p.meters, food: 0 } });
    const hib = (p: Pet) => hours(starved(p), HIBERNATE_AFTER / 60 + 1).hibernating;
    expect(hib(newPet())).toBe(true);
    expect(hib(withSkills(newPet(), { 142: 5 }))).toBe(false);
  });

  it("Kin Keeper makes kinship fade more slowly", () => {
    const p = { ...newPet(), kinship: 5, kinBeat: 0 };
    const later = 3 * 24 * 60;
    expect(kinshipNow(withSkills(p, { 143: 5 }), later)).toBeGreaterThan(kinshipNow(p, later));
  });

  it("Quick Learner adds experience exactly, carrying fractions (+4% of 100 single points is 104)", () => {
    let a = newPet();
    let b = withSkills(newPet(), { 153: 1 });
    for (let i = 0; i < 100; i++) {
      a = care(a, { kind: "talk" }, T0 + i * BEAT_MS, gentle).pet;
      b = care(b, { kind: "talk" }, T0 + i * BEAT_MS, gentle).pet;
    }
    expect(b.xp - a.xp).toBe(4);
  });

  it("Early to Bed and Cuddle Bug add their rule to the circuit, and the circuit answers differently", () => {
    const word = encodeSenses({ hunger: 0, joy: 2, energy: 1, clean: 2, time: 3, action: 5, event: 0, owner: 1 });
    const want = (g?: Growth) => {
      const b = mindBrain({ line: "gentle", lessons: [], growth: g });
      return b.fast.step(new Uint8Array(b.nState), word) & 7;
    };
    expect(want(holding({ 162: 1 }))).toBe(6);
    expect(skillRules(holding({ 132: 1 }))[0]!.then.want).toBe(3);
    const tired = encodeSenses({ hunger: 0, joy: 1, energy: 0, clean: 2, time: 3, action: 0, event: 0, owner: 0 });
    const b = mindBrain({ line: "bold", lessons: [], growth: holding({ 132: 1 }) });
    expect(b.fast.step(new Uint8Array(b.nState), tired) & 7).toBe(3);
    expect(decodeSenses(tired).time).toBe(3);
  });
});

describe("Mind skills widen the budget the circuit lives in", () => {
  const big = { label: "big", when: { hunger: [1], joy: [2], energy: [3], clean: [1], time: [2], action: [3], event: [2] }, then: { want: 2, mood: 2 } };

  it("Wide Mind and the rest raise the gate budget, and the relayer's ceiling is the most any pet can have", () => {
    expect(gateBudget(undefined)).toBe(BASE_GATES);
    expect(gateBudget(holding({ 211: 5, 221: 5, 233: 1 }))).toBe(BASE_GATES + 150);
    expect(MAX_GATES_SKILLED).toBe(BASE_GATES + 200 + 50 + 100);
  });

  it("Room to Learn and Room to Grow hold more lessons; then Wide Mind's gates are what let a full brain take one more", () => {
    // the effect, not the road to it: two growths that differ only in their gate skills
    const roomy = holding({ 231: 1, 261: 1, 243: 5, 253: 5 });
    const gated = holding({ 231: 1, 261: 1, 243: 5, 253: 5, 211: 5, 221: 5 });
    expect(extraLessons(roomy)).toBe(5);
    expect(gateBudget(gated) - gateBudget(roomy)).toBe(100);
    // grow a brain with distinct, many-condition lessons until the next would pass 500 gates
    const lessonAt = (i: number) => ({ when: { hunger: [i % 4, (i + 1) % 4], joy: [(i >> 2) % 4], energy: [(i >> 4) % 4, (i + 3) % 4], clean: [(i + 1) % 4], time: [(i + 2) % 4], action: [i % 8], event: [(i >> 1) % 4] }, then: { want: (i % 7) + 1, mood: i % 4 } });
    const lessons: ReturnType<typeof lessonAt>[] = [];
    let i = 0;
    while (gateCount(compileProgram(composeProgram("gentle", [lessonAt(i), ...lessons]))) <= BASE_GATES) lessons.unshift(lessonAt(i++));
    const next = lessonAt(i);
    expect(lessons.length + 1).toBeLessThanOrEqual(LESSON_CAPACITY.elder + 5);
    expect(lessons.length + 1).toBeGreaterThan(LESSON_CAPACITY.elder);
    expect(checkMindLesson({ line: "gentle", lessons }, "elder", next)).toMatchObject({ ok: false, reason: "full" });
    expect(checkMindLesson({ line: "gentle", lessons, growth: roomy }, "elder", next)).toMatchObject({ ok: false, reason: "tooBig" });
    expect(checkMindLesson({ line: "gentle", lessons, growth: gated }, "elder", next).ok).toBe(true);
  });

  it("Warm Memory lets kinship grow sooner, Long Memory makes it fade more slowly", () => {
    // petted at hour 0 and again at hour 8: the second counts only with Warm Memory (12 hours otherwise)
    const twice = (p: Pet) => {
      const a = care(p, { kind: "pet" }, T0, gentle).pet;
      return care(a, { kind: "pet" }, T0 + 8 * 3_600_000, gentle).pet.kinship;
    };
    expect(twice(newPet())).toBe(1);
    expect(twice(withSkills(newPet(), { 212: 5 }))).toBe(2);
    const p = { ...newPet(), kinship: 5, kinBeat: 0 };
    expect(kinshipNow(withSkills(p, { 223: 5 }), 3 * 24 * 60)).toBeGreaterThan(kinshipNow(p, 3 * 24 * 60));
  });

  it("Deep Memory grows personality faster, carried exactly", () => {
    // a lesson that always nudges "gentle" when petted
    const lesson = { when: { action: [5] }, then: { want: 6, mood: 2, nudge: 6 } };
    const run = (g?: Growth) => {
      const brain = mindBrain({ line: "gentle", lessons: [lesson], growth: g });
      let p: Pet = { ...newPet(), lessons: [lesson], growth: g ?? newGrowth() };
      for (let i = 0; i < 10; i++) p = care(p, { kind: "pet" }, T0 + i * BEAT_MS, brain).pet;
      return p.traits.gentle;
    };
    expect(run()).toBe(10);
    expect(run(holding({ 211: 5, 212: 5, 213: 5, 231: 1, 242: 5 }))).toBe(15);
  });

  it("Extra Lesson holds one more lesson at every stage", () => {
    const full = Array.from({ length: LESSON_CAPACITY.baby }, (_, i) => ({ when: { hunger: [i] }, then: { want: 1, mood: 1 } }));
    const next = { when: { joy: [0] }, then: { want: 6, mood: 1 } };
    expect(checkMindLesson({ line: "gentle", lessons: full }, "baby", next)).toMatchObject({ ok: false, reason: "full" });
    expect(checkMindLesson({ line: "gentle", lessons: full, growth: holding({ 211: 5, 212: 5, 213: 5, 231: 1 }) }, "baby", next).ok).toBe(true);
  });

  it("Eager Student pays experience for each lesson taught", () => {
    const rule = { when: { joy: [0] }, then: { want: 6, mood: 1 } };
    const plain = teach(newPet(), rule, T0);
    const keen = teach(withSkills(newPet(), { 213: 5 }), rule, T0);
    if (!plain.ok || !keen.ok) throw new Error("teach");
    expect(keen.pet.xp - plain.pet.xp).toBe(10);
  });

  it("Brave Heart changes what the pet does when frightened with you near", () => {
    const scary = encodeSenses({ hunger: 0, joy: 2, energy: 2, clean: 2, time: 2, action: 0, event: 3, owner: 1 });
    const want = (g?: Growth) => {
      const b = mindBrain({ line: "curious", lessons: [], growth: g });
      return b.fast.step(new Uint8Array(b.nState), scary) & 7;
    };
    expect(want(holding({ 211: 5, 212: 5, 213: 5, 232: 1 }))).toBe(6);
  });
});

describe("Explore skills give the world its numbers for this pet (the world applies them: world/test/explore.test.ts)", () => {
  it("maps each Explore skill to the world's numbers", () => {
    expect(exploreMods(undefined)).toEqual({ moveEnergy: 15, forageEnergy: 10, extraFind: 0, rareBoost: 0, forageWaitOff: 0, walksWithFinds: 0, stepsOff: 0, visitCoins: 0, tripExtra: 0 });
    const all = exploreMods(holding({ 311: 5, 312: 5, 313: 5, 321: 5, 322: 5, 323: 5, 331: 1, 341: 5, 342: 5, 343: 5, 351: 5, 352: 5, 353: 5, 361: 1 }));
    expect(all).toEqual({ moveEnergy: 5, forageEnergy: 2, extraFind: 50, rareBoost: 80, forageWaitOff: 50, walksWithFinds: 0, stepsOff: 100, visitCoins: 20, tripExtra: 50 });
    expect(exploreMods(holding({ 332: 1, 363: 1, 362: 1 }))).toMatchObject({ walksWithFinds: 3, rareBoost: 40 });
  });
});

describe("Spar skills change a fight, and a pet without them fights exactly as before", () => {
  const me = (g?: Growth) => fighterOfMind("A", { line: "bold", lessons: [], growth: g }, 1);
  const them = fighterOfMind("B", { line: "gentle", lessons: [] }, 1);

  it("a pet with no spar skills carries no mods, so old fights replay to the same digest", () => {
    expect(fighterMods(undefined)).toBeUndefined();
    expect(fighterMods(holding({ 111: 5 }))).toBeUndefined();
    expect(spar(me(), them, 42).digest).toBe(spar(me(holding({ 111: 5 })), them, 42).digest);
  });

  it("Thick Fur, Second Breath, Strong Paws and the rest show in the fight", () => {
    const strong = me(holding({ 411: 5, 412: 5, 413: 5, 431: 1 }));
    expect(strong.mods).toEqual({ power: 2, hp: 20, stamina: 2, guard: 0, dodge: 0, heal: 0 });
    let wins = 0;
    let plainWins = 0;
    for (let s = 1; s <= 60; s++) {
      if (spar(strong, them, s).winner === 0) wins++;
      if (spar(me(), them, s).winner === 0) plainWins++;
    }
    expect(wins).toBeGreaterThan(plainWins);
    const r = spar(strong, them, 7);
    expect(r.rounds[0]!.hp[0]).toBeLessThanOrEqual(120);
  });

  it("guard, dodge and snack skills are applied", () => {
    const m = fighterMods(holding({ 421: 5, 422: 5, 423: 5, 433: 1 }))!;
    expect([m.guard, m.dodge, m.heal]).toEqual([20, 10, 5]);
  });
});

describe("skills on chain and in replay", () => {
  it("a rule skill starts a log segment that records it, and Rewind replays the brain with it", () => {
    let p = withGrowth({ ...newPet(), xp: 5000 });
    for (let i = 0; i < 20; i++) {
      const r = levelUpPet(p);
      if (r.ok) p = r.pet;
    }
    p = catchUp(p, T0 + 30 * BEAT_MS, gentle);
    for (const id of [211, 211, 211, 211, 211, 212, 212, 212, 212, 212, 213, 213, 213, 213, 213, 232]) {
      const r = learnSkill(p, id);
      if (!r.ok) throw new Error(`${id} ${r.reason}`);
      p = r.pet;
    }
    const segs = logSegments(p);
    expect(segs.at(-1)!.skills).toEqual([232]);
    // after the rule skill, the brain the pet runs includes it
    const brainNow = mindBrain({ line: p.line, lessons: p.lessons, growth: growthOf(p) });
    p = care(p, { kind: "pet" }, T0 + 40 * BEAT_MS, brainNow).pet;
    const frames = rewind(p, (lessons, _o, skills) => ({ program: composeProgram("gentle", lessons, 0, { rules: (skills ?? []).map((id) => SKILL_BY_ID[id]!.rule!) }) }));
    expect(frames.at(-1)!.program.rules.some((r) => r.label === "skill: brave heart")).toBe(true);
    expect(frames[0]!.program.rules.some((r) => r.label === "skill: brave heart")).toBe(false);
    // a respec takes the rule out again, in a new segment
    const back = respecPet(p);
    expect(logSegments(back).at(-1)!.skills).toBeUndefined();
  });

  it("a pet card carries its skills, and a card claiming skills the rules could not give is read without them", () => {
    const g: Growth = { level: 16, points: 0, skills: { 211: 5, 212: 5, 213: 5, 232: 1 } };
    const card = parseCard(petCard({ lessons: [], growth: g }));
    expect(card?.growth).toEqual(g);
    const forged = parseCard(petCard({ lessons: [], growth: { level: 2, points: 0, skills: { 263: 1, 211: 1 } } }));
    expect(forged?.growth).toBeUndefined();
  });

  it("the most a skilled pet can hold (13 lessons, 4 instincts, 4 capstone rules) still fits the rule limit on every line", () => {
    const lessons = Array.from({ length: 11 }, (_, i) => ({ when: { hunger: [i % 4], joy: [(i >> 2) % 4] }, then: { want: (i % 7) + 1, mood: 1 } }));
    const all = holding({ 162: 1, 232: 1, 262: 1, 132: 1 });
    for (const line of ["gentle", "bold", "curious"] as const) expect(() => composeProgram(line, [...lessons, lessons[0]!, lessons[1]!], 15, { rules: skillRules(all) })).not.toThrow();
    expect(extraLessonsMax).toBe(3);
    expect(LESSON_CAPACITY.elder + 5).toBe(13);
  });
});
