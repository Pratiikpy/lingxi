/**
 * R10: the service worker and a page on a slow network. The worker (apps/web/public/sw.js) is run here as it is
 * shipped, in a stand-in worker with its own caches, network and clock. A page asked for on a network slower than the
 * worker's short wait used to fail outright when no copy was kept ("offline, and this page is not kept"), though the
 * request it had started was still on its way: a first visit on a slow connection got an error the server never sent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(join(import.meta.dirname, "..", "apps", "web", "public", "sw.js"), "utf8");
const ORIGIN = "https://lingxi.test";
const PAGE = `${ORIGIN}/numbers.html`;

interface Answer {
  ok: boolean;
  from: string;
  clone: () => Answer;
}
const answer = (from: string): Answer => ({ ok: true, from, clone: () => answer(from) });

/** The worker, started in a scope of its own: its caches, what its network does with a request, and its handlers. */
function worker(network: (url: string) => Promise<Answer>) {
  const stores = new Map<string, Map<string, Answer>>();
  const store = (name: string) => stores.get(name) ?? stores.set(name, new Map()).get(name)!;
  const keyOf = (r: { url: string } | string) => (typeof r === "string" ? r : r.url).split("?")[0]!;
  const open = (name: string) => ({
    match: async (r: { url: string }) => store(name).get(keyOf(r)),
    put: async (r: { url: string }, a: Answer) => void store(name).set(keyOf(r), a),
    add: async () => undefined,
  });
  const caches = {
    open: async (name: string) => open(name),
    match: async (r: { url: string }) => [...stores.values()].map((s) => s.get(keyOf(r))).find(Boolean),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  const handlers: Record<string, (e: unknown) => void> = {};
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => void (handlers[type] = fn),
    location: { origin: ORIGIN },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  // the shipped worker, run as shipped
  new Function("self", "caches", "fetch", source)(self, caches, (r: { url: string }) => network(r.url));
  /** Asks the worker for a page, as a navigation does; resolves or rejects as the page would. */
  const ask = (url: string) => {
    const waits: Promise<unknown>[] = [];
    let given: Promise<Answer> | undefined;
    handlers.fetch!({
      request: { method: "GET", url, mode: "navigate" },
      respondWith: (p: Promise<Answer>) => void (given = p),
      waitUntil: (p: Promise<unknown>) => void waits.push(p),
    });
    return { page: given!, waits };
  };
  return {
    ask,
    kept: (url: string) => store("lingxi-dev").get(url),
    keep: (url: string, a: Answer) => store("lingxi-dev").set(url, a),
  };
}

/** A network that answers after `ms`, or never reaches the server at all. */
const after = (ms: number, a: Answer) => () => new Promise<Answer>((yes) => setTimeout(() => yes(a), ms));
const down = () => () => Promise.reject(new TypeError("Failed to fetch"));

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe("a page asked of the service worker (R10)", () => {
  it("slow network, nothing kept: the page is the network's answer when it comes, not an error", async () => {
    const w = worker(after(10_000, answer("network")));
    const { page } = w.ask(PAGE);
    const outcome = page.then(
      (a) => a.from,
      (e: Error) => `failed: ${e.message}`,
    );
    await vi.advanceTimersByTimeAsync(4_000);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(await outcome).toBe("network");
    expect(w.kept(PAGE)?.from, "and it is kept for next time").toBe("network");
  });

  it("slow network, a copy kept: the kept copy opens after the short wait, and the late answer refreshes it", async () => {
    const w = worker(after(10_000, answer("network, later")));
    w.keep(PAGE, answer("kept"));
    const { page, waits } = w.ask(PAGE);
    await vi.advanceTimersByTimeAsync(3_600);
    expect((await page).from).toBe("kept");
    expect(waits.length, "the worker stays up for the late answer").toBe(1);
    await vi.advanceTimersByTimeAsync(7_000);
    await Promise.all(waits);
    expect(w.kept(PAGE)?.from).toBe("network, later");
  });

  it("offline: a kept copy opens; with none it fails, as a browser with no worker would", async () => {
    const w = worker(down());
    await expect(w.ask(PAGE).page).rejects.toThrow();
    w.keep(PAGE, answer("kept"));
    expect((await w.ask(PAGE).page).from).toBe("kept");
  });

  it("a quick network: the network's answer, kept for next time", async () => {
    const w = worker(after(200, answer("network")));
    w.keep(PAGE, answer("kept, older"));
    const { page } = w.ask(PAGE);
    await vi.advanceTimersByTimeAsync(300);
    expect((await page).from).toBe("network");
    expect(w.kept(PAGE)?.from).toBe("network");
  });
});
