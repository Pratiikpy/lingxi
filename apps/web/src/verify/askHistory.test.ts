import { afterEach, describe, expect, it, vi } from "vitest";
import { askHistory } from "./askHistory";

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("a newborn's history is asked for again while it is empty (A31)", () => {
  afterEach(() => vi.useRealTimers());

  it("asks again after the indexer's interval and shows the history once it is there", async () => {
    vi.useFakeTimers();
    const answers = [null, null, { saves: 1 }];
    const fetchOnce = vi.fn(async () => answers.shift() ?? null);
    const seen: unknown[] = [];
    askHistory(fetchOnce, (h) => seen.push(h), 8, 15_000);
    await settle();
    expect(seen).toEqual(["none"]);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(seen).toEqual(["none", "none", { saves: 1 }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchOnce, "it stops at the first history").toHaveBeenCalledTimes(3);
  });

  it("gives up after its retries, and a failed read counts as empty", async () => {
    vi.useFakeTimers();
    const fetchOnce = vi.fn(async () => Promise.reject(new Error("offline")));
    const seen: unknown[] = [];
    askHistory(fetchOnce, (h) => seen.push(h), 2, 1_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchOnce).toHaveBeenCalledTimes(3);
    expect(seen).toEqual(["none", "none", "none"]);
  });

  it("stops when the page moves on", async () => {
    vi.useFakeTimers();
    const fetchOnce = vi.fn(async () => null);
    const stop = askHistory(fetchOnce, () => undefined, 8, 1_000);
    await settle();
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchOnce).toHaveBeenCalledTimes(1);
  });
});
