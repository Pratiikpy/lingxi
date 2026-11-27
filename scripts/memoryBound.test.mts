/**
 * P10's memory gate, the method itself: the pass rule on series whose answer is known, and the tool run end to end in
 * its quick mode (small caps through each store's options, seconds of churn), where every store must reach its cap.
 * The full run (the server's own caps, two hours of churn) is a measurement, run by hand: scripts/memory-bound.mts.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FLOOR_SHARE_PER_HOUR,
  MB,
  type Sample,
  fillSteps,
  judge,
  leastSquares,
  samplesCsv,
} from "./lib/memoryBound.mts";
import { QUICK } from "./lib/memoryWorld.mts";
import { SERVER_LIMITERS, type Summary, bytesPerKey, limiterCeiling, render } from "./lib/memoryReport.mts";

const root = join(import.meta.dirname, "..");

/** A churn of `n` samples `every` seconds apart whose floor is `floor(t)` MB. */
const series = (n: number, every: number, floor: (t: number) => number): Sample[] =>
  Array.from({ length: n }, (_, i) => ({
    t: i * every,
    phase: "churn",
    step: "churn",
    heapUsed: floor(i * every) * MB,
    heapTotal: 0,
    external: 0,
    arrayBuffers: 0,
    rss: 0,
    sizes: { a: i },
  }));

describe("the pass rule (scripts/lib/memoryBound.mts)", () => {
  it("fits a line exactly when the points lie on one", () => {
    const fit = leastSquares([
      [0, 1],
      [1, 3],
      [2, 5],
    ]);
    expect(fit.slope).toBeCloseTo(2, 12);
    expect(fit.intercept).toBeCloseTo(1, 12);
    expect(fit.residualSd).toBeCloseTo(0, 12);
  });

  it("passes a level floor, and a floor that scatters by a megabyte about a level", () => {
    expect(judge(series(100, 30, () => 800)).pass).toBe(true);
    const noisy = judge(series(100, 30, (t) => 800 + Math.sin(t * 7.1) * 1));
    expect(noisy.pass).toBe(true);
    expect(noisy.residualSdMB).toBeGreaterThan(0.5);
  });

  it("fails a floor still rising faster than the tolerance, and passes one rising slower", () => {
    // 5% of the floor an hour, over 50 minutes: what a store still filling looks like
    const rising = judge(series(100, 30, (t) => 800 * (1 + (0.05 * t) / 3600)));
    expect(rising.pass).toBe(false);
    expect(rising.slopeMBPerHour).toBeCloseTo(40, 6);
    expect(rising.toleranceMBPerHour).toBeCloseTo(FLOOR_SHARE_PER_HOUR * rising.meanFloorMB, 6);
    // 1% an hour passes the 2% rule
    expect(judge(series(100, 30, (t) => 800 * (1 + (0.01 * t) / 3600))).pass).toBe(true);
  });

  it("judges the last half only: the floor settling after the fill does not count", () => {
    const settling = judge(series(100, 30, (t) => (t < 1500 ? 700 + t / 10 : 850)));
    expect(settling.pass).toBe(true);
    expect(settling.fromS).toBe(1500);
  });

  it("over a short stretch, allows the scatter two collections leave (2 MB), and no more", () => {
    // ten 2-second samples: the last five span 8 s, so 2 MB over them is 900 MB/h
    expect(judge(series(10, 2, (t) => 100 + t / 8)).pass).toBe(true);
    expect(judge(series(10, 2, (t) => 100 + t)).pass).toBe(false);
  });

  it("counts what typed arrays hold beside the heap: a floor rising only in array buffers fails", () => {
    const inBuffers = series(100, 30, () => 800).map((x) => ({ ...x, arrayBuffers: (x.t / 36) * MB }));
    const v = judge(inBuffers);
    expect(v.pass).toBe(false);
    expect(v.slopeMBPerHour).toBeCloseTo(100, 6);
    const steps = fillSteps(
      [10, 30].map((mb, i) => ({
        ...series(1, 30, () => mb)[0],
        phase: "fill" as const,
        step: `s${i}`,
        arrayBuffers: mb * MB,
      })) as Sample[],
    );
    expect(steps.map((x) => [x.floorMB, x.heapMB, x.buffersMB, x.addedMB])).toEqual([
      [20, 10, 10, 0],
      [60, 30, 30, 40],
    ]);
  });

  it("will not judge fewer than four churn samples", () => {
    expect(() => judge(series(3, 30, () => 800))).toThrow(/at least 4/);
  });

  it("writes one CSV row a sample, each store's size a column", () => {
    const csv = samplesCsv(series(3, 30, () => 10))
      .trim()
      .split("\n");
    expect(csv[0]).toContain("heap_used_mb");
    expect(csv[0]).toContain("size:a");
    expect(csv).toHaveLength(4);
    expect(csv[1]?.split(",")[3]).toBe("10.000");
  });
});

