/**
 * G2: LX-SPAR/2, a fight with real strategy. A soft triangle (guard answers a pounce, a charm answers a guard, a pounce
 * punishes resting, snacking and charming), mood as a cost, strict stamina, and reading that pays. LX-SPAR/1 is kept
 * exactly for the spars already fought (spar.test.ts).
 */
import { describe, expect, it } from "vitest";
import { type FastBrain, inputField } from "@lingxi/brain";
import { type Rule, STARTERS } from "@lingxi/brain";
import { MOVES, SPAR_VERSION, type Fighter, type Move, spar } from "../src/spar";
import { CURRENT_SPAR, SPAR_V2, SPAR_V3, allowedMove, fight, spar2 } from "../src/spar2";
import V2_DESIGNED_JSON from "./fixtures/v2-designed-partners.json";
import { DESIGNED_PARTNERS as DESIGNED } from "../src/designedPartners";
import { PARTNERS } from "../src/partners";
import { fighterOfPartner } from "../src/coach";
import { SKILLS, sparMods } from "../src/skills";
import { SPAR_V3_FROM_WEEK, seasonSparVersion } from "../src/season";
import { SPAR_V3_FROM_DAY, dailySparVersion } from "../src/daily";
import { coach, fighterFrom, fighterOfMind } from "../src/coach";
import { LESSON_CAPACITY, composeProgram } from "../src/lessons";
import { behemothFighter } from "../src/builders";
import { READER } from "../scripts/sim90/field";

/** a brain that answers `pick(word)` as a move, at a mood (0 grumpy .. 3 excited) */
const brain = (pick: (word: number) => Move, mood = 1): FastBrain => ({ step: (_st: Uint8Array, word: number) => MOVES.indexOf(pick(word)) | (mood << 3) }) as unknown as FastBrain;
const fighter = (name: string, pick: (word: number) => Move, mood = 1): Fighter => ({ name, brain: brain(pick, mood), memory: [], level: 0 });
const always = (m: Move, mood = 1) => fighter(m, () => m, mood);
/** the other's last move as the 16-pin word shows it, read from the brain's own pin table */
const theirAction = (w: number) => (w >> inputField("action").lo) & ((1 << inputField("action").bits) - 1);
const winRate = (a: Fighter, b: Fighter, n = 200) => {
  let w = 0;
  for (let s = 1; s <= n; s++) if (now(a, b, s * 7919).winner === 0) w++;
  return w / n;
};

/** the fight new spars are fought in (LX-SPAR/3 since row B1) */
const now = (a: Fighter, b: Fighter, seed: number) => fight(CURRENT_SPAR, a, b, seed);

