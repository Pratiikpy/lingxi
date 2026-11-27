/**
 * P10's memory gate, the server half: one game server assembled in this process as services/api/src/server.ts
 * assembles it, every store in a scratch folder of its own, and the doors into each store.
 *
 * What stands in for the world outside, and only that: X Layer (who owns a pet, who sells it, a home's room packs and
 * pieces, a pet's log hash, the daily block), the language model (a client that answers at once and is never sent
 * anywhere), the push service (a send that returns), the relayer (it tapes out nothing), and the RPC door's upstream (a
 * fetch that answers here). Every one of them is an in-process function; nothing leaves this machine.
 */
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ZERO_HASH, chainAll, seasonStandings } from "@lingxi/game";
import {
  createApp,
  withArena,
  withLibrary,
  withMove,
  withPush,
  withSeason,
  withSitting,
  withSite,
} from "../../services/api/src/server.ts";
import { withDiaries } from "../../services/api/src/routes/chainReads.ts";
import { RateLimiter, FairCeiling } from "../../services/api/src/limit.ts";
import { RelayQuota } from "../../services/api/src/relayGate.ts";
import { LiveRooms } from "../../services/api/src/live.ts";
import { createDecorStore } from "../../services/api/src/decor.ts";
import { createHomes, type HomeChain } from "../../services/api/src/homes.ts";
import { createErrorLog, withErrors } from "../../services/api/src/clientErrors.ts";
import { createSittingStore } from "../../services/api/src/sitting.ts";
import { createArenaStore } from "../../services/api/src/arena.ts";
import { createSeasonStore } from "../../services/api/src/season.ts";
import { createStandingsRunner } from "../../services/api/src/standings.ts";
import { createLibrary } from "../../services/api/src/library.ts";
import { createAgentStore } from "../../services/api/src/agents.ts";
import { withAgentApi } from "../../services/api/src/agentApi.ts";
import { withMcp } from "../../services/api/src/mcp.ts";
import { withTapApi } from "../../services/api/src/tapApi.ts";
import { withRpcProxy } from "../../services/api/src/rpc.ts";
import { createPapersStore, withPapers } from "../../services/api/src/papers.ts";
import { createMoveStore } from "../../services/api/src/move.ts";
import { createDuelStore, withDuels } from "../../services/api/src/duels.ts";
import { createDailyBlocks, withDaily } from "../../services/api/src/daily.ts";
import { createDiaryStore } from "../../services/api/src/diaries.ts";
import { hashHere } from "../../services/api/src/logHash.ts";
import { createPusher } from "../../services/api/src/push.ts";
import { budgetedClient, createTokenBudget } from "../../services/api/src/tokenBudget.ts";
import { createVoice } from "../../services/api/src/voice.ts";
import { SponsorGate } from "../../services/api/src/sponsor.ts";

/** The caps the tool fills to: the server's own, or the quick mode's small ones (each through the module's options). */
export interface Caps {
  quick: boolean;
  homes: number;
  decor: number;
  duels: { count: number; chars: number };
  papers: { count: number; chars: number };
  library: { max: number; perSharer: number; seen: number };
  sitting: { maxBytes: number; perOwner: number };
  diaries: { totalBytes: number; small: number };
  errorsKept: number;
  limiterKeys: number;
  voice: number;
  /** stores whose caps are constants with no option: the full mode fills to them, the quick mode to these counts */
  agents: number;
  push: number;
  moveChars: number;
  tokenAddresses: number;
  nonces: number;
  live: number;
  seasonWeeks: number;
  seasonEntries: number;
  arenaRounds: number;
  sponsorDays: number;
  sitePages: number;
}

export const FULL: Caps = {
  quick: false,
  homes: 50_000,
  decor: 50_000,
  duels: { count: 50_000, chars: 200_000_000 },
  papers: { count: 50_000, chars: 200_000_000 },
  library: { max: 5_000, perSharer: 50, seen: 256 },
  sitting: { maxBytes: 256 * 1024 * 1024, perOwner: 8 },
  diaries: { totalBytes: 256 * 1024 * 1024, small: 20_000 },
  errorsKept: 50,
  limiterKeys: 50_000,
  voice: 2_000,
  agents: 5_000,
  push: 20_000,
  moveChars: 64_000_000,
  tokenAddresses: 20_000,
  nonces: 100_000,
  live: 4_000,
  seasonWeeks: 12,
  seasonEntries: 64,
  arenaRounds: 31,
  sponsorDays: 365,
  sitePages: 100,
};