describe("the report (scripts/lib/memoryReport.mts)", () => {
  const measured = [
    { max: 20, bytesPerKey: 300 },
    { max: 60, bytesPerKey: 700 },
  ];

  it("reads a key's bytes where they were measured, and between the two nearest settings where not", () => {
    expect(bytesPerKey(measured, 20)).toBe(300);
    expect(bytesPerKey(measured, 40)).toBe(500);
    // past the largest measured, in proportion to the window
    expect(bytesPerKey(measured, 120)).toBe(1400);
  });

  it("sums every limiter the server holds at its cap of keys", () => {
    const c = limiterCeiling(measured, 1024 * 1024);
    expect(c.rows).toHaveLength(SERVER_LIMITERS.length);
    expect(c.totalMB).toBeCloseTo(
      SERVER_LIMITERS.reduce((n, l) => n + bytesPerKey(measured, l.max), 0),
      6,
    );
    expect(c.slowWindowsMB).toBeLessThan(c.totalMB);
  });

  it("says the verdict, each step and each probe in words", () => {
    const summary: Summary = {
      mode: "full",
      commit: "abc1234",
      node: "v24",
      startedAt: "2026-11-27T00:00:00.000Z",
      seconds: 600,
      churnSeconds: 240,
      sampleEverySeconds: 30,
      caps: QUICK,
      steps: [
        { step: "duels", floorMB: 120, addedMB: 9.5, cap: "MAX_KEPT 50,000", door: "POST /api/duels", seconds: 3 },
      ],
      sizesAtEndOfFill: { duels: 50_000 },
      sizesAtEnd: { duels: 50_000 },
      churnTicks: { duels: 10 },
      churnErrors: {},
      verdict: judge(series(8, 30, () => 500)),
      probes: [
        {
          name: "sitting",
          what: "tiny packs",
          bytesEach: 533,
          added: 20_000,
          beforeMB: 1,
          afterMB: 11,
          note: "no cap",
        },
        { name: "limiters", perMax: measured, keysEach: 50_000 },
      ],
      stopped: null,
    };
    const text = render(summary);
    expect(text).toContain("server at abc1234");
    expect(text).toContain("The churn: PASS");
    const row = text.split("\n").find((l) => l.startsWith("duels"));
    expect(row?.split(" ").filter(Boolean)).toEqual(["duels", "120.0", "9.5", "3.0"]);
    expect(text).toContain("cap: MAX_KEPT 50,000");
    expect(text).toContain("sitting: 533 bytes each, over 20,000");
    expect(text).toContain("every limiter the server holds at 50,000 keys");
  });
});

describe("the tool, quick mode, end to end", () => {
  it("fills every store to its quick cap, churns past it, and judges the floor", () => {
    const out = mkdtempSync(join(tmpdir(), "lingxi-memory-bound-"));
    try {
      const run = spawnSync(
        process.execPath,
        ["--expose-gc", "--import", "tsx", "scripts/memory-bound.mts", "--quick", "--churn", "16", "--out", out],
        { cwd: root, encoding: "utf8", timeout: 110_000 },
      );
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      const summary = JSON.parse(readFileSync(join(out, "summary.json"), "utf8")) as {
        steps: Array<{ step: string; error?: string }>;
        sizesAtEndOfFill: Record<string, number>;
        verdict: { pass: boolean; judged: number } | null;
        probes: unknown[];
        stopped: string | null;
      };
      expect(summary.stopped).toBeNull();
      expect(summary.steps.filter((s) => s.error)).toEqual([]);
      const z = summary.sizesAtEndOfFill;
      const c = QUICK;
      expect({
        errors: z.errors,
        duels: z.duels,
        papers: z.papers,
        library: z.library,
        decor: z.decor,
        homes: z.homes,
        push: z.push,
        arena: z.arena,
        seasonEntries: z.seasonEntries,
        live: z.live,
        agents: z.agents,
      }).toEqual({
        errors: c.errorsKept,
        duels: c.duels.count,
        papers: c.papers.count,
        library: c.library.max,
        decor: c.decor,
        homes: c.homes,
        push: c.push,
        arena: c.arenaRounds * 60,
        seasonEntries: c.seasonWeeks * c.seasonEntries,
        live: c.live,
        agents: c.agents,
      });
      // the shelves held to bytes are full to within the last pack a newcomer's share allows
      expect(z.sittingBytes).toBeGreaterThan(0.98 * c.sitting.maxBytes);
      expect(z.diaryBytes).toBeGreaterThan(0.9 * c.diaries.totalBytes);
      expect(z.moveChars).toBeGreaterThan(0.98 * c.moveChars);
      // every limiter a route was handed holds its cap of keys, but the teach route's, which this tool never calls
      const limiters = Object.entries(z).filter(([k]) => k.startsWith("limiter:") && k !== "limiter:teach");
      expect(limiters.length).toBeGreaterThan(10);
      expect(limiters.filter(([, v]) => v !== c.limiterKeys)).toEqual([]);
      expect(summary.verdict?.judged).toBeGreaterThanOrEqual(3);
      expect(summary.verdict?.pass).toBe(true);
      expect(summary.probes.length).toBeGreaterThanOrEqual(5);
      // the scratch stores are removed; the results stay
      expect(existsSync(join(out, "stores"))).toBe(false);
      expect(readFileSync(join(out, "samples.csv"), "utf8").split("\n").length).toBeGreaterThan(25);
      expect(readFileSync(join(out, "summary.txt"), "utf8")).toContain("The churn: PASS");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
