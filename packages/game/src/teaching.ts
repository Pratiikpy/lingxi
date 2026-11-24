/**
 * Teaching a pet, and an elder mentoring its child (G4). Every lesson is checked against the pet's whole mind,
 * both halves for a child, before it is taken. Its own module because the mind check lives with the family's halves
 * and the family composes programs from the lessons: lessons > family > lessons was a cycle (P7).
 */
import type { Rule } from "@lingxi/brain";
import { checkMindLesson } from "./family";
import { type LessonCheck, type LessonCheckReason, withSegment } from "./lessons";
import { stageOf } from "./pet";
import { type Pet, gainXp } from "./sim";
import { effectOf } from "./skills";

/** Teach the pet a rule. Returns the new pet, or why the lesson was refused. */
export function teach(p: Pet, rule: Rule, now: number, slots = 0): { ok: true; pet: Pet; gates: number } | Extract<LessonCheck, { ok: false }> {
  const stage = stageOf(p, now);
  const r = checkMindLesson({ line: p.line, lessons: p.lessons, family: p.family, instincts: p.instincts, outside: p.outside, growth: p.growth, slots }, stage, rule);
  if (!r.ok) return r;
  const taught: Pet = { ...p, lessons: [rule, ...p.lessons], counts: { ...p.counts, lessons: Math.min(255, p.counts.lessons + 1) } };
  // Mind skills: experience for each lesson taught
  const bonus = effectOf(p.growth, "TEACH_XP");
  if (bonus) gainXp(taught, bonus);
  return { ok: true, gates: r.gates, pet: withSegment(taught) };
}

/** Is `child` a child of `elder` (born of it, by the family tree this device keeps)? */
export const childOf = (elder: Pick<Pet, "bornAt">, child: Pick<Pet, "family">): boolean => !!child.family?.parents.some((p) => p.key === String(elder.bornAt));

/**
 * Elders mentor (G4): an elder passes one of its own lessons to one of its children, as older Norns teach younger
 * ones. The child learns it as any lesson, within its own slots and taught budget. Only one generation deep: a pet born
 * of two parents cannot have children of its own (Breeder.NotFirstGeneration on chain), so there are no grandchildren
 * to pass it further.
 */
export function mentorLesson(elder: Pet, child: Pet, lessonIndex: number, now: number, slots = 0): { ok: true; pet: Pet } | { ok: false; reason: "notElder" | "notChild" | "noLesson" | LessonCheckReason; detail: string } {
  if (stageOf(elder, now) !== "elder") return { ok: false, reason: "notElder", detail: "only an elder mentors" };
  if (!childOf(elder, child)) return { ok: false, reason: "notChild", detail: "an elder mentors only its own children" };
  const rule = elder.lessons[lessonIndex];
  if (!rule) return { ok: false, reason: "noLesson", detail: "no such lesson" };
  const r = teach(child, rule, now, slots);
  return r.ok ? { ok: true, pet: r.pet } : r;
}
