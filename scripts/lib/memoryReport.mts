/**
 * P10's memory gate: the run's summary as a person reads it (summary.txt beside summary.json), and the rate limiters'
 * ceiling worked out from what the run measured: every limiter the server holds, at its cap of keys each with its whole
 * window of requests, at the bytes a key was measured to take at that setting.
 */
import type { Verdict } from "./memoryBound.mts";
import type { Caps } from "./memoryWorld.mts";

export interface Summary {
  mode: string;
  commit?: string;
  node: string;
  startedAt: string;
  seconds: number;
  churnSeconds: number;
  sampleEverySeconds: number;
  /** the caps the run filled to (memoryWorld.mts FULL or QUICK) */
  caps: Caps;
  steps: Array<{
    step: string;
    floorMB: number;
    /** of the floor, the heap and the array buffers (results before these were kept read the heap alone) */
    heapMB?: number;
    buffersMB?: number;
    addedMB: number;
    cap?: string;
    door?: string;
    seconds?: number;
    error?: string;
  }>;
  sizesAtEndOfFill: Record<string, number>;
  sizesAtEnd: Record<string, number>;
  churnTicks: Record<string, number>;
  churnErrors: Record<string, { count: number; first: string }>;
  verdict: Verdict | null;
  churnRssMB?: { min: number; max: number };
  probes: Array<Record<string, unknown>>;
  stopped: string | null;
}

/**
 * Every rate limiter the live server holds (each keeps at most 50,000 keys, limit.ts), with its setting: what the
 * ceiling is summed over. Where a limiter is made only when a part is switched on, it is counted as on.
 */
export const SERVER_LIMITERS: ReadonlyArray<{
  name: string;
  max: number;
  per: "minute" | "hour" | "day" | "10 minutes";
}> = [
  { name: "teach (server.ts)", max: 6, per: "minute" },
  { name: "relay (server.ts)", max: 20, per: "hour" },
  { name: "voice (routes/play.ts)", max: 40, per: "10 minutes" },
  { name: "sitting writes", max: 30, per: "hour" },
  { name: "arena writes", max: 120, per: "hour" },
  { name: "move", max: 20, per: "hour" },
  { name: "push plans", max: 30, per: "hour" },
  { name: "library writes", max: 60, per: "hour" },
  { name: "client errors", max: 20, per: "hour" },
  { name: "season entries", max: 30, per: "hour" },
  { name: "sponsor", max: 20, per: "hour" },
  { name: "agent API", max: 240, per: "hour" },
  { name: "MCP", max: 120, per: "hour" },
  { name: "MCP proposals (shared)", max: 60, per: "minute" },
  { name: "TAP-13 methods", max: 240, per: "hour" },
  { name: "RPC door", max: 600, per: "minute" },
  { name: "papers posts", max: 30, per: "hour" },
  { name: "duel links", max: 30, per: "minute" },
  { name: "diary posts", max: 20, per: "hour" },
  { name: "read: season", max: 60, per: "minute" },
  { name: "read: diary", max: 30, per: "minute" },
  { name: "read: duel link", max: 120, per: "minute" },
  { name: "read: tree", max: 30, per: "minute" },
  { name: "read: agent pet", max: 60, per: "minute" },
  { name: "read: sitting pack", max: 30, per: "minute" },
  { name: "read: papers", max: 60, per: "minute" },
  { name: "home views (homes.ts)", max: 20, per: "minute" },
  { name: "card asks (live.ts)", max: 30, per: "minute" },
  { name: "new homes (live.ts)", max: 5, per: "day" },
  { name: "Sourcify checks", max: 120, per: "minute" },
];

/** Bytes a key takes at `max`, from the probe's measured settings: measured where it was, else between the two nearest. */
export function bytesPerKey(measured: ReadonlyArray<{ max: number; bytesPerKey: number }>, max: number): number {
  const sorted = [...measured].sort((a, b) => a.max - b.max);
  const exact = sorted.find((m) => m.max === max);
  if (exact) return exact.bytesPerKey;
  const above = sorted.find((m) => m.max > max);
  const below = [...sorted].reverse().find((m) => m.max < max);
  if (!above) return below ? below.bytesPerKey * (max / below.max) : 0;
  if (!below) return above.bytesPerKey * (max / above.max);
  return below.bytesPerKey + ((above.bytesPerKey - below.bytesPerKey) * (max - below.max)) / (above.max - below.max);
}

/** The ceiling of every limiter the server holds, at `keys` keys each, in MB. */
export function limiterCeiling(measured: ReadonlyArray<{ max: number; bytesPerKey: number }>, keys: number) {
  const rows = SERVER_LIMITERS.map((l) => ({ ...l, mb: (bytesPerKey(measured, l.max) * keys) / (1024 * 1024) }));
  const sum = (per: string[]) => rows.filter((r) => per.includes(r.per)).reduce((n, r) => n + r.mb, 0);
  return { rows, totalMB: sum(["minute", "hour", "day", "10 minutes"]), slowWindowsMB: sum(["hour", "day"]) };
}

