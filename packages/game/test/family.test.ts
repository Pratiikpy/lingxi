import { describe, expect, it } from "vitest";
import { type Circuit, STARTERS, beat, bitsToWord, compileProgram, composeChild, load, netlistBytes, refKey, wordToBits } from "@lingxi/brain";
import { canonicalCard, checkMindLesson, childRoom, familyOf, halvesOf, mindBrain, canBreed, parseCard, petCard } from "../src/family";
import { composeProgram } from "../src/lessons";
import { createPet, teach } from "../src/index";

const brave = { when: { event: [3], owner: [1] }, then: { want: 6, mood: 1, nudge: 1 } };
const napper = { when: { time: [2], energy: [0, 1] }, then: { want: 3, mood: 1, nudge: 4 } };
const share = { when: { event: [1] }, then: { want: 7, mood: 2, nudge: 6 } };

describe("families", () => {
  const family = familyOf({ name: "Mochi", line: "gentle", lessons: [brave] }, { name: "Tofu", line: "bold", lessons: [napper] });

  it("a child's fast brain gives exactly what the on-chain child circuit gives, memory included", () => {
    const CPU = "0x00000000000000000000000000000000000000bb";
    const [pa, pb] = halvesOf(family, [share]);
    const parents: Record<string, Circuit> = {
      [refKey(CPU, 7n)]: load(netlistBytes(compileProgram(pa)), 16, 8),
      [refKey(CPU, 8n)]: load(netlistBytes(compileProgram(pb)), 16, 8),
    };
    const child = load(composeChild({ cpu: CPU, id: 7n }, { cpu: CPU, id: 8n }).bytes, 16, 8, (c, id) => parents[refKey(c, id)] ?? null);
    const fast = mindBrain({ line: "gentle", lessons: [share], family });
    expect(fast.nState).toBe(child.nState);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    let state = new Array(child.nState).fill(0);
    const fastState = new Uint8Array(child.nState);
    for (let i = 0; i < 5000; i++) {
      const w = Math.floor(rnd() * 65536);
      const [next, out] = beat(child, state, wordToBits(w, 16));
      const fastOut = fast.fast.step(fastState, w);
      expect(fastOut).toBe(Number(bitsToWord(out)));
      expect(Array.from(fastState)).toEqual(next);
      state = next;
    }
  });

  it("children are generation 1, and a child cannot become a parent", () => {
    expect(family.generation).toBe(1);
    expect(() => familyOf({ name: "Kid", line: "gentle", lessons: [], generation: 1 }, { name: "Other", line: "curious", lessons: [] })).toThrow("secondGeneration");
  });

  it("teaching a child checks both halves and changes both", () => {
    const pet = { ...createPet({ name: "Kid", line: "gentle", now: 0, tzOffsetMin: 0, brain: mindBrain({ line: "gentle", lessons: [], family }) }), family };
    const r = teach(pet, share, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [a, b] = halvesOf(family, r.pet.lessons);
    expect(a.rules[0]).toEqual(share);
    expect(b.rules[0]).toEqual(share);
    expect(checkMindLesson({ line: "gentle", lessons: r.pet.lessons, family }, "baby", napper)).toMatchObject({ ok: false, reason: "full" });
  });

  it("only grown pets that have rested can have a child", () => {
    expect(canBreed({ stage: "adult" }, { stage: "elder" }, 10)).toEqual({ ok: true });
    expect(canBreed({ stage: "teen" }, { stage: "adult" }, 10)).toMatchObject({ reason: "notAdult" });
    expect(canBreed({ stage: "adult", lastBredDay: 9 }, { stage: "adult" }, 10)).toMatchObject({ reason: "tooSoon" });
    expect(canBreed({ stage: "adult", lastBredDay: 7 }, { stage: "adult" }, 10)).toEqual({ ok: true });
    expect(canBreed({ stage: "adult", generation: 1 }, { stage: "adult" }, 10)).toMatchObject({ reason: "secondGeneration" });
    expect(canBreed({ stage: "adult" }, { stage: "elder", generation: 1 }, 10)).toMatchObject({ reason: "secondGeneration" });
  });

  it("starter brains still match the plain compiler", () => {
    expect(mindBrain({ line: "bold", lessons: [] }).nState).toBe(compileProgram(STARTERS.bold).latches.length);
  });
});

describe("a parent's capstone rules pass into its half of the child (fix found in plan 4.8)", () => {
  // the child's on-chain brain REFs each parent's real circuit, so each half must be exactly that parent's brain
  const rule = (ids: number[]) => ({ level: 30, points: 0, skills: Object.fromEntries(ids.map((id) => [id, 1])) });
  it("each half compiles to the parent's own brain, capstones included", async () => {
    const { composeProgram, mindExtra } = await import("../src/index");
    const lessonsA = [{ label: "a", when: { hunger: [3] }, then: { want: 1, mood: 1 } }];
    const growthA = rule([132]);
    const family = familyOf({ name: "Ada", line: "gentle", lessons: lessonsA, skills: [132] }, { name: "Bo", line: "bold", lessons: [] });
    expect(family.parents[0].skills).toEqual([132]);
    const [ha, hb] = halvesOf(family, []);
    const brainA = compileProgram(composeProgram("gentle", lessonsA, undefined, mindExtra(growthA)));
    expect(netlistBytes(compileProgram(ha))).toEqual(netlistBytes(brainA));
    expect(netlistBytes(compileProgram(hb))).toEqual(netlistBytes(compileProgram(composeProgram("bold", [], undefined))));
  });
  it("keeps only real rule skills, once each", () => {
    const f = familyOf({ name: "Ada", line: "gentle", lessons: [], skills: [262, 132, 132, 111, 99999] }, { name: "Bo", line: "bold", lessons: [] });
    expect(f.parents[0].skills).toEqual([132, 262]);
  });
});

describe("a child of a parent with capstones can still learn", () => {
  it("inherited rules do not eat the child's own gate budget", async () => {
    const { halfBudgets, gateBudget } = await import("../src/index");
    const fam = familyOf({ name: "Ada", line: "gentle", lessons: [], skills: [132, 162] }, { name: "Bo", line: "bold", lessons: [] });
    const [a, b] = halfBudgets(fam, undefined);
    expect(b).toBe(gateBudget(undefined));
    expect(a).toBeGreaterThan(gateBudget(undefined));
    const r = checkMindLesson({ line: "gentle", lessons: [], family: fam }, "baby", { label: "x", when: { hunger: [3] }, then: { want: 1, mood: 1 } });
    expect(r.ok).toBe(true);
  });

  it("a child inherits each parent's whole mind, as its circuit on chain does (A27)", () => {
    const thirteen = Array.from({ length: 13 }, (_, i) => ({ when: { event: [i % 4], hunger: [i % 3] }, then: { want: (i % 5) + 1, mood: i % 4 } }));
    const fam = familyOf({ name: "Mochi", line: "gentle", lessons: thirteen, instincts: 5 }, { name: "Tofu", line: "bold", lessons: [napper] });
    expect(fam.parents[0].lessons).toHaveLength(13);
    // the half the game runs is the parent's own brain, which the child's circuit REFs on chain
    const [half] = halvesOf(fam, []);
    expect(netlistBytes(compileProgram(half))).toEqual(netlistBytes(compileProgram(composeProgram("gentle", thirteen, 5))));
    // and a card carrying that family is read back whole
    const back = parseCard(JSON.stringify({ lessons: [], family: fam }));
    expect(back?.family?.parents[0].lessons).toHaveLength(13);
  });

  it("says how much room a newborn has to learn: none while its parents' minds fill its halves (A27)", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ when: { event: [i % 4], hunger: [i % 3] }, then: { want: (i % 5) + 1, mood: i % 4 } }));
    expect(childRoom(familyOf({ name: "A", line: "gentle", lessons: [] }, { name: "B", line: "bold", lessons: [] }))).toBeGreaterThan(0);
    // eight lessons and all four instinct switches fill a half past an ungrown child's budget
    expect(childRoom(familyOf({ name: "A", line: "gentle", lessons: many, instincts: 15 }, { name: "B", line: "bold", lessons: [] }))).toBeLessThanOrEqual(0);
  });
});


