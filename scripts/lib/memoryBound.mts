/**
 * P10's memory gate, the measuring half: a heap floor sample, the fit of a line through the floor over time, and the
 * rule that says whether the floor has levelled off. No server code here, so the rule is tested on its own
 * (scripts/memoryBound.test.mts) against series whose answer is known.
 *
 * The floor is what the heap holds once collected with the event loop let turn between collections, so it is what the
 * process keeps, not what it happened to have allocated since the last sweep. The turns matter: a request re-made as a
 * new Request (hono's bodyLimit, for a body sent without a length) is let go only by a finalizer, which runs as a task
 * after a collection; read with no turn, 10,000 such requests read as 7.8 MB kept, and after two turns as none
 * (measured 2026-11-27, in process and over HTTP alike).
 */

/** One reading of the process's memory, in bytes, and of each store's size. */
export interface Sample {
  /** seconds since the run began */
  t: number;
  /** "fill" while stores are being filled, "churn" while they are written past their caps */
  phase: "fill" | "churn";
  /** the fill step just finished, or "churn" */
  step: string;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
  /** each store's size, as the store reports it (or as the tool counts it, for a store with no way to say) */
  sizes: Record<string, number>;
}

export const MB = 1024 * 1024;

/** Collections with the event loop let turn between them: two were measured to be enough, three are taken. */
export const SETTLE_ROUNDS = 3;

/** The heap's floor now: collected, the event loop let turn, three times; then collected twice and read. */
export async function floorNow(): Promise<NodeJS.MemoryUsage> {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) throw new Error("run with node --expose-gc: the floor is read after forced collections");
  for (let i = 0; i < SETTLE_ROUNDS; i++) {
    gc();
    await new Promise((r) => setTimeout(r, 20));
  }
  gc();
  gc();
  return process.memoryUsage();
}

/** The least-squares line y = a + b·x through the points, and the scatter of the points about it. */
export function leastSquares(points: ReadonlyArray<readonly [number, number]>): {
  slope: number;
  intercept: number;
  residualSd: number;
} {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.[1] ?? 0, residualSd: 0 };
  const mx = points.reduce((s, [x]) => s + x, 0) / n;
  const my = points.reduce((s, [, y]) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const [x, y] of points) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const ss = points.reduce((s, [x, y]) => s + (y - (intercept + slope * x)) ** 2, 0);
  return { slope, intercept, residualSd: n > 2 ? Math.sqrt(ss / (n - 2)) : 0 };
}

/**
 * The pass rule. The floor is judged over the last half of the churn's samples: the first half is the heap settling
 * after the fill (caches warming, the last transient buffers going). It passes when the fitted slope is at most
 *
 *   max(FLOOR_SHARE_PER_HOUR of the mean floor per hour, NOISE_MB over the judged stretch).
 *
 * Why these two numbers:
 * - 2% of the floor an hour. The soak of 2026-11-18 rose by about 16 MB an hour on a floor of about 80 MB (20% an hour)
 *   while its stores were still filling: that is what "not yet level" looked like, and this tolerance sits ten times
 *   below it. A store growing past its cap by even one entry a second shows above it within a 45-minute churn. And at
 *   2% an hour, a floor still rising would take two days of the worst traffic to double: longer than a release lives.
 * - 2 MB over the stretch judged. Two forced collections do not leave the heap at exactly the same size twice (code
 *   compiled, a pooled buffer kept, the order a sweep finds things in), so a short stretch cannot tell a slope smaller
 *   than that scatter from none. Over a 25-minute stretch this allows under 5 MB an hour, below the 2% of any floor over
 *   250 MB, so for the full run the 2% governs; over the quick mode's seconds it governs instead, and the quick mode
 *   then checks the method, not the bound.
 */
export const FLOOR_SHARE_PER_HOUR = 0.02;
export const NOISE_MB = 2;

