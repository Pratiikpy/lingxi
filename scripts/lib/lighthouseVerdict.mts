/**
 * R19: how a page's Lighthouse runs are judged (scripts/lighthouse-budget.mts). A shared CI runner gives a page a slow
 * sample now and then: handheld.html once scored 76 with its largest paint at 6,952 ms, against 910 ms and 99 to 100 on
 * the seven runs before, and that one sample failed the push. Lighthouse's own advice for a number that varies is the
 * median of several runs. A page whose first run passes is done; one whose first run does not is run twice more and
 * judged by the median of the three, each number on its own (a median run does not exist: the middle score and the
 * middle shift may come from different runs).
 */

/** One Lighthouse run of a page: its performance score (0 to 100), layout shift, and its paints and blocking in ms. */
export interface Run {
  score: number;
  shift: number;
  first: number;
  largest: number;
  blocking: number;
}
export interface Limits {
  floor: number;
  maxShift: number;
}

const RUNS_WHEN_IN_DOUBT = 3;
/** Runs whose largest paint differ by more than this, in ms, are not the same page behaving the same way. */
const UNSTEADY_MS = 2_000;

const failsAlone = (r: Run, l: Limits): boolean => r.score < l.floor || r.shift >= l.maxShift;
const middle = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
};

/** How many more runs a page needs before it can be judged: none when its first run passed, or with three in hand. */
export function moreRunsWanted(runs: readonly Run[], limits: Limits): number {
  if (runs.length >= RUNS_WHEN_IN_DOUBT) return 0;
  return runs.some((r) => failsAlone(r, limits)) ? RUNS_WHEN_IN_DOUBT - runs.length : 0;
}

/**
 * The verdict on a page's runs: the median of each number, whether that is below the floor or shifting, and whether
 * the runs were far apart (one run among them that was not like the others, worth a look even when the page passes).
 */
export function verdict(runs: readonly Run[], limits: Limits): { median: Run; bad: boolean; unsteady: boolean } {
  const median: Run = {
    score: middle(runs.map((r) => r.score)),
    shift: middle(runs.map((r) => r.shift)),
    first: middle(runs.map((r) => r.first)),
    largest: middle(runs.map((r) => r.largest)),
    blocking: middle(runs.map((r) => r.blocking)),
  };
  const paints = runs.map((r) => r.largest);
  return {
    median,
    bad: failsAlone(median, limits),
    unsteady: Math.max(...paints) - Math.min(...paints) > UNSTEADY_MS,
  };
}
