import { describe, expect, it } from "vitest";
import { compileProgram, fastBrain, stateBits } from "@lingxi/brain";
import { BEAT_MS } from "../src/pet";
import { type Pet, care, catchUp, createPet } from "../src/sim";
import { PET_SCHOOL, composeProgram } from "../src/lessons";
import { teach } from "../src/teaching";
import { familyOf, halvesOf, mindBrain } from "../src/family";
import { beatsOfLog, momentText, momentsOf, rewind } from "../src/replay";

const T0 = Date.UTC(2026, 10, 15, 6, 0);
const H = 3_600_000;
const brainOf = (p: {
  line: "gentle" | "bold" | "curious";
  lessons: never[] | ReturnType<typeof composeProgram>["rules"];
  instincts?: number;
}) => mindBrain({ line: p.line, lessons: p.lessons as never, instincts: p.instincts });

function liveDay() {
  let pet = createPet({
    name: "Mochi",
    line: "gentle",
    now: T0,
    tzOffsetMin: 480,
    brain: mindBrain({ line: "gentle", lessons: [], instincts: 1 }),
    instincts: 1,
  });
  const b = () => mindBrain({ line: "gentle", lessons: pet.lessons, instincts: 1 });
  pet = catchUp(pet, T0 + 2 * H, b());
  pet = care(pet, { kind: "feed", food: "apple" } as never, T0 + 2 * H, b()).pet;
  // the next minute: taps inside one beat are one thought (G3), and this day means two cares
  pet = care(pet, { kind: "play" }, T0 + 2 * H + 80_000, b()).pet;
  const t = teach(pet, PET_SCHOOL[0]!.rule, T0 + 3 * H);
  if (t.ok) pet = t.pet;
  pet = catchUp(pet, T0 + 9 * H, b());
  pet = care(pet, { kind: "pet" }, T0 + 9 * H, b()).pet;
  return { pet, mind: (lessons: never[]) => ({ program: composeProgram("gentle", lessons, 1) }) };
}

describe("rewind", () => {
  it("replays to exactly the decision and memory the pet has now", () => {
    const { pet, mind } = liveDay();
    const frames = rewind(pet, mind as never);
    const last = frames.at(-1)!;
    expect(frames).toHaveLength(Math.min(1440, pet.pendingLog.length));
    expect([last.want, last.mood, last.nudge]).toEqual([pet.last.want, pet.last.mood, pet.last.nudge]);
    expect(last.rule).toBe(pet.last.rule);
    expect(last.memory).toEqual(pet.last.before);
  });

  it("knows when every moment happened, including care inside a beat", () => {
    const { pet } = liveDay();
    const beats = beatsOfLog(pet);
    expect(beats.every((b) => b !== null)).toBe(true);
    for (let i = 1; i < beats.length; i++) expect(beats[i]!).toBeGreaterThanOrEqual(beats[i - 1]!);
    expect(beats.at(-1)).toBe(pet.logBeat);
    const frames = rewind(pet, (l) => ({ program: composeProgram("gentle", l, 1) }));
    expect(frames.at(-1)!.at).toBe(pet.logBeat! * BEAT_MS);
    // the feed at T0+2h shows up at that minute with the feed action
    const fed = frames.find((f) => f.senses.action === 1)!;
    expect(fed.at).toBe(Math.floor((T0 + 2 * H) / BEAT_MS) * BEAT_MS);
  });

  it("uses the brain the pet had at each point: before and after a lesson", () => {
    const { pet } = liveDay();
    const frames = rewind(pet, (l) => ({ program: composeProgram("gentle", l, 1) }), 100_000);
    const early = frames.find((f) => f.senses.action === 2)!;
    const late = frames.at(-1)!;
    expect(early.program.rules.length + 1).toBe(late.program.rules.length);
  });

  it("marks moments at care, events and every change of mind, and speaks for each", () => {
    const { pet } = liveDay();
    const frames = rewind(pet, (l) => ({ program: composeProgram("gentle", l, 1) }));
    const moments = momentsOf(frames);
    expect(moments[0]).toBe(0);
    for (const k of moments.slice(1)) {
      const f = frames[k]!;
      expect(f.senses.action !== 0 || f.senses.event !== 0 || frames[k - 1]!.want !== f.want).toBe(true);
    }
    for (const f of frames.slice(-50)) {
      expect(momentText(f, "en").length).toBeGreaterThan(5);
      expect(momentText(f, "zh").length).toBeGreaterThan(2);
    }
  });

  it("a child's rewind uses the day half by day and the night half by night, ending at its live state", () => {
    const fam = familyOf(
      { name: "A", line: "gentle", lessons: [], instincts: 1 },
      { name: "B", line: "bold", lessons: [] },
    );
    const brain = mindBrain({ line: "gentle", lessons: [], family: fam });
    let pet: Pet = { ...createPet({ name: "Bean", line: "gentle", now: T0, tzOffsetMin: 480, brain }), family: fam };
    pet = catchUp(pet, T0 + 20 * H, brain);
    pet = care(pet, { kind: "pet" }, T0 + 20 * H, brain).pet;
    const frames = rewind(pet, (l) => ({ halves: halvesOf(fam, l) }));
    const last = frames.at(-1)!;
    expect([last.want, last.mood, last.nudge]).toEqual([pet.last.want, pet.last.mood, pet.last.nudge]);
    expect(last.half).toBe(pet.last.half);
    expect(last.rule).toBe(pet.last.rule);
    const day = frames.find((f) => f.senses.time === 2)!;
    const night = frames.find((f) => f.senses.time === 0)!;
    expect(day.half).toBe(0);
    expect(night.half).toBe(1);
    void fastBrain;
    void compileProgram;
    void stateBits;
    void brainOf;
  });

  it("a pet from before times were kept still rewinds, with unknown times", () => {
    const { pet } = liveDay();
    const old = { ...pet, logMarks: undefined, logBeat: undefined };
    const frames = rewind(old, (l) => ({ program: composeProgram("gentle", l, 1) }));
    expect(frames.every((f) => f.at === null)).toBe(true);
    expect(frames.at(-1)!.want).toBe(pet.last.want);
  });
});

