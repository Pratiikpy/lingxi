import { describe, expect, it } from "vitest";
import { bytesToHex, compileProgram, composeChild, netlistBytes } from "@lingxi/brain";
import {
  type ChainPetView,
  type Pet,
  care,
  catchUp,
  checkPapers,
  createPet,
  familyOf,
  halvesOf,
  mindBrain,
  packState,
  savedLength,
  stageOf,
} from "../src";
import { ZERO_HASH, chainAll } from "../src/log";

const T0 = Date.UTC(2026, 10, 17, 9);
const MIN = 60_000;
const P = "0x00000000000000000000000000000000000000c1";
const lessonA = { label: "eat when hungry", when: { hunger: [3] }, then: { want: 1, mood: 1 } };
const family = familyOf(
  { name: "Ada", line: "gentle", lessons: [lessonA], skills: [132], petId: 1 },
  { name: "Bo", line: "bold", lessons: [], petId: 2 },
);

function newChild(): Pet {
  const brain = mindBrain({ line: "gentle", lessons: [], family });
  return { ...createPet({ name: "Pip", line: "gentle", now: T0, tzOffsetMin: 0, brain }), family };
}
const brainOf = (p: Pet) => mindBrain({ line: p.line, lessons: p.lessons, family: p.family, growth: p.growth });

/** Live a little: time passes and the pet is fed and petted. */
function live(p: Pet, minutes: number): Pet {
  let q = catchUp(p, T0 + minutes * MIN, brainOf(p));
  q = care(q, { kind: "feed", food: { food: 200 } }, T0 + minutes * MIN, brainOf(q)).pet;
  q = care(q, { kind: "pet" }, T0 + minutes * MIN, brainOf(q)).pet;
  return q;
}

/** What the chain holds after saving `p`: its state and log hash, and its brain circuit and the two halves it REFs. */
function chainOf(p: Pet, opts: { day?: number } = {}): ChainPetView {
  const [ha, hb] = halvesOf(p.family!, p.lessons);
  const a = { processor: P, id: "11", hex: bytesToHex(netlistBytes(compileProgram(ha))) };
  const b = { processor: P, id: "12", hex: bytesToHex(netlistBytes(compileProgram(hb))) };
  const glue = {
    processor: P,
    id: "13",
    hex: bytesToHex(composeChild({ cpu: P, id: 11n }, { cpu: P, id: 12n }).bytes),
  };
  return {
    line: 0,
    parentA: 1n,
    parentB: 2n,
    day: opts.day ?? 1,
    state: packState(p, stageOf(p, T0)),
    logHash: chainAll(ZERO_HASH, p.pendingLog),
    brainBits: brainOf(p).nState,
    parts: [glue, a, b],
  };
}

describe("adoption papers (plan 4.8)", () => {
  it("papers of a child just saved match the chain", () => {
    const p = live(newChild(), 90);
    expect(p.pendingLog.length).toBeGreaterThan(10);
    expect(checkPapers(p, chainOf(p))).toBeNull();
  });

  it("papers that went on after the save match when the rest replays to their memory", () => {
    const saved = live(newChild(), 60);
    const chain = chainOf(saved);
    const later = live(saved, 200);
    expect(later.pendingLog.length).toBeGreaterThan(saved.pendingLog.length);
    expect(savedLength(later.pendingLog, chain.logHash)).toBe(saved.pendingLog.length);
    expect(checkPapers(later, chain)).toBeNull();
  });

  it("a newborn never saved matches against its hatching record", () => {
    const born = newChild();
    const chain = { ...chainOf(born, { day: 0 }), logHash: ZERO_HASH };
    expect(checkPapers(live(born, 30), chain)).toBeNull();
  });

  it("refuses a different brain: a lesson the chain's halves do not have", () => {
    const p = live(newChild(), 90);
    const chain = chainOf(p);
    expect(checkPapers({ ...p, lessons: [lessonA] }, chain)).toBe("brain");
    // and a glue that is not the composition of those two halves
    const bad = {
      ...chain,
      parts: [{ ...chain.parts[0]!, hex: chain.parts[0]!.hex.slice(0, -2) + "00" }, chain.parts[1]!, chain.parts[2]!],
    };
    expect(checkPapers(p, bad)).toBe("brain");
  });

  it("refuses a parent's capstone left out of the papers (the halves no longer match)", () => {
    const p = live(newChild(), 60);
    const chain = chainOf(p);
    const stripped = {
      ...p,
      family: {
        ...family,
        parents: [{ ...family.parents[0], skills: undefined }, family.parents[1]] as typeof family.parents,
      },
    };
    expect(checkPapers(stripped, chain)).toBe("brain");
  });

  it("refuses a rewritten log, a forged memory and a wrong hash", () => {
    const p = live(newChild(), 90);
    const chain = chainOf(p);
    const rewritten = [...p.pendingLog];
    rewritten[3] = rewritten[3]! ^ 1;
    expect(checkPapers({ ...p, pendingLog: rewritten, logHash: chainAll(ZERO_HASH, rewritten) }, chain)).toBe("log");
    expect(checkPapers({ ...p, logHash: ZERO_HASH.replace(/0$/, "1") }, chain)).toBe("log");
    const later = live(p, 120);
    const forged = [...later.brain];
    forged[0] = forged[0] ? 0 : 1;
    expect(checkPapers({ ...later, brain: forged }, chain)).toBe("memory");
  });

  it("refuses an inflated record", () => {
    const p = live(newChild(), 90);
    const chain = chainOf(p);
    expect(checkPapers({ ...p, xp: p.xp + 500 }, chain)).toBe("record");
    expect(checkPapers({ ...p, counts: { ...p.counts, feed: p.counts.feed + 3 } }, chain)).toBe("record");
    // after the save, at most one level further
    const later = live(p, 60);
    expect(checkPapers({ ...later, growth: { level: 9, points: 9, skills: {} } }, chain)).toBe("record");
    expect(checkPapers({ ...later, growth: { level: 2, points: 50, skills: {} } }, chain)).toBe("growth");
  });

  it("refuses the wrong line, wrong parents, a hatched pet and a borrowed instinct", () => {
    const p = live(newChild(), 30);
    const chain = chainOf(p);
    expect(checkPapers(p, { ...chain, line: 1 })).toBe("line");
    expect(checkPapers(p, { ...chain, parentB: 7n })).toBe("parents");
    expect(checkPapers(p, { ...chain, parentA: 0n })).toBe("notAChild");
    expect(checkPapers({ ...p, family: undefined }, chain)).toBe("notAChild");
    expect(checkPapers({ ...p, outside: { processor: P, id: "1", owner: P, parts: [] } }, chain)).toBe(
      "outsideInstinct",
    );
  });
});
