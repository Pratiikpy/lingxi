/**
 * G2: LX-SPAR/2, a fight with real strategy. A soft triangle (guard answers a pounce, a charm answers a guard, a pounce
 * punishes resting, snacking and charming), mood as a cost, strict stamina, and reading that pays. LX-SPAR/1 is kept
 * exactly for the spars already fought (spar.test.ts).
 */
import { describe, expect, it } from "vitest";
import { type FastBrain, inputField } from "@lingxi/brain";
import { type Rule, STARTERS } from "@lingxi/brain";
import { MOVES, SPAR_VERSION, type Fighter, type Move, spar } from "../src/spar";
import { SPAR_V2, allowedMove, fight, spar2 } from "../src/spar2";
import { PARTNERS } from "../src/partners";
import { fighterOfPartner } from "../src/coach";
import { SKILLS, sparMods } from "../src/skills";
import { SPAR_V2_FROM_WEEK, seasonSparVersion } from "../src/season";
import { SPAR_V2_FROM_DAY, dailySparVersion } from "../src/daily";
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
  for (let s = 1; s <= n; s++) if (spar2(a, b, s * 7919).winner === 0) w++;
  return w / n;
};

describe("LX-SPAR/2 (G2)", () => {
  it("shows every move apart on the action pins, so a guard is not read as a rest", () => {
    const seen: number[] = [];
    spar2(fighter("watcher", (w) => (seen.push(theirAction(w)), "tap")), fighter("mover", (() => { let k = 0; return () => MOVES[k++ % MOVES.length]!; })()), 1);
    expect(new Set(seen.slice(1)).size).toBe(MOVES.length);
  });

  it("names its own version", () => {
    expect(spar2(always("tap"), always("tap"), 1).version).toBe(SPAR_V2);
  });

  it("is strict about stamina: no move without its full cost", () => {
    const r = spar2(always("pounce"), always("tap"), 3);
    for (let k = 1; k < r.rounds.length; k++) {
      const had = r.rounds[k - 1]!.stamina[0];
      if (r.rounds[k]!.moves[0] === "pounce") expect(had, `round ${k}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("a guard answers a pounce: the attacker staggers and loses stamina, and a guarding pet can win", () => {
    const r = spar2(always("pounce"), always("guard"), 5);
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

  it("mood is a cost: an excited pet hits harder but tires faster; a calm one recovers", () => {
    const excited = spar2(always("pounce", 3), always("tap"), 9);
    const calm = spar2(always("pounce", 1), always("tap"), 9);
    expect(excited.rounds[0]!.hits[0]).toBeGreaterThan(calm.rounds[0]!.hits[0]);
    expect(excited.rounds[0]!.stamina[0]).toBeLessThan(calm.rounds[0]!.stamina[0]);
    const resting = spar2(always("tap", 1), always("tap"), 9);
    expect(resting.rounds[0]!.stamina[0]).toBe(10);
  });

  it("reading pays: a brain that answers the last move beats one that repeats", () => {
    // the field's written reader (scripts/sim90/field.ts): it answers what the fight shows, nothing in it tuned to win
    const reader = fighterFrom("reader", READER, 0);
    for (const m of ["pounce", "guard", "dodge", "rest", "snack", "charm"] as const) expect(winRate(reader, always(m)), m).toBeGreaterThan(0.6);
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
    expect(seasonSparVersion(SPAR_V2_FROM_WEEK)).toBe(SPAR_V2);
    expect(seasonSparVersion("2027-W02")).toBe(SPAR_V2);
    expect(dailySparVersion(SPAR_V2_FROM_DAY - 1)).toBe(SPAR_VERSION);
    expect(dailySparVersion(SPAR_V2_FROM_DAY)).toBe(SPAR_V2);
  });
});

describe("Spar skills tilt a LX-SPAR/2 fight and never decide it (G2, G8 item 4)", () => {
  const only = (want: number): Fighter => ({ ...fighterFrom(`only${want}`, composeProgram("gentle", []), 1), brain: brain(() => MOVES[want]!) });
  const rate = (a: Fighter, b: Fighter, n = 300) => {
    let w = 0;
    for (let s = 0; s < n; s++) if (fight(SPAR_V2, a, b, s * 7919 + 3).winner === 0) w++;
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
      const r = rate(skilled(reader, { ...ranks, [caps[0]!]: 1, [caps[1]!]: 1 }), reader);
      expect(r, caps.join("+")).toBeGreaterThan(0.6);
      expect(r, caps.join("+")).toBeLessThan(0.8);
    }
  });
});


describe("the coach's advice wins in practice (G2)", () => {
  it("a lesson the coach suggests wins more spars on seeds it never practised on, against every hand-written partner", () => {
    const fresh = Array.from({ length: 120 }, (_, i) => 900_001 + i * 104_729);
    const wins = (lessons: Rule[], line: "gentle" | "bold" | "curious", opp: () => Fighter) => fresh.filter((s) => fight(SPAR_V2, fighterOfMind("me", { line, lessons }, 0), opp(), s).winner === 0).length;
    let suggested = 0;
    for (const p of PARTNERS) for (const line of ["gentle", "bold", "curious"] as const) {
      const opp = () => fighterOfPartner(p);
      const result = fight(SPAR_V2, fighterOfMind("me", { line, lessons: [] }, 0), opp(), 4242);
      if (result.winner === 0) continue;
      const note = coach({ result, side: 0, line, stage: "child", lessons: [], level: 0, opponent: opp() });
      if (!note.lesson) continue;
      suggested++;
      expect(wins([note.lesson.rule], line, opp), `${line} vs ${p.id}: ${note.lesson.id}`).toBeGreaterThan(wins([], line, opp));
    }
    expect(suggested).toBeGreaterThan(3);
  });
});

describe("coaching lesson after lesson never makes a pet worse (G2)", () => {
  it("each lesson the coach adds against Behemoth keeps or raises the wins on fresh seeds", () => {
    const fresh = Array.from({ length: 120 }, (_, i) => 700_001 + i * 7919);
    const wins = (line: "gentle" | "bold" | "curious", lessons: Rule[]) => fresh.filter((s) => fight(SPAR_V2, fighterOfMind("me", { line, lessons }, 1), behemothFighter("Behemoth"), s).winner === 0).length;
    for (const line of ["gentle", "bold", "curious"] as const) {
      const lessons: Rule[] = [];
      let before = wins(line, lessons);
      for (let k = 0; k < LESSON_CAPACITY.adult; k++) {
        let note: ReturnType<typeof coach> | null = null;
        for (let s = 0; s < 6 && !note?.lesson; s++) {
          const r = fight(SPAR_V2, fighterOfMind("me", { line, lessons }, 1), behemothFighter("Behemoth"), 1000 + s);
          if (r.winner !== 0) note = coach({ result: r, side: 0, line, stage: "adult", lessons, level: 1, opponent: behemothFighter("Behemoth") });
        }
        if (!note?.lesson) break;
        lessons.unshift(note.lesson.rule);
        const after = wins(line, lessons);
        expect(after, `${line}, lesson ${k + 1} (${note.lesson.id})`).toBeGreaterThanOrEqual(before);
        before = after;
      }
    }
    // thousands of practice spars: the coach fights 96 per lesson, lesson after lesson
  }, 120_000);
});
