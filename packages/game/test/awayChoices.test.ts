/**
 * G8: the pet's own choices made while the player is away count, as its choices while watched do. catchUp reports each
 * beat's choice while the pet is awake, and over a few untaught days every line chooses each want a "the pet chooses"
 * quest asks for (read from the quest line), so no such quest waits on a moment that never comes.
 *
 * Since G5 a pet cared for twice a day is never starving, so it chooses to eat when it is fed while hungry (its own
 * "fed when hungry" rule) rather than alone between visits; the game's tally counts a watched minute's choice as it
 * counts one made away (tallyRules.ts minuteTally), and so does this test.
 */
import { describe, expect, it } from "vitest";
import { STARTERS, WANTS, type StarterLine } from "@lingxi/brain";
import { awayEvent, awaySeed, care, catchUp, createPet, mindBrain } from "../src";
import { STORY, type Condition } from "@lingxi/world";

/** every want a story objective asks the pet to choose by itself (CHOOSE:<want> or CHOOSE:<want>-<room>) */
const asked = (c: Condition): string[] => (c.type === "CHOOSE" ? [String(c.index).split("-")[0]!] : (c.of ?? []).flatMap(asked));
const WANTED = [...new Set(STORY.flatMap((q) => q.objectives.flatMap((o) => asked(o.cond))))].sort();

const T0 = Date.UTC(2026, 10, 1, 0);

/** an untaught pet of `line`, fed and played with twice a day, away between: the wants it chose, away and watched */
const chosenAway = (line: StarterLine, days: number) => {
  const brain = mindBrain({ line, lessons: [] });
  let p = createPet({ name: "Mochi", line, now: T0, tzOffsetMin: 480, brain: { fast: brain.fast, nState: brain.nState, program: STARTERS[line] } });
  const chose: Record<string, number> = {};
  for (let half = 1; half <= days * 2; half++) {
    const seed = awaySeed(p);
    p = catchUp(p, T0 + half * 12 * 3_600_000, brain, (b) => awayEvent(seed, b), (want) => {
      const w = WANTS[want];
      if (w && w !== "idle") chose[w] = (chose[w] ?? 0) + 1;
    });
    for (const kind of ["feed", "play"] as const) {
      p = care(p, kind === "feed" ? { kind, food: "mochi" } : { kind }, T0 + half * 12 * 3_600_000, brain).pet;
      // the watched minute's choice, as minuteTally counts it
      const w = WANTS[p.last.want];
      if (w && w !== "idle" && !p.asleep) chose[w] = (chose[w] ?? 0) + 1;
    }
  }
  return chose;
};

describe("the pet's own choices while away (G8)", () => {
  it("the quest line asks the pet to choose to eat and to explore", () => expect(WANTED).toEqual(["eat", "explore"]));
  for (const line of ["gentle", "bold", "curious"] as const)
    it(`an untaught ${line} pet makes every choice the quest line asks for within a week of twice-daily care`, () => {
      const chose = chosenAway(line, 7);
      for (const want of WANTED) expect(chose[want] ?? 0, `${want}: ${JSON.stringify(chose)}`).toBeGreaterThan(0);
    });
});
