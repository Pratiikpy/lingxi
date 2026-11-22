/**
 * G9: personality every day. The choice is the circuit's; the words follow the pet's strongest habit. The day's
 * choices are counted from the same replay the Rewind shows.
 */
import { describe, expect, it } from "vitest";
import { HABIT, HABIT_LINES, TRAITS, dayChoices, habitsOf, momentText, strongestHabit, tellMoment, type Frame } from "../src";

const zero = Object.fromEntries(TRAITS.map((t) => [t, 0])) as Record<(typeof TRAITS)[number], number>;
const frame = (want: number, at: number, rule = -1): Frame => ({ want, at, rule, program: { rules: [], memory: [] } }) as unknown as Frame;

describe("personality every day (G9)", () => {
  it("a pet's strongest habit is a trait at the habit level or more", () => {
    expect(strongestHabit(zero)).toBeNull();
    expect(strongestHabit({ ...zero, shy: HABIT - 1 })).toBeNull();
    expect(strongestHabit({ ...zero, shy: HABIT, greedy: HABIT + 3 })).toBe("greedy");
    expect(habitsOf({ ...zero, shy: HABIT, greedy: HABIT + 3, calm: 2 })).toEqual(["greedy", "shy"]);
  });

  it("every habit has its own line for every kind of choice, in both languages", () => {
    const keys = ["idle", "eat", "play", "sleep", "explore", "sulk", "cuddle", "share"] as const;
    for (const t of TRAITS) for (const k of keys) expect(HABIT_LINES[t][k].en && HABIT_LINES[t][k].zh, `${t} ${k}`).toBeTruthy();
    for (const k of keys) expect(new Set(TRAITS.map((t) => HABIT_LINES[t][k].en)).size, k).toBe(TRAITS.length);
  });

  it("the same choice is told in each pet's own way, and a pet with no habit yet keeps the plain line", () => {
    const f = frame(2, 0);
    expect(momentText(f, "en")).toBe("I wanted to play!");
    expect(momentText(f, "en", "shy")).toBe(HABIT_LINES.shy.play.en);
    expect(momentText(f, "zh", "greedy")).toBe(HABIT_LINES.greedy.play.zh);
    expect(tellMoment(f, "en", "calm")).toBe(HABIT_LINES.calm.play.en);
  });

  it("counts today's choices: each change of mind since the day began, by kind", () => {
    const D = Date.UTC(2026, 10, 23);
    const frames = [frame(1, D - 60_000), frame(1, D + 60_000), frame(2, D + 120_000), frame(2, D + 180_000), frame(3, D + 240_000)];
    const day = dayChoices(frames, D);
    expect(day.counts).toEqual({ play: 1, sleep: 1 });
    expect(day.total).toBe(2);
    expect(day.taught).toBe(0);
  });
});