describe("a card in its own shape (A77)", () => {
  it("keeps a real card's meaning and drops every field the game does not know, at every level", () => {
    const family = familyOf({ name: "Mochi", line: "gentle", lessons: [brave] }, { name: "Tofu", line: "bold", lessons: [napper] });
    const real = petCard({ line: "gentle", lessons: [brave], instincts: 0, family } as never);
    const once = canonicalCard(real)!;
    expect(parseCard(once), "the same card, read back").toEqual(parseCard(real));
    expect(canonicalCard(once), "and stable").toBe(once);
    const padded = JSON.parse(real) as { lessons: Array<Record<string, unknown>>; family: { parents: Array<{ lessons: Array<Record<string, unknown>> }> } };
    padded.lessons[0]!.pad = "x".repeat(5_000);
    (padded.lessons[0]!.then as Record<string, unknown>).pad = "z".repeat(5_000);
    padded.lessons[0]!.label = "L".repeat(5_000);
    padded.family.parents[0]!.lessons[0]!.pad = "p".repeat(5_000);
    (padded as unknown as Record<string, unknown>).extra = "e".repeat(5_000);
    const clean = canonicalCard(JSON.stringify(padded))!;
    expect(clean.length, "the padding is gone").toBeLessThan(once.length + 100);
    expect(clean).not.toContain("xxxx");
    expect(clean).not.toContain("pppp");
    expect(canonicalCard("not a card")).toBeNull();
    // a condition the game never writes (text where it reads small integers) is not a card to pass on
    const odd = JSON.parse(real) as { lessons: Array<{ when: Record<string, unknown> }> };
    odd.lessons[0]!.when.junk = ["y".repeat(5_000)];
    expect(canonicalCard(JSON.stringify(odd))).toBeNull();
  });
});
