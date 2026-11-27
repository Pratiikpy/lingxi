/**
 * P10's memory gate: one game server in this process, every store a stranger can grow filled to its cap, then written
 * past every cap for a while, the heap's floor read after forced collections at each step and every few seconds of the
 * churn. Exits 0 when the floor has levelled off (scripts/lib/memoryBound.mts states the rule and why), 1 when it still
 * rises or a step failed, 3 when this machine ran short of memory first (what was seen until then is written).
 *
 *   node --expose-gc --import tsx scripts/memory-bound.mts            the server's own caps, two hours of churn
 *   node --expose-gc --import tsx scripts/memory-bound.mts --quick    small caps, a minute of churn (the method's test)
 *
 * Options: --churn <s> (seconds of churn), --every <s> (between samples), --out <dir> (default e2e/.run/memory-bound/
 * <time>), --no-probes, --keep-stores (the scratch stores are removed at the end otherwise). Each run writes samples.csv,
 * samples.json, summary.json and summary.txt in <out>; `--render <dir>` writes a result folder's summary.txt again.
 *
 * Nothing here reaches the network or the live server's data: every store is in <out>/stores, the chain, the model and
 * the push service are stand-ins in this process (scripts/lib/memoryWorld.mts), and the routes that would call the
 * model or spend OKB (/api/teach, /api/voice, /api/tapeout's relayer, /api/sponsor) are never sent a request that
 * reaches either.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { join, resolve } from "node:path";
import { MB, type Sample, fillSteps, floorNow, judge, samplesCsv } from "./lib/memoryBound.mts";
import type { Ctx } from "./lib/memoryFill.mts";
import { type Summary, render } from "./lib/memoryReport.mts";

const RSS_LIMIT = 3 * 1024 * MB;
const FREE_LIMIT = 1.5 * 1024 * MB;

class OutOfRoom extends Error {}

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const rendering = value("--render");
if (rendering !== undefined) {
  const dir = resolve(rendering);
  writeFileSync(
    join(dir, "summary.txt"),
    render(JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")) as Summary),
  );
  process.stdout.write(`${join(dir, "summary.txt")}
`);
  process.exit(0);
}
const quick = flag("--quick");
// two hours: most limiters count an hour, so until an hour has passed their windows only fill and never let a request go;
// the second hour, the half judged, is the first in which every hour-long window lets go as much as it takes in
const churnS = Number(value("--churn") ?? (quick ? 60 : 7_200));
const everyS = Number(value("--every") ?? (quick ? 2 : 30));
const root = resolve(import.meta.dirname, "..");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = resolve(
  value("--out") ?? join(root, "e2e", ".run", "memory-bound", `${quick ? "quick" : "full"}-${stamp}`),
);
const storesDir = join(out, "stores");

if (!(globalThis as { gc?: unknown }).gc) {
  process.stderr.write(
    "run with node --expose-gc --import tsx scripts/memory-bound.mts: the floor is read after forced collections\n",
  );
  process.exit(2);
}
if (!Number.isFinite(churnS) || churnS < 8 || !Number.isFinite(everyS) || everyS <= 0) {
  process.stderr.write("--churn takes seconds (8 or more), --every seconds (more than 0)\n");
  process.exit(2);
}

mkdirSync(storesDir, { recursive: true });
// the stores' address key, in the scratch folder: never the one beside the live server's stores (pseudonym.ts)
process.env.LINGXI_IP_KEY_FILE = join(storesDir, "ip-key");

const { FULL, QUICK, buildWorld } = await import("./lib/memoryWorld.mts");
const { STEPS, homeId } = await import("./lib/memoryFill.mts");
const churn = await import("./lib/memoryChurn.mts");

const caps = quick ? QUICK : FULL;
const clock = { offset: 0, now: () => Date.now() + clock.offset };
const world = buildWorld(storesDir, caps, clock);
const log = (line: string) => process.stdout.write(`${line}\n`);
const ctx: Ctx = {
  world,
  caps,
  clock,
  log,
  counts: {},
  sockets: [],
  state: {
    moves: [],
    agents: [],
    homes: 0,
    lessons: [],
    nonces: [],
    papersNext: 0,
    diaryNext: 0,
    duelNext: 0,
    homeNext: 0,
    socketNext: 0,
    roomNext: 0,
    nonceNext: 0,
    pool: { from: 0, size: 0 },
  },
  check: () => {
    const rss = process.memoryUsage.rss();
    const free = freemem();
    if (rss > RSS_LIMIT || free < FREE_LIMIT)
      throw new OutOfRoom(
        `stopped for memory: this process ${(rss / MB).toFixed(0)} MB, the machine ${(free / MB).toFixed(0)} MB free`,
      );
  },
};

const t0 = performance.now();
const samples: Sample[] = [];
const sizes = (): Record<string, number> => {
  const s = world.stores;
  const sit = s.sitting.stats();
  const diary = s.diaries.stats();
  const weeks = s.season.weeks();
  const out: Record<string, number> = {
    errors: s.errors.latest(1_000).length,
    errorTimes: s.errors.lastHour(),
    duels: s.duels.size(),
    papers: s.papers.size(),
    diaries: diary.diaries,
    diaryBytes: diary.bytes,
    sittingPacks: sit.packs,
    sittingBytes: sit.bytes,
    arena: Array.from({ length: 31 }, (_, r) => s.arena.count(r)).reduce((a, b) => a + b, 0),
    seasonWeeks: weeks.length,
    seasonEntries: weeks.reduce((n, w) => n + (s.season.view(w)?.entries.length ?? 0), 0),
    library: s.library.size(),
    push: s.push.size(),
    sponsor: s.sponsor.pets().length,
    decor: s.decor.size(),
    homes: Array.from({ length: ctx.state.homes }, (_, i) => s.homes.wallets(homeId(i)).length > 0).filter(Boolean)
      .length,
    live: world.rooms.stats().online,
    ...ctx.counts,
  };
  for (const l of world.limiters) out[`limiter:${l.name}`] = l.limiter.size();
  return out;
};
const sample = async (phase: Sample["phase"], step: string): Promise<Sample> => {
  const m = await floorNow();
  const s: Sample = {
    t: (performance.now() - t0) / 1000,
    phase,
    step,
    heapUsed: m.heapUsed,
    heapTotal: m.heapTotal,
    external: m.external,
    arrayBuffers: m.arrayBuffers,
    rss: m.rss,
    sizes: sizes(),
  };
  samples.push(s);
  log(
    `${s.t.toFixed(0).padStart(6)} s  ${phase.padEnd(5)} ${step.padEnd(14)} floor ${(m.heapUsed / MB).toFixed(1).padStart(8)} MB  rss ${(m.rss / MB).toFixed(0).padStart(5)} MB`,
  );
  return s;
};

const steps: Array<{ name: string; cap: string; door: string; seconds: number; error?: string }> = [];
const churnErrors: Record<string, { count: number; first: string }> = {};
const churnTicks: Record<string, number> = {};
const probes: unknown[] = [];
let stopped: string | null = null;

/** the commit the server's code is at, so a result names what it measured */
const commit = (() => {
  try {
    const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "services", "packages"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    return dirty ? `${head} with changes not committed` : head;
  } catch {
    // no git here (a copy of the tree): the summary says nothing of the commit rather than guess it
    return undefined;
  }
})();

