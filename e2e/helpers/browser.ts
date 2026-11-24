/**
 * What the handheld, two-tab, save-file, offline, deploy and rooms specs share: reaching a panel lower down a sheet,
 * reading the save the game keeps, a browser without Web Locks, failed requests counted as errors, errors a flow
 * causes on purpose, a site built and served the way a deploy serves it, X Layer read on the fork, and a raw socket
 * to the rooms.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type Locator, type Page } from "@playwright/test";
import { createPublicClient, http, parseAbi, type Address, type PublicClient } from "viem";
import { type Opened, dismiss, expect } from "../fixtures";
import { type Run, ROOT } from "../harness/run";
import { answers, freePort, start, stop, waitFor } from "../harness/procs";

/* ── the save ─────────────────────────────────────────────────────────── */

/** One key of the save, as the page holds it. */
export const stored = (page: Page, key: string): Promise<string | null> =>
  page.evaluate((k) => localStorage.getItem(k), key);

/** One key of the save, parsed; null when it is not there. */
export async function storedJson<T>(page: Page, key: string): Promise<T | null> {
  const raw = await stored(page, key);
  return raw === null ? null : (JSON.parse(raw) as T);
}

/** The bag, as the save holds it. */
export const bagOf = async (page: Page): Promise<Record<string, number>> =>
  (await storedJson<{ bag?: Record<string, number> }>(page, "lingxi.world.v1"))?.bag ?? {};

/** How often a kind of care was given to the first pet (the world's tally). */
export const tallyOf = async (page: Page, kind: string): Promise<number> =>
  (await storedJson<{ tally?: Record<string, number> }>(page, "lingxi.world.v1"))?.tally?.[`${kind}:0`] ?? 0;

/** The pet on screen, as the save holds it, with the fields these specs read. */
export interface SavedPet {
  name: string;
  bornAt: number;
  beat: number;
  lessons: unknown;
  meters: Record<string, number>;
  away?: { code: string } | null;
}
export const petOf = (page: Page): Promise<SavedPet | null> =>
  page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem("lingxi.pets.v2") ?? "null") as {
      pets: SavedPet[];
      active: number;
    } | null;
    return r ? (r.pets[r.active] ?? null) : null;
  });

/** Puts food in the bag, as found or bought, and opens the game again so it reads it. */
export async function giveFood(p: Opened, food: Record<number, number>): Promise<void> {
  await p.page.evaluate((add) => {
    const w = JSON.parse(localStorage.getItem("lingxi.world.v1")!) as { bag: Record<string, number> };
    w.bag = { ...w.bag, ...add };
    localStorage.setItem("lingxi.world.v1", JSON.stringify(w));
  }, food);
  await p.page.reload();
  await p.page.locator(".stage").waitFor();
  await p.page.waitForTimeout(1_200);
  await dismiss(p.page);
}

/* ── the page ─────────────────────────────────────────────────────────── */

/**
 * A panel lower down an open sheet, scrolled to as a player would: a sheet draws its lower panels only as they come
 * near (play/Lazy.tsx), so the sheet is scrolled until the panel exists and sits on screen.
 */
export async function reach(page: Page, selector: string): Promise<Locator> {
  const height = page.viewportSize()?.height ?? 800;
  const scroll = (by: number | "top") =>
    page.evaluate((step) => {
      for (const e of document.querySelectorAll<HTMLElement>(".sheet, .sheet *"))
        if (e.scrollHeight > e.clientHeight + 10) e.scrollTop = step === "top" ? 0 : e.scrollTop + step;
    }, by);
  if (!(await page.locator(selector).count())) {
    await scroll("top");
    await page.waitForTimeout(200);
  }
  let last: { x: number; y: number; width: number; height: number } | null = null;
  for (let i = 0; i < 90; i++) {
    const found = page.locator(selector).first();
    if (await found.count()) {
      await found.scrollIntoViewIfNeeded();
      last = await found.boundingBox();
      const onScreen =
        last &&
        ((last.y >= 0 && last.y + Math.min(last.height, 120) <= height) ||
          (last.height > height * 0.6 && last.y < height && last.y + last.height > 0));
      if (onScreen) return found;
    }
    await scroll(300);
    await page.waitForTimeout(120);
  }
  throw new Error(`never reached ${selector} (last box ${JSON.stringify(last)})`);
}

/** A browser without Web Locks, as older Safari and some in-app browsers are. */
export const NO_LOCKS = "try { delete Navigator.prototype.locks; } catch {}";

/**
 * Failed requests and error answers count as errors for this player, as console errors do: a request the browser
 * cancelled itself (a page leaving) is not one. Call it before the player opens anything.
 */
