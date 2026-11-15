import { describe, expect, it } from "vitest";
import { STARTERS, compileProgram, fastBrain, stateBits, runBeat, decodeSenses } from "@lingxi/brain";
import { keccak_256 } from "@noble/hashes/sha3";
import { ACTION, type Brain, care, catchUp, createPet, inputWord, liveBeat, localHour } from "../src/sim";
import { BEAT_MS, DAY_MS, HIBERNATE_AFTER, MAX_CATCH_UP, dayOf, stageOf, visibleMeters } from "../src/pet";
import { chainAll, chainLog, ZERO_HASH } from "../src/log";
import { packState, unpackState } from "../src/pack";

const T0 = Date.UTC(2026, 10, 16, 2, 0, 0); // 10:00 in UTC+8
const brainFor = (line: keyof typeof STARTERS): Brain => {
  const p = STARTERS[line];
  return { fast: fastBrain(compileProgram(p)), nState: stateBits(p) };
};
const gentle = brainFor("gentle");
const newPet = () => createPet({ name: "Mochi", line: "gentle", now: T0, tzOffsetMin: 480, brain: gentle });

describe("a pet's day", () => {
  it("hatches with sensible meters and an empty log", () => {
    const p = newPet();
    expect(visibleMeters(p)).toEqual({ food: 620, joy: 700, energy: 800, clean: 900 });
    expect(p.brain).toHaveLength(8);
    expect(p.logHash).toBe(ZERO_HASH);
    expect(stageOf(p, T0)).toBe("baby");
    expect(dayOf(p, T0 + DAY_MS * 3)).toBe(4);
    expect(stageOf(p, T0 + DAY_MS * 3)).toBe("teen");
  });

  it("decays meters at the published rates while away", () => {
    const p = catchUp(newPet(), T0 + 60 * BEAT_MS, gentle);
    const m = visibleMeters(p);
    expect(m.food).toBe(620 - 45);
    expect(m.clean).toBe(900 - 18);
    expect(p.pendingLog).toHaveLength(60);
  });

  it("is deterministic: the same absence replays to the same bits", () => {
    const a = catchUp(newPet(), T0 + DAY_MS, gentle);
    const b = catchUp(newPet(), T0 + DAY_MS, gentle);
    expect(a).toEqual(b);
    expect(a.logHash).toBe(chainAll(ZERO_HASH, a.pendingLog));
  });

  it("caps very long absences and hibernates instead of dying", () => {
    const p = catchUp(newPet(), T0 + 30 * DAY_MS, gentle);
    expect(p.hibernating).toBe(true);
    expect(p.pendingLog.length).toBeLessThanOrEqual(MAX_CATCH_UP);
    expect(p.pendingLog.length).toBeGreaterThan(HIBERNATE_AFTER);
    const woke = care(p, { kind: "feed", food: "mochi" }, T0 + 30 * DAY_MS, gentle);
    expect(woke.note).toBe("hibernationEnded");
    expect(woke.pet.hibernating).toBe(false);
  });

  it("feeding fills the meter, records diet and runs a beat with the feed action", () => {
    const r = care(newPet(), { kind: "feed", food: "apple" }, T0 + 5 * BEAT_MS, gentle);
    expect(r.note).toBe("ate");
    expect(r.pet.diet.fruit).toBe(1);
    const last = r.pet.pendingLog.at(-1)!;
    expect(decodeSenses(last).action).toBe(ACTION.feed);
    expect(decodeSenses(last).owner).toBe(1);
  });

  it("overfeeding a full pet costs joy", () => {
    let p = newPet();
    p = care(p, { kind: "feed", food: "burger" }, T0, gentle).pet;
    const before = visibleMeters(p).joy;
    const r = care(p, { kind: "feed", food: "mochi" }, T0, gentle);
    expect(r.note).toBe("overfed");
    expect(visibleMeters(r.pet).joy).toBeLessThan(before);
  });

  it("a tired pet will not play", () => {
    const p = { ...newPet(), meters: { ...newPet().meters, energy: 50 * 60 } };
    expect(care(p, { kind: "play" }, T0, gentle).note).toBe("tooTired");
  });

  it("never mutates the state it was given", () => {
    const p = newPet();
    const snap = JSON.stringify(p);
    care(p, { kind: "play" }, T0 + 10 * BEAT_MS, gentle);
    catchUp(p, T0 + DAY_MS, gentle);
    liveBeat(p, T0 + 2 * BEAT_MS, gentle);
    expect(JSON.stringify(p)).toBe(snap);
  });

  it("the brain inside the sim gives exactly the program's answers", () => {
    let p = newPet();
    p = catchUp(p, T0 + 3 * 60 * BEAT_MS, gentle);
    // replay the logged words through the reference interpreter from a zero memory
    let state = new Array(stateBits(STARTERS.gentle)).fill(0);
    for (const w of p.pendingLog) state = runBeat(STARTERS.gentle, state, w).state;
    expect(state).toEqual(p.brain);
  });

  it("local hour follows the pet's own time zone", () => {
    const p = newPet();
    expect(localHour(p, Math.floor(T0 / BEAT_MS))).toBe(10);
    expect(decodeSenses(inputWord(p, Math.floor(T0 / BEAT_MS), 0, 0, true)).time).toBe(1); // morning
  });
});

