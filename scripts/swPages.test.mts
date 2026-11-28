/**
 * R10: the service worker and a page on a slow network. The worker (apps/web/public/sw.js) is run here as it is
 * shipped, in a stand-in worker with its own caches, network and clock. A page asked for on a network slower than the
 * worker's short wait used to fail outright when no copy was kept ("offline, and this page is not kept"), though the
 * request it had started was still on its way: a first visit on a slow connection got an error the server never sent.
 *
 * R61: what the worker keeps as it installs. The game's code a first visit loads arrives before the worker takes control,
 * so only what the worker fetches itself is there offline: every file of its list, each where the worker looks for it,
 * fetched again on a later visit if the network failed it while installing.
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
  /** a server's Vary header: "Origin" makes a kept answer match only a request from the same origin */
  vary?: string;
  clone: () => Answer;
}
const answer = (from: string, vary?: string): Answer => ({ ok: true, from, vary, clone: () => answer(from, vary) });

/** A request as the page makes one: its address, and the Origin header a script, a style or a face is sent with. */
interface Asked {
  url: string;
  headers?: { origin?: string };
}

/** A request as the worker makes one: its address read against the worker's, and how it may use the browser's cache. */
class Req {
  url: string;
  cache: string;
  constructor(url: string, init?: { cache?: string }) {
    this.url = new URL(url, `${ORIGIN}/sw.js`).href;
    this.cache = init?.cache ?? "default";
  }
}

/**
 * The worker, started in a scope of its own: its caches, what its network does with a request, and its handlers; with
 * `keep`, the list the build writes into it.
 */
