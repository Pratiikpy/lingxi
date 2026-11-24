/**
 * A66: a pet played in the browser before it is kept. The hatch records its state at that moment, so the log the chain
 * checks must start there: restartLog cuts the log at the hatch's moment, re-chains its hash from zero, moves the
 * stretches and beat marks to the new start, and keeps the memory there for Rewind.
 */
import { describe, expect, it } from "vitest";
import { ZERO_HASH, chainAll } from "../src/log";
import { type Pet, care, catchUp, createPet } from "../src/sim";
import { PET_SCHOOL, composeProgram, logSegments } from "../src/lessons";
import { teach } from "../src/teaching";
import { mindBrain } from "../src/family";
import { beatsOfLog, rewind } from "../src/replay";
import { restartLog } from "../src/keepLog";

const T0 = Date.UTC(2026, 10, 15, 6, 0);
const H = 3_600_000;
const brain = (p: Pet) => mindBrain({ line: "gentle", lessons: p.lessons, instincts: 1 });

/** A pet that lives a few hours in the browser and learns a lesson, then is kept at `keptAt`, then lives on. */
function playedThenKept() {
  let pet = createPet({ name: "Mochi", line: "gentle", now: T0, tzOffsetMin: 480, brain: mindBrain({ line: "gentle", lessons: [], instincts: 1 }), instincts: 1 });
  pet = catchUp(pet, T0 + 2 * H, brain(pet));
  pet = care(pet, { kind: "feed", food: "apple" } as never, T0 + 2 * H, brain(pet)).pet;
  const t = teach(pet, PET_SCHOOL[0]!.rule, T0 + 3 * H);
  if (t.ok) pet = t.pet;
  pet = catchUp(pet, T0 + 4 * H, brain(pet));
  // the hatch takes this state; the player goes on playing while the wallet is open
  const snapshot = { n: pet.pendingLog.length, memory: pet.brain.slice() };
  pet = care(pet, { kind: "play" }, T0 + 4 * H + 30_000, brain(pet)).pet;
  pet = catchUp(pet, T0 + 4 * H + 10 * 60_000, brain(pet));
  return { pet, snapshot };
}

/** The memory the chain ends at: the log replayed brain by brain from `start`, as the proof page does. */
function replayFrom(p: Pet, start: number[]): number[] {
  let st = Uint8Array.from(start);
  for (const seg of logSegments(p)) {
    const b = mindBrain({ line: "gentle", lessons: seg.lessons, instincts: 1 });
    if (st.length !== b.nState) st = Uint8Array.from({ length: b.nState }, (_, i) => st[i] ?? 0);
    for (const w of seg.words) b.fast.step(st, w);
  }
  return Array.from(st);
}

describe("a pet's log restarts where its hatch was taken (A66)", () => {
  it("keeps only the moments after the hatch's state, chained from zero, and they replay from the kept memory to the pet's own", () => {
    const { pet, snapshot } = playedThenKept();
    expect(snapshot.n).toBeGreaterThan(0);
    const kept = restartLog(pet, snapshot.n, snapshot.memory);
    expect(kept.pendingLog).toEqual(pet.pendingLog.slice(snapshot.n));
    expect(kept.logHash).toBe(chainAll(ZERO_HASH, kept.pendingLog));
    expect(kept.logStart).toEqual(snapshot.memory);
    expect(replayFrom(kept, snapshot.memory), "the chain's replay ends at the pet's memory").toEqual(pet.brain);
  });

  it("moves the stretches and the beat marks to the new start", () => {
    const { pet, snapshot } = playedThenKept();
    const kept = restartLog(pet, snapshot.n, snapshot.memory);
    expect(kept.segments![0]!.from).toBe(0);
    expect(kept.segments![0]!.lessons, "the lesson learned before keeping is the brain at the start").toEqual(pet.lessons);
    expect(beatsOfLog(kept)).toEqual(beatsOfLog(pet).slice(snapshot.n));
  });

  it("Rewind starts from the kept memory and shows the moments as they were", () => {
    const { pet, snapshot } = playedThenKept();
    const kept = restartLog(pet, snapshot.n, snapshot.memory);
    const mind = (lessons: never[]) => ({ program: composeProgram("gentle", lessons, 1) });
    const before = rewind(pet, mind as never);
    const after = rewind(kept, mind as never);
    expect(after.at(-1)!.memory).toEqual(pet.last.before);
    const tail = after.length;
    expect(after.map((f) => [f.want, f.memory.join(""), f.at])).toEqual(before.slice(-tail).map((f) => [f.want, f.memory.join(""), f.at]));
  });

  it("a pet kept before it lived a moment is left as it is", () => {
    const pet = createPet({ name: "Tofu", line: "bold", now: T0, tzOffsetMin: 0, brain: mindBrain({ line: "bold", lessons: [] }) });
    expect(restartLog(pet, 0, pet.brain.slice())).toBe(pet);
  });
});