export function watchRequests(p: Opened): void {
  const watch = (page: Page) => {
    page.on("response", (r) => {
      if (r.status() >= 400) p.errors.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`);
    });
    page.on("requestfailed", (r) => {
      const why = r.failure()?.errorText ?? "";
      if (!why.includes("ERR_ABORTED") && !r.url().includes("favicon"))
        p.errors.push(`request failed ${r.url().slice(0, 100)} ${why}`);
    });
  };
  for (const page of p.ctx.pages()) watch(page);
  p.ctx.on("page", watch);
}

/**
 * The console errors a flow causes on purpose (a request it drops, a file it deletes): exactly `count` lines matching
 * `line` are expected and taken off this player's errors, so any other error still fails the test. Waits for them,
 * since the console reports a failed request a moment after the request fails.
 */
export async function expectedErrors(p: Opened, line: RegExp, count: number): Promise<string[]> {
  await expect
    .poll(() => p.errors.filter((e) => line.test(e)).length, {
      message: `the ${count} expected console error(s) ${line}`,
    })
    .toBe(count);
  const taken = p.errors.filter((e) => line.test(e));
  const rest = p.errors.filter((e) => !line.test(e));
  p.errors.splice(0, p.errors.length, ...rest);
  return taken;
}

/* ── X Layer, on the fork ─────────────────────────────────────────────── */

const registryAbi = parseAbi(["function ownerOf(uint256 id) view returns (address)"]);

/** The fork this run plays on, and the registry the real Lingxi deployment uses there. */
export function forkOf(run: Run): { pub: PublicClient; registry: Address } {
  const deployment = JSON.parse(readFileSync(join(run.dir, "deployment.json"), "utf8")) as { registry: Address };
  return { pub: createPublicClient({ transport: http(run.fork.rpc) }) as PublicClient, registry: deployment.registry };
}

/** Who owns a pet on X Layer (the fork). */
export async function ownerOnChain(run: Run, petId: string | bigint): Promise<Address> {
  const { pub, registry } = forkOf(run);
  return (await pub.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "ownerOf",
    args: [BigInt(petId)],
  })) as Address;
}

/**
 * The test wallets come from the public test mnemonic, and on X Layer itself someone delegated the first two to a
 * contract (EIP-7702), which refuses the pet the registry mints to them (ERC721InvalidReceiver); the harness makes
 * them plain accounts on the fork. Checked before a pet is kept, so a harness that stops doing so fails here, by name,
 * rather than as a keep that "didn't go through".
 */
export async function expectPlainWallet(run: Run, address: Address): Promise<void> {
  expect(await forkOf(run).pub.getCode({ address }), `${address} is a plain account on the fork`).toBeUndefined();
}

/** The wallet a player's game signs with. */
export const walletOf = (run: Run, p: Opened): Address => run.players.find((x) => x.web === p.web)!.address;

/** Keeps the pet on screen on X Layer from its Pet sheet; resolves with its id once the game has its record. */
export async function keepOnChain(p: Opened, run: Run, withBrain = false): Promise<string> {
  await expectPlainWallet(run, walletOf(run, p));
  const { page } = p;
  await (await reach(page, "[data-hint=keep]")).click();
  await page.waitForFunction(
    (brain) =>
      Object.values(
        JSON.parse(localStorage.getItem("lingxi.chain.v2") ?? "{}") as Record<
          string,
          { petId?: string; brains?: Record<string, string> } | null
        >,
      ).some((r) => r?.petId && (!brain || Object.keys(r.brains ?? {}).length > 0)),
    withBrain,
    { timeout: 240_000 },
  );
  const records = (await storedJson<Record<string, { petId: string }>>(page, "lingxi.chain.v2")) ?? {};
  return Object.values(records)[0]!.petId;
}

/* ── the site, built and served as a deploy serves it ─────────────────── */

const node = process.execPath;
const tsx = join(ROOT, "services/api/node_modules/tsx/dist/cli.mjs");

/** A releases folder for one spec, in the run's scratch folder, served as the live site serves its releases (A10). */
export function siteFolder(run: Run, name: string): { site: string } {
  const site = join(run.dir, name, "site");
  rmSync(site, { recursive: true, force: true });
  mkdirSync(site, { recursive: true });
  return { site };
}

/**
 * Builds a release and makes it live with the release command itself (`scripts/site-release.mts`), as the live site is
 * released. The build has no game server of its own (VITE_API_URL empty, as the on-chain copy has none): it reads X
 * Layer, and the time, from the run's fork, so the page needs nothing the suite's server would refuse from another
 * origin. `release` changes how the fork's address is written, which is enough to give every part that names it a new
 * file name, as two releases differ. Returns the release's name.
 */
export async function buildSite(
  run: Run,
  site: string,
  release: "A" | "B",
  opts: { offline?: boolean } = {},
): Promise<string> {
  // the offline worker (P6) only where a spec asks for it: the others hold and drop the game's own requests
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VITE_CHAIN: "rehearsal",
    VITE_RPC: release === "A" ? run.fork.rpc : `${run.fork.rpc}/`,
    VITE_API_URL: "",
    VITE_LIVE_URL: "",
    VITE_OFFLINE: opts.offline ? "on" : "off",
  };
  delete env.VITE_DEV_KEY;
  const log = join(site, "..", `release-${release}.log`);
  const p = start(`release ${release}`, node, [tsx, "scripts/site-release.mts", "--site", site, "--allow-dirty"], {
    cwd: ROOT,
    env,
    log,
  });
  const code = await new Promise<number | null>((resolve) => p.child.on("exit", resolve));
  if (code !== 0)
    throw new Error(
      `release ${release} failed (${code}):\n${readFileSync(log, "utf8").split("\n").slice(-30).join("\n")}`,
    );
  return liveRelease(site);
}

/** The release live in a releases folder now. */
export const liveRelease = (site: string): string =>
  (JSON.parse(readFileSync(join(site, "current.json"), "utf8")) as { release: string }).release;

/** The entry script the live release's play.html loads (each release names it differently). */
export const entryOf = (site: string): string =>
  readFileSync(join(site, "releases", liveRelease(site), "play.html"), "utf8").match(
    /src="\.\/(assets\/play-[^"]+\.js)"/,
  )?.[1] ?? "";

/** Serves a releases folder with the server's own site handling (services/api/scripts/serve-site.mts), as the live site. */
export async function serveSite(site: string): Promise<{ url: string; stop: () => void }> {
  const port = await freePort();
  const p = start("site", node, [tsx, "scripts/serve-site.mts", site, String(port)], {
    cwd: join(ROOT, "services/api"),
    env: process.env,
    log: join(site, "..", "serve.log"),
  });
  const url = `http://127.0.0.1:${port}`;
  await waitFor("the built site", () => answers(`${url}/play.html`), 60_000, p.log);
  return { url, stop: () => stop(p) };
}

/* ── the rooms, from outside the game ─────────────────────────────────── */

/** A player's public id, from its secret key, as the game and the server make it (game/live.ts playerIdFor). */
export const keyedId = (secret: string): string =>
  createHash("sha256").update(`lingxi-player:${secret}`).digest("hex").slice(0, 24);

export type RoomMessage = Record<string, unknown> & { t?: string };
/** Node's WebSocket also takes the request's headers, which the DOM's type for it does not declare. */
type NodeWebSocket = new (url: string, init: { headers: Record<string, string> }) => WebSocket;

/** A raw socket to the run's rooms, speaking the room protocol directly: a visitor that is not the game. */
export class RoomSocket {
  private readonly got: RoomMessage[] = [];
  private read = 0;
  private wake: (() => void) | null = null;

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (e) => {
      this.got.push(JSON.parse(String(e.data)) as RoomMessage);
      this.wake?.();
    });
  }

  /** Opens a socket to `live` from the game's own origin, as a script on a page of the game could. */
  static open(live: string, origin: string): Promise<RoomSocket> {
    const ws = new (WebSocket as unknown as NodeWebSocket)(live, { headers: { origin } });
    return new Promise((resolve, reject) => {
      ws.addEventListener("open", () => resolve(new RoomSocket(ws)), { once: true });
      ws.addEventListener("error", () => reject(new Error(`no socket to ${live}`)), { once: true });
    });
  }

  send(m: RoomMessage): void {
    this.ws.send(JSON.stringify(m));
  }

  /** Says hello as `id` with `key`, in `space`. */
  hello(space: string, id: string, key: string, name: string): void {
    this.send({ t: "hello", id, key, name, line: "bold", stage: "adult", mood: 2, space });
  }

  /** The next message of type `t` from here on, waited for up to `ms`. */
  async next(t: string, ms = 5_000): Promise<RoomMessage> {
    const until = Date.now() + ms;
    for (;;) {
      while (this.read < this.got.length) {
        const m = this.got[this.read++]!;
        if (m.t === t) return m;
      }
      const left = until - Date.now();
      if (left <= 0) throw new Error(`no "${t}" in ${ms} ms (got ${this.got.map((m) => m.t).join(", ") || "nothing"})`);
      await new Promise<void>((r) => {
        const timer = setTimeout(r, left);
        this.wake = () => {
          clearTimeout(timer);
          r();
        };
      });
      this.wake = null;
    }
  }

  /** Every message of type `t` received so far. */
  all(t: string): RoomMessage[] {
    return this.got.filter((m) => m.t === t);
  }

  close(): void {
    this.ws.close();
  }
}