function worker(network: (url: string) => Promise<Answer>, keep?: { version: string; files: string[] }) {
  const asked: Req[] = [];
  // each kept answer with the Origin header of the request it was kept for, as the Cache API keeps the request
  type Kept = { a: Answer; origin?: string };
  const stores = new Map<string, Map<string, Kept>>();
  const store = (name: string) => stores.get(name) ?? stores.set(name, new Map()).get(name)!;
  const keyOf = (r: Asked | string) => (typeof r === "string" ? r : r.url).split("?")[0]!;
  // as the Cache API matches: an answer that varies by Origin is found only for the same Origin, unless told to ignore it
  const find = (name: string, r: Asked | string, o?: { ignoreVary?: boolean }) => {
    const k = store(name).get(keyOf(r));
    const origin = typeof r === "string" ? undefined : r.headers?.origin;
    return k && (k.a.vary !== "Origin" || o?.ignoreVary || k.origin === origin) ? k.a : undefined;
  };
  const open = (name: string) => ({
    match: async (r: Asked, o?: { ignoreVary?: boolean }) => find(name, r, o),
    put: async (r: Asked, a: Answer) => void store(name).set(keyOf(r), { a, origin: r.headers?.origin }),
    // as the Cache API's own: the network's answer is kept, and a failed or refused fetch fails the add
    add: async (r: Req) => {
      asked.push(r);
      const a = await network(r.url);
      if (!a.ok) throw new TypeError("bad answer");
      store(name).set(keyOf(r), { a });
    },
  });
  const caches = {
    open: async (name: string) => open(name),
    match: async (r: Asked, o?: { ignoreVary?: boolean }) => [...stores.keys()].map((n) => find(n, r, o)).find(Boolean),
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
  // the shipped worker, run as shipped, with the list written in where the build writes it
  const shipped = keep ? source.replace("/*__PRECACHE__*/", `const PRECACHE = ${JSON.stringify(keep)};`) : source;
  new Function("self", "caches", "fetch", "Request", shipped)(
    self,
    caches,
    (r: { url: string }) => network(r.url),
    Req,
  );
  /** Asks the worker for a page, as a navigation does; resolves or rejects as the page would. */
  const ask = (url: string, mode = "navigate", origin?: string) => {
    const waits: Promise<unknown>[] = [];
    let given: Promise<Answer> | undefined;
    handlers.fetch!({
      request: { method: "GET", url, mode, headers: { origin } },
      respondWith: (p: Promise<Answer>) => void (given = p),
      waitUntil: (p: Promise<unknown>) => void waits.push(p),
    });
    return { page: given!, waits };
  };
  /** Installs and activates the worker, as a browser does on a first visit, and waits for both to finish. */
  const install = async () => {
    for (const type of ["install", "activate"]) {
      const waits: Promise<unknown>[] = [];
      handlers[type]!({ waitUntil: (p: Promise<unknown>) => void waits.push(p) });
      await Promise.all(waits);
    }
  };
  return {
    ask,
    install,
    asked,
    kept: (url: string) => store("lingxi-dev").get(url)?.a,
    keep: (url: string, a: Answer) => void store("lingxi-dev").set(url, { a }),
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

describe("what the worker keeps as it installs (R61)", () => {
  const KEEP = {
    version: "v1",
    files: ["play.html", "assets/play-1.js", "assets/Arena-1.js", "art/rooms/65_forest-hut/backgrounds/room65a.png"],
  };
  const online = (url: string) => Promise.resolve(answer(`network ${url.replace(ORIGIN, "")}`));
  /** a network that is down from the moment `net.down` is set */
  const switchable = (fail: (url: string) => boolean = () => false) => {
    const net = { down: false };
    const fetcher = (url: string) => (net.down || fail(url) ? down()() : online(url));
    return { net, fetcher };
  };

  it("every file of the list opens offline after the install, the room's pictures too", async () => {
    const { net, fetcher } = switchable();
    const w = worker(fetcher, KEEP);
    await w.install();
    net.down = true;
    expect((await w.ask(`${ORIGIN}/play.html`).page).from).toBe("network /play.html");
    expect((await w.ask(`${ORIGIN}/assets/Arena-1.js`, "cors").page).from).toBe("network /assets/Arena-1.js");
    const art = `${ORIGIN}/art/rooms/65_forest-hut/backgrounds/room65a.png`;
    expect((await w.ask(art, "no-cors").page).from).toBe("network /art/rooms/65_forest-hut/backgrounds/room65a.png");
  });

  it("the code, named by its content, may come from the browser's own cache; the page and the art are asked fresh", async () => {
    const w = worker(online, KEEP);
    await w.install();
    const mode = (f: string) => w.asked.find((r) => r.url === `${ORIGIN}/${f}`)?.cache;
    expect(mode("assets/play-1.js")).toBe("default");
    expect(mode("assets/Arena-1.js")).toBe("default");
    expect(mode("play.html")).toBe("reload");
    expect(mode("art/rooms/65_forest-hut/backgrounds/room65a.png")).toBe("reload");
  });

  it("a file the network failed while installing is fetched on the next visit online, then opens offline", async () => {
    let flaky = true;
    const { net, fetcher } = switchable((url) => flaky && url.endsWith("/assets/Arena-1.js"));
    const w = worker(fetcher, KEEP);
    await w.install();
    flaky = false;
    const visit = w.ask(`${ORIGIN}/play.html`);
    await visit.page;
    await Promise.all(visit.waits);
    net.down = true;
    expect((await w.ask(`${ORIGIN}/assets/Arena-1.js`, "cors").page).from).toBe("network /assets/Arena-1.js");
  });

  it("a server that varies its answers by Origin: the kept code and art still open for the page's own requests", async () => {
    // a module script, a style and a face are asked with the page's Origin; the worker kept them without one. A server
    // or CDN sending Vary: Origin (Vite's own preview does) made every kept script miss, and the game stuck offline
    const { net, fetcher } = switchable();
    const w = worker((url) => fetcher(url).then((a) => answer(a.from, "Origin")), KEEP);
    await w.install();
    net.down = true;
    const script = await w.ask(`${ORIGIN}/assets/play-1.js`, "cors", ORIGIN).page;
    expect(script.from).toBe("network /assets/play-1.js");
    const art = await w.ask(`${ORIGIN}/art/rooms/65_forest-hut/backgrounds/room65a.png`, "cors", ORIGIN).page;
    expect(art.from).toBe("network /art/rooms/65_forest-hut/backgrounds/room65a.png");
  });

  it("a visit with everything kept fetches nothing more", async () => {
    const w = worker(online, KEEP);
    await w.install();
    const before = w.asked.length;
    const visit = w.ask(`${ORIGIN}/play.html`);
    await visit.page;
    await Promise.all(visit.waits);
    expect(w.asked.length).toBe(before);
  });
});
