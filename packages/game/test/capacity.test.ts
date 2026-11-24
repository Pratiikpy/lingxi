import { describe, expect, it } from "vitest";
import { PET_SCHOOL } from "../src/lessons";
import { MAX_LESSONS, QUEST_SLOTS_MAX, checkMindLesson, lessonCapacity, parseCard, petCard } from "../src/family";
import { SKILLS } from "../src/skills";

const allLessonSkills = {
  level: 99,
  points: 0,
  skills: Object.fromEntries(
    SKILLS.filter((s) => s.effect === "LESSONS" || s.effect === "LESSON_TENTHS").map((s) => [s.id, s.max]),
  ),
};

describe("lesson capacity: stage, skills and quest 65's slot", () => {
  it("adds the skills' slots and at most one quest slot", () => {
    expect(lessonCapacity("baby")).toBe(2); // D7: the school's first and one of its own
    expect(lessonCapacity("elder", allLessonSkills)).toBe(13);
    expect(lessonCapacity("elder", allLessonSkills, 1)).toBe(14);
    expect(lessonCapacity("elder", allLessonSkills, 5)).toBe(13 + QUEST_SLOTS_MAX);
    expect(lessonCapacity("elder", undefined, -3)).toBe(8);
  });

  it("the most any pet can hold is MAX_LESSONS, so its card still reads", () => {
    expect(lessonCapacity("elder", allLessonSkills, QUEST_SLOTS_MAX)).toBe(MAX_LESSONS);
    const lessons = Array.from({ length: MAX_LESSONS }, (_, i) => ({
      label: `l${i}`,
      when: { hunger: [i % 4] },
      then: { want: 1 + (i % 5) },
    }));
    expect(parseCard(petCard({ lessons } as never))).not.toBeNull();
  });

  it("a baby with quest 65's slot can learn a third lesson; without it, it is full", () => {
    const two = [PET_SCHOOL[0]!.rule, PET_SCHOOL[1]!.rule];
    expect(checkMindLesson({ line: "gentle", lessons: two }, "baby", PET_SCHOOL[2]!.rule)).toMatchObject({
      ok: false,
      reason: "full",
    });
    expect(checkMindLesson({ line: "gentle", lessons: two, slots: 1 }, "baby", PET_SCHOOL[2]!.rule)).not.toMatchObject({
      reason: "full",
    });
  });
});
