import { describe, expect, it } from "vitest";
import { type Rule, compileProgram, fastBrain, stateBits } from "@lingxi/brain";
import { care, catchUp, composeProgram, createPet, diaryOf, diaryText, teach } from "../src/index";

const brainFor = (lessons: Rule[]) => {
  const p = composeProgram("gentle", lessons);
  return { fast: fastBrain(compileProgram(p)), nState: stateBits(p), program: p };
};
const T0 = Date.UTC(2026, 10, 15, 6);

describe("diary", () => {
  it("tells the care it really got, in both languages", () => {
    let pet = createPet({ name: "M", line: "gentle", now: T0, tzOffsetMin: 0, brain: brainFor([]) });
    pet = care(pet, { kind: "feed", food: "mochi" }, T0 + 60_000, brainFor([])).pet;
    pet = care(pet, { kind: "feed", food: "mochi" }, T0 + 120_000, brainFor([])).pet;
    pet = care(pet, { kind: "play" }, T0 + 180_000, brainFor([])).pet;
    pet = catchUp(pet, T0 + 3 * 3_600_000, brainFor([]));
    const d = diaryOf(pet, brainFor);
    expect(d.find((l) => l.key === "fed")?.n).toBe(2);
    expect(d.some((l) => l.key === "played")).toBe(true);
    for (const l of d) {
      expect(diaryText(l, "en").length).toBeGreaterThan(0);
      expect(diaryText(l, "zh").length).toBeGreaterThan(0);
    }
  });

  it("counts the times the owner came over to pat, as the log keeps them, and says so (B6)", () => {
    let pet = createPet({ name: "M", line: "gentle", now: T0, tzOffsetMin: 0, brain: brainFor([]) });
    // five taps in one minute, one the next minute: the log keeps one care a minute
    for (let i = 0; i < 5; i++) pet = care(pet, { kind: "pet" }, T0 + 60_000 + i * 5_000, brainFor([])).pet;
    pet = care(pet, { kind: "pet" }, T0 + 125_000, brainFor([])).pet;
    pet = catchUp(pet, T0 + 3 * 3_600_000, brainFor([]));
    const line = diaryOf(pet, brainFor).find((l) => l.key === "petted")!;
    expect(line.n).toBe(2);
    expect(diaryText(line, "en")).toBe("You came over to pat me 2 times.");
    expect(diaryText(line, "zh")).toBe("你过来摸了我 2 回。");
  });

  it("a day with nothing is a quiet day, and learning shows up", () => {
    const pet = createPet({ name: "M", line: "gentle", now: T0, tzOffsetMin: 0, brain: brainFor([]) });
    expect(diaryOf(pet, brainFor)).toEqual([{ key: "quiet" }]);
    const taught = teach(
      catchUp(pet, T0 + 600_000, brainFor([])),
      { when: { event: [1] }, then: { want: 7, mood: 2, nudge: 6 } } as Rule,
      T0 + 600_000,
    );
    expect(taught.ok).toBe(true);
    if (!taught.ok) return;
    const later = catchUp(taught.pet, T0 + 1_200_000, brainFor([]));
    expect(diaryOf(later, brainFor).some((l) => l.key === "learned")).toBe(true);
  });
});