describe("input log", () => {
  it("matches abi.encodePacked(bytes32, uint16) hashing", () => {
    const h = chainLog(ZERO_HASH, 0x1234);
    const buf = new Uint8Array(34);
    buf[32] = 0x12;
    buf[33] = 0x34;
    const want = "0x" + Array.from(keccak_256(buf), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(h).toBe(want);
  });
});

describe("256-bit checkpoint", () => {
  it("round-trips every field", () => {
    let p = newPet();
    p = care(p, { kind: "feed", food: "sundae" }, T0, gentle).pet;
    p = care(p, { kind: "play" }, T0 + BEAT_MS, gentle).pet;
    p = catchUp(p, T0 + DAY_MS / 2, gentle);
    const w = packState(p, "baby");
    expect(w < 1n << 219n).toBe(true);
    const u = unpackState(w, p.brain.length);
    expect(u.brain).toEqual(p.brain);
    expect(u.meters).toEqual(visibleMeters(p));
    expect(u.traits).toEqual(p.traits);
    expect(u.counts).toEqual(p.counts);
    expect(u.diet).toEqual(p.diet);
    expect(u.line).toBe("gentle");
    expect(u.stage).toBe("baby");
    expect(u.asleep).toBe(p.asleep);
  });
});

describe("explaining a live beat", () => {
  it("records which rule decided when the program is known", () => {
    const brain = { ...gentle, program: STARTERS.gentle };
    const r = care(newPet(), { kind: "pet" }, T0, brain);
    expect(r.pet.last.rule).toBeGreaterThanOrEqual(-1);
    const expected = runBeat(STARTERS.gentle, catchUp(newPet(), T0, brain).brain, r.pet.last.word);
    expect(r.pet.last.rule).toBe(expected.rule);
    expect(r.pet.last.want).toBe(expected.out & 7);
  });
});

describe("items from the world", () => {
  it("feeding an item effect fills meters, adds xp and diet", () => {
    const r = care(newPet(), { kind: "feed", food: { food: 300, joy: 20, xp: 15, diet: "grain" } }, T0, gentle);
    expect(r.pet.diet.grain).toBe(1);
    expect(r.pet.xp).toBeGreaterThanOrEqual(15);
  });
  it("using a tonic wakes a hibernating pet and records the medicine action", () => {
    const sleeping = catchUp(newPet(), T0 + 30 * DAY_MS, gentle);
    expect(sleeping.hibernating).toBe(true);
    const r = care(sleeping, { kind: "use", item: { energy: 400, wake: true } }, T0 + 30 * DAY_MS, gentle);
    expect(r.note).toBe("hibernationEnded");
    const r2 = care(newPet(), { kind: "use", item: { joy: 200 } }, T0, gentle);
    expect(r2.note).toBe("used");
    expect(decodeSenses(r2.pet.pendingLog.at(-1)!).action).toBe(ACTION.medicine);
  });
});