export const QUICK: Caps = {
  quick: true,
  homes: 120,
  decor: 120,
  duels: { count: 200, chars: 400_000 },
  papers: { count: 60, chars: 200_000 },
  library: { max: 60, perSharer: 10, seen: 12 },
  sitting: { maxBytes: 4 * 1024 * 1024, perOwner: 8 },
  diaries: { totalBytes: 600_000, small: 60 },
  errorsKept: 20,
  limiterKeys: 400,
  voice: 40,
  agents: 40,
  push: 120,
  moveChars: 6_000_000,
  tokenAddresses: 120,
  nonces: 60,
  live: 60,
  seasonWeeks: 2,
  seasonEntries: 12,
  arenaRounds: 2,
  sponsorDays: 4,
  sitePages: 80,
};

/** The `k`th address the tool uses: an IPv4 caller, as `clientIp` reads it from Cloudflare's header. */
export const addressOf = (k: number): string => `10.${(k >>> 16) & 255}.${(k >>> 8) & 255}.${k & 255}`;

/** One address per call, never the same twice; `at()` says the number the next one will have. */
export function addresses(start = 1): (() => string) & { at: () => number } {
  let n = start;
  return Object.assign(() => addressOf(n++), { at: () => n });
}

/** A pool of keys that sign, reused: each signature is over its own message, so reuse changes nothing a store keeps. */
const KEYS = Array.from({ length: 64 }, (_, i) => privateKeyToAccount(`0x${(i + 1).toString(16).padStart(64, "7")}`));
export const signingKey = (i: number) => KEYS[((i % KEYS.length) + KEYS.length) % KEYS.length] as (typeof KEYS)[number];
/** pets' numbers: the big diaries from here up, below it one small diary each */
export const BIG_DIARY_FROM = 1_000_000;
/** the words of pet `n`'s small diary */
export const smallDiaryWords = (n: number): number[] => [(n - 1) % 65_536];

/**
 * A live room's socket, as LiveRooms.handle uses one: it answers pings, keeps nothing it is sent, and can wait for one
 * kind of message. The live rooms hold one Client each; this side holds only what a test needs to drive it.
 */
export class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  sentBytes = 0;
  private wanted: { t: string; done: (m: Record<string, unknown>) => void } | null = null;
  send(data: string, cb?: () => void): void {
    this.sentBytes += data.length;
    if (this.wanted && data.includes(`"t":"${this.wanted.t}"`)) {
      const w = this.wanted;
      this.wanted = null;
      w.done(JSON.parse(data) as Record<string, unknown>);
    }
    cb?.();
  }
  ping(): void {
    queueMicrotask(() => this.emit("pong"));
  }
  close(): void {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.emit("close");
  }
  terminate(): void {
    this.close();
  }
  say(m: Record<string, unknown>): void {
    this.emit("message", Buffer.from(JSON.stringify(m)), false);
  }
  /** the next message of kind `t` this socket is sent (or null after `ms`) */
  next(t: string, ms = 10_000): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wanted = null;
        resolve(null);
      }, ms);
      this.wanted = {
        t,
        done: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      };
    });
  }
}

type ModelClient = Parameters<typeof createVoice>[0];
type Relayer = NonNullable<Parameters<typeof createApp>[2]>;

/** A model client that answers every call at once with a fresh line and the usage it would report; it calls no one. */
function fakeModel(): { client: ModelClient; calls: () => number } {
  let n = 0;
  const create = async () => {
    n++;
    return {
      id: `msg_${n}`,
      type: "message",
      role: "assistant",
      model: "fake",
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ line: `I am thinking of supper, turn ${n}` }) }],
      usage: { input_tokens: 400, output_tokens: 20 },
    };
  };
  const client = { messages: { create }, beta: { messages: { create } } } as unknown as ModelClient;
  return { client, calls: () => n };
}

/** The relayer, when it is asked to tape out: it sends nothing and says so, so the route gives back every slot. */
function fakeRelayer(): Relayer {
  const nothing = async () => ({
    ok: false as const,
    reason: "error" as const,
    detail: "the memory tool tapes out nothing",
  });
  return { relay: nothing, relayChild: nothing, relayInstinct: nothing } as unknown as Relayer;
}