const write = () => {
  const verdict = samples.filter((s) => s.phase === "churn").length >= 4 ? judge(samples) : null;
  const churnRss = samples.filter((s) => s.phase === "churn").map((s) => s.rss / MB);
  const summary: Summary = {
    mode: quick ? "quick" : "full",
    ...(commit ? { commit } : {}),
    node: process.version,
    startedAt: new Date(Date.now() - (performance.now() - t0)).toISOString(),
    seconds: (performance.now() - t0) / 1000,
    churnSeconds: churnS,
    sampleEverySeconds: everyS,
    caps,
    steps: fillSteps(samples).map((f) => ({ ...f, ...(steps.find((s) => s.name === f.step) ?? {}) })),
    sizesAtEndOfFill: [...samples].reverse().find((s) => s.phase === "fill")?.sizes ?? {},
    sizesAtEnd: samples[samples.length - 1]?.sizes ?? {},
    churnTicks,
    churnErrors,
    verdict,
    ...(churnRss.length ? { churnRssMB: { min: Math.min(...churnRss), max: Math.max(...churnRss) } } : {}),
    probes: probes as Summary["probes"],
    stopped,
  };
  writeFileSync(join(out, "samples.csv"), samplesCsv(samples));
  writeFileSync(join(out, "samples.json"), JSON.stringify(samples, null, 1));
  writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(out, "summary.txt"), render(summary));
  return verdict;
};

