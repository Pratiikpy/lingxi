import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJobs } from "../src/jobs";

describe("background jobs", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keep running after a job throws or rejects, and say so", async () => {
    const said: string[] = [];
    const jobs = createJobs((s) => said.push(s));
    let n = 0;
    jobs.every("reminders", 1000, async () => {
      n++;
      if (n === 1) throw new Error("push service down");
      if (n === 2) return Promise.reject(new Error("timeout"));
    });
    await vi.advanceTimersByTimeAsync(3100);
    expect(n).toBe(3);
    const s = jobs.status().find((j) => j.name === "reminders")!;
    expect(s).toMatchObject({ runs: 3, failures: 2, healthy: true });
    expect(s.lastError?.message).toBe("timeout");
    expect(said.join("")).toMatch(/reminders: push service down/);
    jobs.stop();
  });

  it("never start a run while the last one is still going", async () => {
    const jobs = createJobs(() => {});
    let active = 0;
    let most = 0;
    jobs.every("slow", 100, async () => {
      active++;
      most = Math.max(most, active);
      await new Promise((r) => setTimeout(r, 350));
      active--;
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(most).toBe(1);
    jobs.stop();
  });

  it("call a job unhealthy after three failures in a row, and healthy again after a success", async () => {
    const jobs = createJobs(() => {});
    let fail = true;
    jobs.loop(
      "indexer",
      async () => {
        if (fail) throw new Error("rpc down");
      },
      500,
    );
    await vi.advanceTimersByTimeAsync(1600);
    expect(jobs.status()[0]).toMatchObject({ healthy: false });
    fail = false;
    await vi.advanceTimersByTimeAsync(600);
    expect(jobs.status()[0]).toMatchObject({ healthy: true, failuresInARow: 0 });
    jobs.stop();
  });

  it("run a loop again only after its previous run finished, with the pause between", async () => {
    const jobs = createJobs(() => {});
    const starts: number[] = [];
    jobs.loop(
      "sales",
      async () => {
        starts.push(Date.now());
        await new Promise((r) => setTimeout(r, 300));
      },
      1000,
    );
    await vi.advanceTimersByTimeAsync(3000);
    expect(starts.length).toBe(3);
    expect(starts[1]! - starts[0]!).toBe(1300);
    jobs.stop();
  });
});