export interface Verdict {
  /** samples judged, and the stretch they cover */
  judged: number;
  fromS: number;
  toS: number;
  firstFloorMB: number;
  middleFloorMB: number;
  lastFloorMB: number;
  meanFloorMB: number;
  slopeMBPerHour: number;
  residualSdMB: number;
  toleranceMBPerHour: number;
  /** the fit's rise over the stretch judged, in MB */
  riseMB: number;
  pass: boolean;
  why: string;
}

/** Whether the churn's floor has levelled off (see the pass rule above). Needs at least four churn samples. */
export function judge(samples: readonly Sample[]): Verdict {
  const churn = samples.filter((s) => s.phase === "churn");
  if (churn.length < 4)
    throw new Error(`the churn has ${churn.length} samples: at least 4 are needed to judge a slope`);
  const judged = churn.slice(Math.floor(churn.length / 2));
  const points = judged.map((s) => [s.t / 3600, s.heapUsed / MB] as const);
  const fit = leastSquares(points);
  // at least two samples are judged (half of four or more), so each end is there
  const at = (list: readonly Sample[], i: number): Sample => list[Math.max(0, Math.min(list.length - 1, i))] as Sample;
  const fromS = at(judged, 0).t;
  const toS = at(judged, judged.length - 1).t;
  const hours = (toS - fromS) / 3600;
  const meanFloorMB = points.reduce((s, [, y]) => s + y, 0) / points.length;
  const toleranceMBPerHour = Math.max(FLOOR_SHARE_PER_HOUR * meanFloorMB, hours > 0 ? NOISE_MB / hours : Infinity);
  const pass = fit.slope <= toleranceMBPerHour;
  const f = (x: number) => x.toFixed(2);
  return {
    judged: judged.length,
    fromS,
    toS,
    firstFloorMB: at(churn, 0).heapUsed / MB,
    middleFloorMB: at(churn, Math.floor(churn.length / 2)).heapUsed / MB,
    lastFloorMB: at(churn, churn.length - 1).heapUsed / MB,
    meanFloorMB,
    slopeMBPerHour: fit.slope,
    residualSdMB: fit.residualSd,
    toleranceMBPerHour,
    riseMB: fit.slope * hours,
    pass,
    why: pass
      ? `the floor's slope, ${f(fit.slope)} MB/h, is within ${f(toleranceMBPerHour)} MB/h`
      : `the floor still rises: ${f(fit.slope)} MB/h, over the ${f(toleranceMBPerHour)} MB/h allowed`,
  };
}

/** The samples as CSV: one row each, a column for every memory reading in MB and for every store's size. */
export function samplesCsv(samples: readonly Sample[]): string {
  const stores = [...new Set(samples.flatMap((s) => Object.keys(s.sizes)))].sort();
  const head = ["t_s", "phase", "step", "heap_used_mb", "heap_total_mb", "external_mb", "array_buffers_mb", "rss_mb"];
  const mb = (n: number) => (n / MB).toFixed(3);
  const rows = samples.map((s) =>
    [
      s.t.toFixed(1),
      s.phase,
      s.step,
      mb(s.heapUsed),
      mb(s.heapTotal),
      mb(s.external),
      mb(s.arrayBuffers),
      mb(s.rss),
      ...stores.map((k) => String(s.sizes[k] ?? "")),
    ].join(","),
  );
  return `${[...head, ...stores.map((k) => `size:${k}`)].join(",")}\n${rows.join("\n")}\n`;
}

/** What the heap gained at each fill step: the floor after it, less the floor before it. */
export function fillSteps(samples: readonly Sample[]): Array<{ step: string; floorMB: number; addedMB: number }> {
  const fill = samples.filter((s) => s.phase === "fill");
  return fill.map((s, i) => ({
    step: s.step,
    floorMB: s.heapUsed / MB,
    addedMB: (s.heapUsed - (fill[i - 1] ?? s).heapUsed) / MB,
  }));
}