describe("the fight new spars are fought in (G2, B1)", () => {
  it("shows every move apart on the action pins, so a guard is not read as a rest", () => {
    const seen: number[] = [];
    now(fighter("watcher", (w) => (seen.push(theirAction(w)), "tap")), fighter("mover", (() => { let k = 0; return () => MOVES[k++ % MOVES.length]!; })()), 1);
    expect(new Set(seen.slice(1)).size).toBe(MOVES.length);
  });

  it("names its own version", () => {
    expect(now(always("tap"), always("tap"), 1).version).toBe(SPAR_V3);
  });

  it("is strict about stamina: no move without its full cost", () => {
    const r = now(always("pounce"), always("tap"), 3);
    for (let k = 1; k < r.rounds.length; k++) {
      const had = r.rounds[k - 1]!.stamina[0];
      if (r.rounds[k]!.moves[0] === "pounce") expect(had, `round ${k}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("a guard answers a pounce: the attacker staggers and loses stamina, and a guarding pet can win", () => {
    const r = now(always("pounce"), always("guard"), 5);
    const first = r.rounds[0]!;
    expect(first.moves).toEqual(["pounce", "guard"]);
    // the pounce's 3 and the stagger's 2
    expect(first.stamina[0]).toBe(10 - 5);
    expect(winRate(always("guard"), always("pounce"))).toBeGreaterThan(0.4);
  });

  it("a charm answers a guard, and a pounce punishes resting", () => {
    expect(winRate(always("charm"), always("guard"))).toBeGreaterThan(0.5);
    expect(winRate(always("pounce"), always("rest"))).toBeGreaterThan(0.9);
  });

  it("the triangle is soft: no single move beats every other always", () => {
    for (const m of MOVES) {
      const beaten = MOVES.filter((o) => o !== m && winRate(always(m), always(o), 60) >= 0.99);
      expect(beaten.length, m).toBeLessThan(MOVES.length - 1);
    }
  });

  it("mood is a trade, never free power: the same moves at any mood score 35-65% against them calm (B1)", () => {
    // a win 1, a draw a half, from both sides
    const score = (a: Fighter, b: Fighter, n = 150) => {
      let w = 0;
      for (let k = 0; k < n; k++) {
        const x = now(a, b, k * 7919 + 1).winner;
        const y = now(b, a, k * 7919 + 2).winner;
        w += (x === 0 ? 1 : x === -1 ? 0.5 : 0) + (y === 1 ? 1 : y === -1 ? 0.5 : 0);
      }
      return w / (2 * n);
    };
    const pacer = (mood: number) => fighter(`pacer${mood}`, (w) => (((w >> inputField("energy").lo) & 3) <= 1 ? "rest" : "pounce"), mood);
    for (const make of [pacer, (m: number) => always("pounce", m), (m: number) => always("tap", m)])
      for (const mood of [0, 2, 3]) {
        const v = score(make(mood), make(1));
        expect(v, `${make(mood).name} at mood ${mood}`).toBeGreaterThan(0.35);
        expect(v, `${make(mood).name} at mood ${mood}`).toBeLessThan(0.65);
      }
    // an excited hit is harder, and an excited pet takes harder hits; a calm one recovers while it taps
    expect(now(always("pounce", 3), always("tap"), 9).rounds[0]!.hits[0]).toBeGreaterThan(now(always("pounce", 1), always("tap"), 9).rounds[0]!.hits[0]);
    expect(now(always("tap"), always("pounce", 3), 9).rounds[0]!.hits[0]).toBeGreaterThan(now(always("tap"), always("pounce", 1), 9).rounds[0]!.hits[0]);
    expect(now(always("tap", 1), always("tap"), 9).rounds[0]!.stamina[0]).toBe(10);
  });

  it("reading pays: a brain that answers the last move beats one that repeats", () => {
    // the field's written reader (scripts/sim90/field.ts): it answers what the fight shows, nothing in it tuned to win
    // a win 1 and a draw a half (in LX-SPAR/3 a reader and a pouncer often end level: 180 wins, 110 losses, 110 draws)
    const reader = fighterFrom("reader", READER, 0);
    const score = (a: Fighter, b: Fighter, n = 200) => {
      let w = 0;
      for (let k = 1; k <= n; k++) {
        const x = now(a, b, k * 7919).winner;
        w += x === 0 ? 1 : x === -1 ? 0.5 : 0;
      }
      return w / n;
    };
    for (const m of ["pounce", "guard", "dodge", "rest", "snack", "charm", "tap"] as const) expect(score(reader, always(m)), m).toBeGreaterThan(0.55);
  });
});

/**
 * LX-SPAR/1 results recorded with the engine as it stood before G2 (recomputed from that commit's spar.ts and found
 * identical): the hand-written partners against each starter, and a pet with Spar skills. Every spar already fought
 * must replay to exactly these.
 */
const V1_PINS: [string, "gentle" | "bold" | "curious", number, string][] = [
  ["plush", "gentle", 7, "e9b98ac3"],
  ["plush", "gentle", 1009, "7f54b33f"],
  ["plush", "bold", 7, "65a6f9bb"],
  ["plush", "bold", 1009, "3eca67b8"],
  ["plush", "curious", 7, "cdd3d8b0"],
  ["plush", "curious", 1009, "277d59cb"],
  ["pip", "gentle", 7, "58bb71a1"],
  ["pip", "gentle", 1009, "56fb6706"],
  ["pip", "bold", 7, "088aa266"],
  ["pip", "bold", 1009, "883c45cb"],
  ["pip", "curious", 7, "381bb96f"],
  ["pip", "curious", 1009, "463c9d4c"],
  ["juniper", "gentle", 7, "8f7f7717"],
  ["juniper", "gentle", 1009, "a58457e0"],
  ["juniper", "bold", 7, "540f405d"],
  ["juniper", "bold", 1009, "126cf963"],
  ["juniper", "curious", 7, "a9dbb5eb"],
  ["juniper", "curious", 1009, "eecc86c1"],
  ["mallow", "gentle", 7, "97d78c52"],
  ["mallow", "gentle", 1009, "cd5695b5"],
  ["mallow", "bold", 7, "3820a3cb"],
  ["mallow", "bold", 1009, "05d98796"],
  ["mallow", "curious", 7, "7aa58bb1"],
  ["mallow", "curious", 1009, "643d1c95"],
  ["skilled", "bold", 77, "dddb58d4"]
];

describe("LX-SPAR/1 is kept for the spars already fought (G2)", () => {
  it("replays every recorded fight to the same fingerprint, directly and through the version switch", () => {
    const skilled = (): Fighter => ({ ...fighterFrom("s", STARTERS.bold, 1), mods: sparMods({ level: 40, points: 0, skills: { 411: 5, 412: 5, 421: 5, 422: 5, 423: 5, 431: 1 } }) });
    for (const [who, line, seed, digest] of V1_PINS) {
      const [a, b] = who === "skilled" ? [skilled(), fighterOfPartner(PARTNERS[1]!)] : [fighterFrom(line, STARTERS[line], 1), fighterOfPartner(PARTNERS.find((p) => p.id === who)!)];
      expect(spar(a, b, seed).digest, `${who} ${line} ${seed}`).toBe(digest);
      expect(fight(SPAR_VERSION, a, b, seed).digest).toBe(digest);
      expect(fight(SPAR_VERSION, a, b, seed).version).toBe(SPAR_VERSION);
    }
  });

  it("checks a brain's answer with the stamina rule of the spar's own version", () => {
    const pounce = MOVES.indexOf("pounce") | (1 << 3);
    expect(allowedMove(SPAR_VERSION, pounce, 1)).toBe("pounce");
    expect(allowedMove(SPAR_VERSION, pounce, 0)).toBe("rest");
    expect(allowedMove(SPAR_V2, pounce, 2)).toBe("rest");
    expect(allowedMove(SPAR_V2, pounce, 3)).toBe("pounce");
    // an excited pet pays one more
    expect(allowedMove(SPAR_V2, MOVES.indexOf("pounce") | (3 << 3), 3)).toBe("rest");
  });

  it("switches shared fights on a set day: the season from week 2026-W48, the daily challenge from 23 November 2026", () => {
    expect(seasonSparVersion("2026-W47")).toBe(SPAR_VERSION);
    expect(seasonSparVersion(SPAR_V3_FROM_WEEK)).toBe(SPAR_V3);
    expect(seasonSparVersion("2027-W02")).toBe(SPAR_V3);
    expect(dailySparVersion(SPAR_V3_FROM_DAY - 1)).toBe(SPAR_VERSION);
    expect(dailySparVersion(SPAR_V3_FROM_DAY)).toBe(SPAR_V3);
  });
});

describe("Spar skills tilt a fight and never decide it (G2, G8 item 4)", () => {
  const only = (want: number): Fighter => ({ ...fighterFrom(`only${want}`, composeProgram("gentle", []), 1), brain: brain(() => MOVES[want]!) });
  const rate = (a: Fighter, b: Fighter, n = 300) => {
    let w = 0;
    for (let s = 0; s < n; s++) if (fight(CURRENT_SPAR, a, b, s * 7919 + 3).winner === 0) w++;
    return w / n;
  };
  const skilled = (f: Fighter, skills: Record<number, number>): Fighter => ({ ...f, mods: sparMods({ level: 99, points: 0, skills }) });
  const reader = fighterFrom("reader", READER, 1);
  const pouncer = only(MOVES.indexOf("pounce"));

  it("every rank skill at five points changes the result, on a pet that makes its move", () => {
    const user: Record<string, [Fighter, Fighter]> = {
      SPAR_POWER: [reader, reader],
      SPAR_HP: [reader, reader],
      SPAR_STAMINA: [reader, reader],
      SPAR_GUARD: [only(MOVES.indexOf("guard")), pouncer],
      SPAR_DODGE: [only(MOVES.indexOf("dodge")), pouncer],
      SPAR_HEAL: [reader, pouncer],
    };
    for (const s of SKILLS.filter((k) => k.tree === "spar" && k.max === 5 && user[k.effect])) {
      const [me, them] = user[s.effect]!;
      const gain = rate(skilled(me, { [s.id]: 5 }), them) - rate(me, them);
      expect(gain, s.name.en).toBeGreaterThan(0.01);
      expect(gain, s.name.en).toBeLessThan(0.15);
    }
  });

  it("a whole Spar tree, on a fight-reading brain, beats the same brain unskilled in 60 to 80% of spars", () => {
    const ranks = Object.fromEntries(SKILLS.filter((k) => k.tree === "spar" && k.max === 5).map((k) => [k.id, 5]));
    for (const caps of [[431, 461], [432, 462], [431, 462], [432, 461]]) {
      const r = rate(skilled(reader, { ...ranks, [caps[0]!]: 1, [caps[1]!]: 1 }), reader, 1200);
      expect(r, caps.join("+")).toBeGreaterThan(0.6);
      expect(r, caps.join("+")).toBeLessThan(0.8);
    }
  });
});


describe("the coach's advice wins in practice (G2)", () => {
  it("a lesson the coach suggests wins more spars on seeds it never practised on, against every hand-written partner", () => {
    const fresh = Array.from({ length: 120 }, (_, i) => 900_001 + i * 104_729);
    const wins = (lessons: Rule[], line: "gentle" | "bold" | "curious", opp: () => Fighter) => fresh.filter((s) => fight(CURRENT_SPAR, fighterOfMind("me", { line, lessons }, 0), opp(), s).winner === 0).length;
    let suggested = 0;
    for (const p of PARTNERS) for (const line of ["gentle", "bold", "curious"] as const) {
      const opp = () => fighterOfPartner(p);
      const result = fight(CURRENT_SPAR, fighterOfMind("me", { line, lessons: [] }, 0), opp(), 4242);
      if (result.winner === 0) continue;
      const note = coach({ result, side: 0, line, stage: "child", lessons: [], level: 0, opponent: opp() });
      if (!note.lesson) continue;
      suggested++;
      expect(wins([note.lesson.rule], line, opp), `${line} vs ${p.id}: ${note.lesson.id}`).toBeGreaterThan(wins([], line, opp));
    }
    expect(suggested).toBeGreaterThan(3);
  });
});

describe("the coach's suggestion never makes a pet worse (G2, B3)", () => {
  it("holds where a coach of 24 practice spars and no margin made a pet worse (curious against Mallow fell from 142 to 106 of 200)", () => {
    const fresh = Array.from({ length: 200 }, (_, i) => 300_007 + i * 7919);
    const oppOf = (id: string): Fighter => (id === "behemoth" ? behemothFighter("Behemoth") : fighterOfPartner([...PARTNERS, ...DESIGNED].find((p) => p.id === id)!));
    const cases = [["mallow", "curious", "child", 8], ["mallow", "curious", "adult", 8], ["velvet", "bold", "child", 10], ["behemoth", "gentle", "child", 16], ["behemoth", "bold", "child", 3], ["behemoth", "bold", "adult", 24], ["behemoth", "bold", "child", 27]] as const;
    for (const [id, line, stage, seed] of cases) {
      const level = stage === "adult" ? 1 : 0;
      const me = fighterOfMind("me", { line, lessons: [] }, level);
      const result = fight(CURRENT_SPAR, me, oppOf(id), seed);
      const note = coach({ result, side: 0, line, stage, lessons: [], level, opponent: oppOf(id) });
      if (!note.lesson) continue;
      const wins = (f: Fighter) => fresh.filter((s) => fight(CURRENT_SPAR, f, oppOf(id), s).winner === 0).length;
      expect(wins(fighterOfMind("me", { line, lessons: [note.lesson.rule] }, level)), `${line} ${stage} vs ${id}, seed ${seed}: ${note.lesson.id}`).toBeGreaterThanOrEqual(wins(me));
    }
  }, 120_000);

  it("against every partner and Behemoth, for every line as a child and an adult, a suggested lesson keeps or raises the wins on 200 unseen seeds", () => {
    const fresh = Array.from({ length: 200 }, (_, i) => 300_007 + i * 7919);
    const opps: [string, () => Fighter][] = [...PARTNERS, ...DESIGNED].map((p) => [p.id, () => fighterOfPartner(p)] as [string, () => Fighter]);
    opps.push(["behemoth", () => behemothFighter("Behemoth")]);
    const wins = (me: Fighter, opp: () => Fighter) => fresh.filter((s) => fight(CURRENT_SPAR, me, opp(), s).winner === 0).length;
    let suggested = 0;
    for (const [id, opp] of opps)
      for (const line of ["gentle", "bold", "curious"] as const)
        for (const [stage, level] of [["child", 0], ["adult", 1]] as const) {
          const me = fighterOfMind("me", { line, lessons: [] }, level);
          // the coach is asked after a lost spar: the first of these seeds the pet loses
          const result = [4242, 4243, 4244, 4245, 4246].map((seed) => fight(CURRENT_SPAR, me, opp(), seed)).find((r) => r.winner !== 0);
          if (!result) continue;
          const note = coach({ result, side: 0, line, stage, lessons: [], level, opponent: opp() });
          if (!note.lesson) continue;
          suggested++;
          expect(wins(fighterOfMind("me", { line, lessons: [note.lesson.rule] }, level), opp), `${line} ${stage} vs ${id}: ${note.lesson.id}`).toBeGreaterThanOrEqual(wins(me, opp));
        }
    expect(suggested).toBeGreaterThan(20);
  }, 120_000);
});

/** LX-SPAR/2 fingerprints recorded before the rules table (row B1) and found identical after it: duel links answered in v2 replay. */
/** the four designed partners as they were when LX-SPAR/2 was current (they were searched again for LX-SPAR/3) */
const V2_DESIGNED = V2_DESIGNED_JSON as unknown as Parameters<typeof fighterOfPartner>[0][];
/** Behemoth as it fought while LX-SPAR/2 was current: level 2, happy (B1 made it calm) */
const behemothAtLevel = (level: number): Fighter => {
  const b = behemothFighter("Behemoth");
  return { ...b, level, brain: { ...b.brain, step: (st: Uint8Array, w: number) => (b.brain.step(st, w) & 7) | (2 << 3) } };
};
const V2_PINS: [number, number, number, string][] = [
  [0, 0, 7, "b964733f"],
  [0, 0, 1009, "0d179b76"],
  [0, 1, 7, "33e7d50b"],
  [0, 1, 1009, "30eb0b42"],
  [0, 2, 7, "f64cbb85"],
  [0, 2, 1009, "141bf40e"],
  [0, 3, 7, "63806574"],
  [0, 3, 1009, "7d26b0c3"],
  [0, 4, 7, "67714889"],
  [0, 4, 1009, "becfcdc1"],
  [0, 5, 7, "6e46a928"],
  [0, 5, 1009, "a8fd9384"],
  [0, 6, 7, "f2955d25"],
  [0, 6, 1009, "7e826d87"],
  [0, 7, 7, "d64cf27f"],
  [0, 7, 1009, "0dece808"],
  [0, 8, 7, "2c8bc5a8"],
  [0, 8, 1009, "3dba6508"],
  [1, 0, 7, "bf76229a"],
  [1, 0, 1009, "46689a01"],
  [1, 1, 7, "e57f5207"],
  [1, 1, 1009, "29d8a412"],
  [1, 2, 7, "758c19e4"],
  [1, 2, 1009, "70613ed7"],
  [1, 3, 7, "b58eba81"],
  [1, 3, 1009, "e99ad6b1"],
  [1, 4, 7, "7fd671cc"],
  [1, 4, 1009, "96764b70"],
  [1, 5, 7, "09a54426"],
  [1, 5, 1009, "fa6317c8"],
  [1, 6, 7, "1b27b237"],
  [1, 6, 1009, "0a25cfbf"],
  [1, 7, 7, "af617395"],
  [1, 7, 1009, "bc577879"],
  [1, 8, 7, "e4a4d43b"],
  [1, 8, 1009, "2ab7e0b5"],
  [2, 0, 7, "0ddfc039"],
  [2, 0, 1009, "c7bfa65a"],
  [2, 1, 7, "f35a54c6"],
  [2, 1, 1009, "e96cfe13"],
  [2, 2, 7, "14ac69bf"],
  [2, 2, 1009, "8a897e09"],
  [2, 3, 7, "fe176acf"],
  [2, 3, 1009, "be1c289e"],
  [2, 4, 7, "4abaecdf"],
  [2, 4, 1009, "583164bc"],
  [2, 5, 7, "49b06b91"],
  [2, 5, 1009, "7781f01a"],
  [2, 6, 7, "0f6fbb1c"],
  [2, 6, 1009, "0b04eb1f"],
  [2, 7, 7, "25788f64"],
  [2, 7, 1009, "84c1c8d1"],
  [2, 8, 7, "ce321ef9"],
  [2, 8, 1009, "5091ec3f"],
  [3, 0, 7, "505b2d20"],
  [3, 0, 1009, "b67844c7"],
  [3, 1, 7, "c073c66e"],
  [3, 1, 1009, "3937254a"],
  [3, 2, 7, "41d90d87"],
  [3, 2, 1009, "60cc548d"],
  [3, 3, 7, "5cb84536"],
  [3, 3, 1009, "8ba820b8"],
  [3, 4, 7, "2548c293"],
  [3, 4, 1009, "ad5146da"],
  [3, 5, 7, "966c6974"],
  [3, 5, 1009, "7c46be6d"],
  [3, 6, 7, "fd2e1f8c"],
  [3, 6, 1009, "892d6ce9"],
  [3, 7, 7, "015e62ee"],
  [3, 7, 1009, "72c6ff5d"],
  [3, 8, 7, "6bb16b8d"],
  [3, 8, 1009, "e561ea17"],
  [4, 0, 7, "c0d4229a"],
  [4, 0, 1009, "abacd001"],
  [4, 1, 7, "448767ff"],
  [4, 1, 1009, "11055d05"],
  [4, 2, 7, "2e37225a"],
  [4, 2, 1009, "81ceac2c"],
  [4, 3, 7, "55433622"],
  [4, 3, 1009, "1a4b8967"],
  [4, 4, 7, "af445c8e"],
  [4, 4, 1009, "dc49c0d9"],
  [4, 5, 7, "306916f9"],
  [4, 5, 1009, "fd732474"],
  [4, 6, 7, "e245d2a7"],
  [4, 6, 1009, "0efbc0a0"],
  [4, 7, 7, "5a0ba035"],
  [4, 7, 1009, "affbcbaa"],
  [4, 8, 7, "4f9d34ea"],
  [4, 8, 1009, "ffd91ec5"]
];

describe("LX-SPAR/2 is kept for the spars fought in it (B1)", () => {
  it("replays every recorded v2 fight to the same fingerprint", () => {
    const pets = [...(["gentle", "bold", "curious"] as const).map((l) => fighterFrom(l, STARTERS[l], 1)), fighterFrom("reader", READER, 1), { ...fighterFrom("sk", STARTERS.bold, 1), mods: sparMods({ level: 60, points: 0, skills: { 411: 5, 412: 5, 413: 5, 421: 5, 422: 5, 423: 5, 431: 1, 462: 1 } }) }];
    const opps = [...PARTNERS.map(fighterOfPartner), ...V2_DESIGNED.map(fighterOfPartner), behemothAtLevel(2)];
    for (const [i, j, seed, digest] of V2_PINS) {
      expect(spar2(pets[i]!, opps[j]!, seed, () => [seed === 7, false]).digest, `${i} ${j} ${seed}`).toBe(digest);
      expect(fight(SPAR_V2, pets[i]!, opps[j]!, seed, () => [seed === 7, false]).version).toBe(SPAR_V2);
    }
  });
});


describe("the coach with a full mind (B2)", () => {
  it("names a lesson to swap out when nothing it has room for helps, and the swap wins more on fresh seeds", () => {
    const fresh = Array.from({ length: 120 }, (_, i) => 500_009 + i * 7919);
    let swaps = 0;
    for (const p of PARTNERS) for (const line of ["gentle", "bold", "curious"] as const) {
      // a baby holds one lesson: give it one that is no help in a fight
      const lessons: Rule[] = [{ when: { time: [0], owner: [1] }, then: { want: 1, mood: 0 } } as Rule];
      const opp = () => fighterOfPartner(p);
      const result = fight(CURRENT_SPAR, fighterOfMind("me", { line, lessons }, 0), opp(), 4242);
      if (result.winner === 0) continue;
      const note = coach({ result, side: 0, line, stage: "baby", lessons, level: 0, opponent: opp() });
      if (!note.lesson) continue;
      expect(note.replace, `${line} vs ${p.id}`).toBe(0);
      swaps++;
      const wins = (ls: Rule[]) => fresh.filter((s) => fight(CURRENT_SPAR, fighterOfMind("me", { line, lessons: ls }, 0), opp(), s).winner === 0).length;
      expect(wins([note.lesson.rule]), `${line} vs ${p.id}`).toBeGreaterThan(wins(lessons));
    }
    expect(swaps).toBeGreaterThan(3);
  }, 120_000);
});
