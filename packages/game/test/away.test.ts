import { describe, expect, it } from "vitest";
import { EVENT, catchUp, createPet } from "../src/sim";
import { mindBrain } from "../src/family";
import { awayEvent, awayFind, awaySeed } from "../src/away";
import { rewind } from "../src/replay";
import { composeProgram } from "../src/lessons";

const T0 = Date.UTC(2026, 10, 15, 8, 0);

describe("surprises while away", () => {
  it("roughly matches the published odds over a long absence, and is the same every time", () => {
    const seed = 123456;
    const counts = { [EVENT.friend]: 0, [EVENT.toy]: 0, [EVENT.scary]: 0, [EVENT.none]: 0 } as Record<number, number>;
    for (let b = 0; b < 100_000; b++) counts[awayEvent(seed, b)]!++;
    expect(counts[EVENT.friend]! / 100_000).toBeCloseTo(0.0042, 3);
    expect(counts[EVENT.toy]! / 100_000).toBeCloseTo(0.0033, 3);
    expect(counts[EVENT.scary]! / 100_000).toBeCloseTo(0.0007, 3);
    expect(awayEvent(seed, 777)).toBe(awayEvent(seed, 777));
  });

  it("events reach the brain while away, are logged, and the rewind shows them", () => {
    const brain = mindBrain({ line: "gentle", lessons: [] });
    const pet0 = createPet({ name: "M", line: "gentle", now: T0, tzOffsetMin: 0, brain });
    const seed = awaySeed(pet0);
    const pet = catchUp(pet0, T0 + 24 * 3_600_000, brain, (b) => awayEvent(seed, b));
    const frames = rewind(pet, (l) => ({ program: composeProgram("gentle", l) }));
    const seen = frames.filter((f) => f.senses.event !== 0);
    expect(seen.length).toBeGreaterThan(2);
    for (const f of seen) expect(awayEvent(seed, Math.round(f.at! / 60_000))).toBe(f.senses.event);
  });

  it("finds something only after two hours away, from the room's own finds, the same each time", () => {
    const drops = [{ item: 1, weight: 3 }, { item: 2, weight: 1 }];
    expect(awayFind(5, 1000, 1060, drops)).toBeNull();
    const a = awayFind(5, 1000, 1200, drops);
    expect([1, 2]).toContain(a);
    expect(awayFind(5, 1000, 1200, drops)).toBe(a);
    expect(awayFind(5, 1000, 1200, [])).toBeNull();
  });
});