describe("where a decision came from", () => {
  it("names taught rules, instincts, inborn rules and the default", async () => {
    const { ruleSource } = await import("../src/replay");
    const p = composeProgram("gentle", [PET_SCHOOL[0]!.rule], 1);
    expect(ruleSource({ rule: 0, program: p })).toBe("taught");
    expect(ruleSource({ rule: 1, program: p })).toBe("instinct");
    expect(ruleSource({ rule: 2, program: p })).toBe("born");
    expect(ruleSource({ rule: -1, program: p })).toBe("default");
  });
});

describe("rewinding a spar", () => {
  it("names the rule behind every round's move, matching the fight itself", async () => {
    const { rewindFight } = await import("../src/replay");
    const { spar, MOVES } = await import("../src/spar");
    const { fighterOfMind } = await import("../src/coach");
    const lessons = [PET_SCHOOL[1]!.rule];
    const me = fighterOfMind("Mochi", { line: "gentle", lessons, instincts: 1 }, 1);
    const them = fighterOfMind("Rex", { line: "bold", lessons: [] }, 1);
    const result = spar(me, them, 1234);
    const why = rewindFight(
      { program: composeProgram("gentle", lessons, 1) },
      me.memory,
      result.rounds.map((r) => r.words[0]),
    );
    expect(why).toHaveLength(result.rounds.length);
    result.rounds.forEach((r, i) => {
      // the move is the brain's want unless stamina or a slip changed it, which the screen says
      const chosen = MOVES[why[i]!.want]!;
      expect(r.moves[0] === chosen || r.moves[0] === "rest" || r.moves[0] === "tap").toBe(true);
    });
  });
});

describe("earlier days", () => {
  it("a window further back ends exactly where the next one starts", () => {
    const { pet } = liveDay();
    const mind = (l: never[]) => ({ program: composeProgram("gentle", l, 1) });
    const latest = rewind(pet, mind as never, 200);
    const before = rewind(pet, mind as never, 200, 200);
    expect(before.at(-1)!.index + 1).toBe(latest[0]!.index);
    // memory carries across the seam
    const whole = rewind(pet, mind as never, 400);
    expect(whole[200]!.memory).toEqual(latest[0]!.memory);
    expect(rewind(pet, mind as never, 200, 1e9)).toEqual([]);
  });
});
