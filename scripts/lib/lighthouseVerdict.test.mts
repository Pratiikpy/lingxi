/**
 * R19: how a page's Lighthouse runs are judged. One run a page let one slow sample fail a push (handheld.html scored 76
 * once, largest paint 6,952 ms, between runs of 99 and 100). Lighthouse's own advice is the median of several runs:
 * a page that passes its first run passes; one that does not is run twice more and judged by the median of the three,
 * and every run is shown, so a page that is really slow fails and one that was slow once is seen to have been.
 */
import { describe, expect, it } from "vitest";
import { type Run, moreRunsWanted, verdict } from "./lighthouseVerdict.mts";

const run = (score: number, largest = 900, shift = 0): Run => ({ score, shift, first: 800, largest, blocking: 50 });
const LIMITS = { floor: 85, maxShift: 0.1 };

describe("judging a page's Lighthouse runs (R19)", () => {
  it("a first run that passes is the verdict; one that does not asks for two more", () => {
    expect(moreRunsWanted([run(99)], LIMITS)).toBe(0);
    expect(moreRunsWanted([run(76, 6952)], LIMITS)).toBe(2);
    expect(moreRunsWanted([run(99, 900, 0.2)], LIMITS)).toBe(2);
    // with three runs in hand nothing more is asked for
    expect(moreRunsWanted([run(76), run(99), run(100)], LIMITS)).toBe(0);
  });

  it("one slow run among three does not fail the page, and is named as the odd one", () => {
    const v = verdict([run(76, 6952), run(99, 910), run(100, 905)], LIMITS);
    expect(v.bad).toBe(false);
    expect(v.median.score).toBe(99);
    expect(v.unsteady, "a run far from the others is said").toBe(true);
  });

  it("a page slow on two runs of three fails, whatever the third says", () => {
    const v = verdict([run(70, 5000), run(72, 4800), run(99, 900)], LIMITS);
    expect(v.bad).toBe(true);
    expect(v.median.score).toBe(72);
  });

  it("layout shift is judged by its median too, and a single passing run is steady", () => {
    expect(verdict([run(99, 900, 0.3), run(99, 900, 0.2), run(99, 900, 0)], LIMITS).bad).toBe(true);
    expect(verdict([run(99, 900, 0.3), run(99, 900, 0), run(99, 900, 0)], LIMITS).bad).toBe(false);
    const one = verdict([run(97)], LIMITS);
    expect(one).toMatchObject({ bad: false, unsteady: false });
    expect(one.median.score).toBe(97);
  });
});