const f1 = (x: number) => x.toFixed(1);

/** The summary as text. */
export function render(s: Summary): string {
  const lines: string[] = [];
  const add = (l = "") => lines.push(l);
  add(`P10 memory bound, ${s.mode} mode${s.commit ? `, server at ${s.commit}` : ""}, node ${s.node}`);
  add(
    `started ${s.startedAt}, ${f1(s.seconds / 60)} minutes in all; churn ${f1(s.churnSeconds / 60)} minutes, a sample every ${s.sampleEverySeconds} s`,
  );
  if (s.stopped) add(`STOPPED: ${s.stopped}`);
  add();
  add(
    "The fill: the floor (collected, with the event loop let turn) after each step, and what the step added; the floor is the heap and the array buffers beside it",
  );
  add(
    `${"step".padEnd(14)} ${"floor MB".padStart(9)} ${"heap MB".padStart(9)} ${"buffers".padStart(9)} ${"added MB".padStart(9)} ${"seconds".padStart(8)}`,
  );
  for (const st of s.steps) {
    const part = (x: number | undefined) => (x === undefined ? "" : f1(x)).padStart(9);
    add(
      `${st.step.padEnd(14)} ${f1(st.floorMB).padStart(9)} ${part(st.heapMB)} ${part(st.buffersMB)} ${f1(st.addedMB).padStart(9)} ${(st.seconds === undefined ? "" : f1(st.seconds)).padStart(8)}${st.error ? `  FAILED: ${st.error.split("\n")[0]}` : ""}`,
    );
    if (st.cap) add(`               cap: ${st.cap}`);
    if (st.door) add(`               door: ${st.door}`);
  }
  add();
  add("Each store's size at the end of the fill, and at the end of the run");
  for (const [k, v] of Object.entries(s.sizesAtEndOfFill))
    add(`  ${k.padEnd(22)} ${String(v).padStart(12)} ${String(s.sizesAtEnd[k] ?? "").padStart(12)}`);
  add();
  const v = s.verdict;
  if (v) {
    add(`The churn: ${v.pass ? "PASS" : "FAIL"}, ${v.why}`);
    add(`  floor: first ${f1(v.firstFloorMB)} MB, middle ${f1(v.middleFloorMB)} MB, last ${f1(v.lastFloorMB)} MB`);
    add(
      `  judged: the last ${v.judged} samples (${f1(v.fromS / 60)} to ${f1(v.toS / 60)} minutes), mean floor ${f1(v.meanFloorMB)} MB`,
    );
    add(
      `  slope ${v.slopeMBPerHour.toFixed(2)} MB/h (a rise of ${v.riseMB.toFixed(2)} MB over the stretch), scatter ${v.residualSdMB.toFixed(2)} MB, tolerance ${v.toleranceMBPerHour.toFixed(2)} MB/h`,
    );
    if (s.churnRssMB)
      add(`  rss during the churn: ${s.churnRssMB.min.toFixed(0)} to ${s.churnRssMB.max.toFixed(0)} MB`);
  } else add("The churn: not judged (fewer than four samples)");
  const errs = Object.entries(s.churnErrors);
  add(
    `  turns: ${Object.entries(s.churnTicks)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ")}`,
  );
  if (errs.length) for (const [k, e] of errs) add(`  errors in ${k}: ${e.count}, first: ${e.first.split("\n")[0]}`);
  add();
  add("The probes: what each store keeps for one more caller, pet or pack, at its bound, in bytes");
  for (const p of s.probes) {
    if (Array.isArray(p.perMax)) {
      const measured = p.perMax as Array<{ max: number; bytesPerKey: number }>;
      const keys = Number(p.keysEach);
      const c = limiterCeiling(measured, keys);
      add(
        `  ${String(p.name)}: bytes a key takes with its window full, by setting: ${measured.map((m) => `${m.max}: ${m.bytesPerKey.toFixed(0)}`).join(", ")}`,
      );
      add(
        `    every limiter the server holds at ${keys.toLocaleString("en")} keys, each window full: ${f1(c.totalMB)} MB (${f1(c.slowWindowsMB)} MB of it in limiters an hour or a day long)`,
      );
      continue;
    }
    add(
      `  ${String(p.name)}: ${Number(p.bytesEach).toFixed(0)} bytes each, over ${Number(p.added).toLocaleString("en")} (${f1(Number(p.beforeMB))} to ${f1(Number(p.afterMB))} MB)`,
    );
    add(`    ${String(p.what)}`);
    if (p.note) add(`    ${String(p.note)}`);
    if (p.held !== undefined) add(`    the store holds ${Number(p.held).toLocaleString("en")} afterwards`);
    if (p.msPerLeaveAtEnd !== undefined) add(`    a leave took ${Number(p.msPerLeaveAtEnd).toFixed(2)} ms at the end`);
  }
  return `${lines.join("\n")}\n`;
}
