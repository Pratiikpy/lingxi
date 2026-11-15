import { describe, expect, it } from "vitest";
import { care, catchUp, createPet } from "../src/sim";
import { mindBrain } from "../src/family";
import { PET_SCHOOL, teach } from "../src/lessons";
import { checkReturn } from "../src/sitting";

const T0 = Date.UTC(2026, 10, 15, 8, 0);
const H = 3_600_000;
const brain = mindBrain({ line: "gentle", lessons: [] });
const home = catchUp(createPet({ name: "Mochi", line: "gentle", now: T0, tzOffsetMin: 0, brain }), T0 + 2 * H, brain);
// the friend looks after it for a day
let away = care(home, { kind: "feed", food: "apple" } as never, T0 + 3 * H, brain).pet;
away = catchUp(away, T0 + 20 * H, brain);
away = care(away, { kind: "pet" }, T0 + 20 * H, brain).pet;

describe("bringing a sat pet home", () => {
  it("accepts the same pet honestly continued", () => {
    expect(checkReturn(home, away, brain)).toEqual({ ok: true });
  });

  it("refuses a different pet, a taught pet, a rewritten or forged log, a forged memory, or time going backwards", () => {
    expect(checkReturn(home, { ...away, bornAt: away.bornAt + 1 }, brain)).toEqual({ ok: false, reason: "notSame" });
    const t = teach(away, PET_SCHOOL[0]!.rule, T0 + 20 * H);
    if (t.ok) expect(checkReturn(home, t.pet, brain)).toEqual({ ok: false, reason: "taught" });
    const rewritten = { ...away, pendingLog: [home.pendingLog[0]! ^ 1, ...away.pendingLog.slice(1)] };
    expect(checkReturn(home, rewritten, brain)).toEqual({ ok: false, reason: "logRewritten" });
    const forged = { ...away, pendingLog: [...away.pendingLog.slice(0, -1), (away.pendingLog.at(-1)! + 1) & 0xffff] };
    expect(checkReturn(home, forged, brain)).toEqual({ ok: false, reason: "hashMismatch" });
    const memory = { ...away, brain: away.brain.map((b, i) => (i === 0 ? 1 - b : b)) };
    expect(checkReturn(home, memory, brain)).toEqual({ ok: false, reason: "brainMismatch" });
    expect(checkReturn(away, home, brain).ok).toBe(false);
    expect(checkReturn(home, { ...away, meters: { ...away.meters, food: 10 ** 9 } }, brain)).toEqual({ ok: false, reason: "badState" });
  });
});