/**
 * X Layer as the stores ask it, answered here from the pet's number alone, so the tool keeps nothing for each pet it
 * posts for: pet n's owner and seller sign with key n - 1, its log hash is its small diary's (or, for the big diaries,
 * the one log they all publish), and home n's pets belong to its first wallet.
 */
export interface FakeChain {
  /** the hash of the log every big diary publishes, set by the step that publishes them */
  bigLogHash: string | null;
}

/** An answer, read to its end (an unread stream would hold its file open in this process, where a socket would close it). */
export interface Answer {
  status: number;
  text: string;
  /** the body as JSON, or {} when it is not */
  json: () => Record<string, unknown>;
}

export interface World {
  app: ReturnType<typeof createApp>;
  /** a request from `ip` (no Origin, as a program sends it) */
  request: (
    path: string,
    init?: { method?: string; body?: unknown; ip?: string; headers?: Record<string, string> },
  ) => Promise<Answer>;
  /** a new address each call; `next.at()` is the number the next one will have */
  next: ReturnType<typeof addresses>;
  chain: FakeChain;
  stores: ReturnType<typeof buildStores>;
  /** every rate limiter handed to a route here, with the server's own settings for it */
  limiters: Array<{ name: string; limiter: RateLimiter; max: number; windowMs: number }>;
  rooms: LiveRooms;
  model: ReturnType<typeof fakeModel>;
  dir: string;
  close: () => void;
}

/** The stores, made as the server makes them, each pointed at its own file or folder under `dir`. */
function buildStores(dir: string, caps: Caps, clock: { now: () => number }) {
  const f = (name: string) => join(dir, name);
  const homeChain: HomeChain = {
    roomPacks: async () => 3,
    piecesHeld: async () => [],
    ownerOf: async (petId) => signingKey((Number(petId) - 1) * 4).address,
    nameColour: async () => 7,
  };
  const decor = createDecorStore(f("home-decor.json"), caps.decor);
  const homes = createHomes({ chain: homeChain, file: f("homes.json"), maxHomes: caps.homes });
  const model = fakeModel();
  const budget = createTokenBudget({ perDay: 2_000_000_000, perAddress: 100_000_000 });
  return {
    decor,
    homes,
    errors: createErrorLog({ keep: caps.errorsKept }),
    sitting: createSittingStore(f("sitting"), Date.now, {
      maxBytes: caps.sitting.maxBytes,
      perOwner: caps.sitting.perOwner,
    }),
    arena: createArenaStore(f("arena.json")),
    season: createSeasonStore(
      f("season.json"),
      () => clock.now(),
      createStandingsRunner({
        file: f("standings.json"),
        compute: async (week, entries) => seasonStandings(week, entries),
      }),
    ),
    library: createLibrary(f("library.json"), { max: caps.library.max, perSharer: caps.library.perSharer }),
    agents: createAgentStore(f("agents.json"), () => clock.now()),
    papers: createPapersStore(f("adoption-papers.json"), caps.papers),
    move: createMoveStore(),
    duels: createDuelStore(f("duels"), caps.duels),
    diaries: createDiaryStore(f("diaries"), { totalBytes: caps.diaries.totalBytes }),
    // reminders: kept in memory alone, because every plan rewrites the whole file (push.ts save on each plan), which
    // at 20,000 subscriptions is a 10 MB write per request and would take the fill hours; what memory holds is the same
    push: createPusher({
      publicKey: "B".repeat(87),
      privateKey: "p".repeat(43),
      subject: "mailto:tool@lingxi.invalid",
      send: async () => ({ gone: false }),
    }),
    // the model's day: in memory alone for the same reason (tokenBudget.ts saves on every call)
    budget,
    model,
    voice: createVoice(budgetedClient(model.client, budget), caps.voice),
    quota: new RelayQuota(
      {
        perPetPerDay: 6,
        perSignerPerDay: 12,
        perHour: 12,
        perDay: 200,
        newcomerShare: 0.25,
        lifetime: { newcomer: 3, settled: 40 },
        settledPerSignerPerHour: 2,
        keptForUnserved: 0.25,
      },
      f("relay-quota.json"),
    ),
    sponsor: new SponsorGate({ file: f("sponsored.json"), enabled: true, now: () => clock.now() }),
  };
}