const finish = (code: number) => {
  if (!flag("--keep-stores")) rmSync(storesDir, { recursive: true, force: true });
  log(`results in ${out}`);
  process.exit(code);
};

try {
  log(`memory bound, ${quick ? "quick" : "full"} mode: stores in ${storesDir}`);
  await sample("fill", "start");
  for (const step of STEPS) {
    const t = performance.now();
    try {
      await step.run(ctx);
      steps.push({ name: step.name, cap: step.cap, door: step.door, seconds: (performance.now() - t) / 1000 });
    } catch (e) {
      if (e instanceof OutOfRoom) throw e;
      steps.push({
        name: step.name,
        cap: step.cap,
        door: step.door,
        seconds: (performance.now() - t) / 1000,
        error: (e as Error).stack ?? String(e),
      });
      log(`step ${step.name} failed: ${(e as Error).message}`);
    }
    await sample("fill", step.name);
  }

  const end = performance.now() + churnS * 1000;
  let nextSample = performance.now() + everyS * 1000;
  const lastTurn = new Map<string, number>();
  while (performance.now() < end) {
    for (const c of churn.CHURNERS) {
      const now = performance.now();
      if (now - (lastTurn.get(c.name) ?? -Infinity) < c.every) continue;
      lastTurn.set(c.name, now);
      try {
        await c.tick(ctx);
        churnTicks[c.name] = (churnTicks[c.name] ?? 0) + 1;
      } catch (e) {
        if (e instanceof OutOfRoom) throw e;
        const held = churnErrors[c.name];
        churnErrors[c.name] = { count: (held?.count ?? 0) + 1, first: held?.first ?? String((e as Error).stack ?? e) };
      }
    }
    // the event loop's own turn: the stores' save timers and the rooms' pings run here, as they would between requests
    await new Promise((r) => setImmediate(r));
    if (performance.now() >= nextSample) {
      ctx.check();
      await sample("churn", "churn");
      nextSample = performance.now() + everyS * 1000;
    }
  }

  if (!flag("--no-probes")) {
    probes.push(...(await churn.probeAgentLogs(ctx, quick ? 1 : 2)));
    probes.push(await churn.probeDiarySpenders(ctx, quick ? 2_000 : 100_000));
    probes.push(await churn.probeSittingCount(ctx, quick ? 400 : 20_000));
    probes.push(await churn.probeLiveSeen(ctx, quick ? 48 : 4_000, quick ? 1 : 2));
    const ceiling = await churn.probeLimiterCeiling(ctx, quick ? 100 : 5_000);
    probes.push({ name: "rate limiters at their ceiling", perMax: ceiling, keysEach: caps.limiterKeys });
  }
} catch (e) {
  if (!(e instanceof OutOfRoom)) throw e;
  stopped = e.message;
  log(e.message);
}

const verdict = write();
if (verdict) log(verdict.why);
if (stopped) finish(3);
finish(verdict?.pass && steps.every((s) => !s.error) ? 0 : 1);