/** The server, assembled here in the order server.ts assembles it. */
export function buildWorld(dir: string, caps: Caps, clock: { now: () => number }): World {
  mkdirSync(dir, { recursive: true });
  const chain: FakeChain = { bigLogHash: null };
  const stores = buildStores(dir, caps, clock);
  const limiters: World["limiters"] = [];
  const lim = (name: string, max: number, windowMs: number) => {
    const limiter = new RateLimiter(max, windowMs, caps.limiterKeys);
    limiters.push({ name, limiter, max, windowMs });
    return limiter;
  };
  const rooms = new LiveRooms(stores.decor, stores.homes);
  const app = createApp(
    null,
    lim("teach", 6, 60_000),
    fakeRelayer(),
    lim("relay", 20, 3_600_000),
    rooms,
    undefined,
    async () => true,
    stores.quota,
  );
  withLibrary(app, stores.library, lim("lessons", 60, 3_600_000));
  withErrors(app, stores.errors, lim("errors", 20, 3_600_000));
  withSitting(app, stores.sitting, lim("sitting", 30, 3_600_000));
  withArena(app, stores.arena, lim("arena", 120, 3_600_000));
  withSeason(app, stores.season, lim("season", 30, 3_600_000), () => clock.now());
  withAgentApi(app, { agents: stores.agents, seasons: stores.season, limiter: lim("agents", 240, 3_600_000) });
  withMcp(app, { limiter: lim("mcp", 120, 3_600_000) });
  withTapApi(app, {
    signer: privateKeyToAccount(generatePrivateKey()),
    container: `0x${"e".repeat(40)}`,
    limiter: lim("tap", 240, 3_600_000),
  });
  const answer = async () =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }), {
      headers: { "content-type": "application/json" },
    });
  withRpcProxy(app, {
    upstreams: ["http://127.0.0.1:9"],
    limiter: lim("rpc", 600, 60_000),
    global: new FairCeiling(1_800, 60_000, caps.limiterKeys),
    fetch: answer as unknown as typeof fetch,
  });
  withPapers(
    app,
    stores.papers,
    {
      ownerOf: async (id) => signingKey(Number(id) - 1).address,
      sellerOf: async (id) => signingKey(Number(id) - 1).address,
    },
    Date.now,
    lim("papers", 30, 3_600_000),
  );
  withMove(app, stores.move, lim("move", 20, 3_600_000));
  withDuels(app, stores.duels, lim("duels", 30, 60_000));
  const genesis = Math.floor(Date.now() / 1000) - 40 * 86_400;
  withDaily(
    app,
    createDailyBlocks(
      {
        head: async () => ({
          number: Math.floor(Date.now() / 1000) - genesis,
          timestamp: Math.floor(Date.now() / 1000),
        }),
        block: async (n) => ({ number: n, timestamp: genesis + n, hash: `0x${n.toString(16).padStart(64, "0")}` }),
      },
      { file: join(dir, "daily.json") },
    ),
  );
  withDiaries(
    app,
    stores.diaries,
    async (id) => {
      const n = Number(id);
      const logHash = n >= BIG_DIARY_FROM ? chain.bigLogHash : logHashOf(smallDiaryWords(n));
      return logHash === null ? null : { logHash, born: 0, at: Math.floor(Date.now() / 1000) };
    },
    hashHere,
  );
  withPush(app, stores.push, lim("push", 30, 3_600_000));
  const site = join(dir, "site");
  mkdirSync(site, { recursive: true });
  for (let i = 0; i < caps.sitePages; i++)
    writeFileSync(
      join(site, i === 0 ? "index.html" : `page${i}.html`),
      `<!doctype html><title>${i}</title><script>var p=${i}</script>`,
    );
  withSite(app, site);
  const next = addresses();
  const request: World["request"] = async (path, init = {}) => {
    const r = await app.request(`http://lingxi.local${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json", "cf-connecting-ip": init.ip ?? next(), ...(init.headers ?? {}) },
      ...(init.body === undefined
        ? {}
        : { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) }),
    });
    const text = await r.text();
    return {
      status: r.status,
      text,
      json: () => {
        try {
          const v: unknown = JSON.parse(text);
          return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
        } catch {
          // a body that is not JSON (a static 404, say) is read as no answer
          return {};
        }
      },
    };
  };
  return {
    app,
    request,
    next,
    chain,
    stores,
    limiters,
    rooms,
    model: stores.model,
    dir,
    close: () => undefined,
  };
}

/** The log hash a diary of `words` has on chain. */
export const logHashOf = (words: readonly number[]): string => chainAll(ZERO_HASH, words);
