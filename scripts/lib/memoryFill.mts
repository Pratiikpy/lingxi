/**
 * P10's memory gate: each store filled to its cap through the door a stranger uses (an HTTP route, or the live rooms'
 * socket handler), or, for a store behind a route this tool must never call (one that would call the language model or
 * spend the relayer's OKB), through its module's own API with the stand-ins of memoryWorld.mts. Each step says which.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { COMPANION, MAX_LESSONS, encodeChallenge, petCard, weekOf } from "@lingxi/game";
import { playerIdFor, relayMessage, signSponsorRequest } from "@lingxi/chain";
import { DECOR } from "../../packages/world/src/index.ts";
import { papersMessage } from "../../services/api/src/papers.ts";
import { homeLinkMessage } from "../../services/api/src/homes.ts";
import { SPONSOR_SET_ASIDE_WEI, SponsorGate } from "../../services/api/src/sponsor.ts";
import { codeOf } from "../../services/api/src/pseudonym.ts";
import { modelCaller } from "../../services/api/src/tokenBudget.ts";
import { READ_LIMITS } from "../../services/api/src/readLimits.ts";
import { compileProgram, netlistBytes, validateProgram } from "@lingxi/brain";
import {
  type Answer,
  BIG_DIARY_FROM,
  FakeSocket,
  type Caps,
  type World,
  addressOf,
  logHashOf,
  signingKey,
  smallDiaryWords,
} from "./memoryWorld.mts";

/** What every step shares: the world, the caps, the clock the agent, season and sponsor stores read, and the guard. */
export interface Ctx {
  world: World;
  caps: Caps;
  clock: { now: () => number; offset: number };
  /** throws when memory runs short (the tool's own limits); every loop calls it now and then */
  check: () => void;
  log: (line: string) => void;
  /** what the tool counts for a store that has no way to say its size */
  counts: Record<string, number>;
  /** the live sockets kept open */
  sockets: FakeSocket[];
  /** each live socket's pet secret, and what the churn needs to keep writing */
  state: {
    moves: Array<{ code: string; size: number; until: number }>;
    agents: Array<{ token: string; ip: string }>;
    /** homes made so far: home i's player id is homeId(i) */
    homes: number;
    lessons: string[];
    nonces: number[];
    papersNext: number;
    diaryNext: number;
    duelNext: number;
    homeNext: number;
    socketNext: number;
    roomNext: number;
    nonceNext: number;
    /** the addresses the limiter step used, each with a limit's worth left on every route: the churn writes from them */
    pool: { from: number; size: number };
  };
}

export interface Step {
  name: string;
  /** the cap, as the module states it */
  cap: string;
  /** how the step reaches the store */
  door: string;
  run: (ctx: Ctx) => Promise<void>;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const CPU = `0x${"c".repeat(40)}` as const;
const DAY = 86_400_000;

/** Runs `n` tasks, `width` at a time, checking the guard every so often. */
export async function each(ctx: Ctx, n: number, width: number, task: (i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    for (let i = next++; i < n; i = next++) {
      if (i % 256 === 0) {
        ctx.check();
        // the event loop's own turn, as a server has between requests: what waits on a finalizer is let go there
        await new Promise((r) => setImmediate(r));
      }
      await task(i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(width, n)) }, lane));
}

/** A pool of keys that sign, reused: each signature is over its own message, so reuse changes nothing a store keeps. */
const keyOf = signingKey;

/**
 * The largest card the arena, the season and the live rooms take that this tool can build: fourteen lessons, a real
 * owned instinct (a 40-rule, 16-flag circuit) and a second circuit part carried beside it up to the instinct budget.
 * Measured at 26,557 characters of CARD_MAX's 34,000 (a family on top is refused by the gate budget).
 */
function maxCardOf(): (variant: number) => string {
  const memory = Array.from({ length: 16 }, (_, m) => ({
    kind: "flag" as const,
    name: `m${m}`,
    set: [{ event: [(m % 3) + 1], hunger: [m % 4] }],
    clear: [{ time: [m % 4], action: [m % 8] }],
  }));
  const rules = Array.from({ length: 40 }, (_, i) => ({
    when: {
      event: [i % 4],
      hunger: [(i >> 2) % 4],
      joy: [(i >> 4) % 4, 3],
      energy: [1, 2],
      clean: [0, 3],
      time: [i % 4],
      action: [i % 8],
      [`m${i % 16}`]: [1],
    },
    then: { want: (i % 6) + 1, mood: i % 4 },
  }));
  const ih = hex(
    netlistBytes(
      compileProgram(validateProgram({ version: "LX-PET/1", memory, rules, otherwise: { want: 0, mood: 1 } })),
    ),
  );
  const lessons = Array.from({ length: MAX_LESSONS }, (_, i) => ({
    when: {
      hunger: [0, 1, 2],
      joy: [i % 4, (i + 1) % 4],
      energy: [0, 1, 2, 3],
      clean: [1, 2],
      time: [0, 1, 2, 3],
      event: [1, 2, 3],
      owner: [0, 1],
    },
    then: { want: (i % 5) + 1, mood: i % 4 },
  }));
  return (variant) =>
    petCard({
      lessons,
      brain: Array(64).fill(1),
      instincts: 15,
      outside: {
        processor: CPU,
        id: "9",
        owner: `0x${"d".repeat(40)}`,
        parts: [
          { processor: CPU, id: "9", nIn: 16, nOut: 8, hex: ih },
          {
            processor: CPU,
            id: "10",
            nIn: 16,
            nOut: 8,
            hex: (variant.toString(16) + "0".repeat(24_000)).slice(0, 24_000 - ih.length),
          },
        ],
      },
    } as never);
}
export const maxCard = maxCardOf();
const fullPet = (i: number) => ({
  name: `Pet${i}`.slice(0, 12),
  line: "gentle",
  stage: "adult",
  card: maxCard(i),
  story: { days: 1, lessons: 0, nature: [] },
});
const smallPet = (i: number) => ({
  name: `Duel${i}`.slice(0, 12),
  line: "gentle" as const,
  stage: "adult" as const,
  card: petCard({ lessons: [] }),
  story: { days: 9, lessons: 0, nature: [] },
});
const idOf = (i: number, n = 16) => i.toString(36).padStart(n, "0").slice(-n);
const pad = (s: string, n: number) => (s + "x".repeat(n)).slice(0, n);
/** letters only: the error log scrubs numbers, hashes and addresses out of what it keeps */
const words = (i: number) => i.toString(26).replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)] ?? "a");

const ok = (r: Answer): Record<string, unknown> => r.json();

export const STEPS: Step[] = [
  // first, while the heap is small: a relay request is checked at about 2.9 ms on a small heap and 11 ms on a full one,
  // and the book holds a nonce at most 10 minutes, so only a fast fill reaches its cap of 100,000 at once
  {
    name: "relay",
    cap: "relayGate.ts: createNonceBook 100,000 nonces (each kept up to 10 minutes); RelayQuota per pet, signer and hour",
    door: "POST /api/tapeout signed by a keeper (viem local keys; the stand-in chain says every signer keeps the pet); the relayer sends nothing",
    async run(ctx) {
      await sendRelays(ctx, ctx.caps.nonces);
    },
  },
  {
    name: "errors",
    cap: "clientErrors.ts: keep 50 distinct errors; MAX_TIMES 10,000 report times",
    door: "POST /api/errors, 20 an hour per address",
    async run(ctx) {
      const n = ctx.caps.quick ? 400 : 10_000;
      let ip = ctx.world.next();
      await each(ctx, n, 1, async (i) => {
        if (i % 20 === 0) ip = ctx.world.next();
        const message = pad(`err ${words(i)} `, 300);
        await ctx.world.request("/api/errors", {
          body: { message, where: pad(`at ${words(i)} `, 200), build: pad("b", 40) },
          ip,
        });
      });
    },
  },
  {
    name: "move",
    cap: "move.ts: MAX_HELD 500 moves, MAX_HELD_CHARS 64,000,000 characters in all; 3 and 4,000,000 per address",
    door: "POST /api/move (each a new address; a sender's share shrinks as the shelf fills)",
    async run(ctx) {
      await fillMoves(ctx);
    },
  },
  {
    name: "duels",
    cap: "duels.ts: MAX_KEPT 50,000 codes, MAX_KEPT_CHARS 200,000,000 (index in memory, codes on disk)",
    door: "POST /api/duels, 30 a minute per address, a maker holds 1/200 of the shelf",
    async run(ctx) {
      const n = ctx.caps.duels.count;
      // a maker holds 1/200 of the shelf (MAKER_SHARE): a new maker before its share is used, and 30 a minute
      const perMaker = Math.max(1, Math.min(25, Math.floor(n / 200)));
      let ip = ctx.world.next();
      await each(ctx, n, 1, async (i) => {
        if (i % perMaker === 0) ip = ctx.world.next();
        await ctx.world.request("/api/duels", {
          body: { code: encodeChallenge({ id: idOf(i), from: smallPet(i), at: i }) },
          ip,
        });
      });
      ctx.state.duelNext = n;
    },
  },
  {
    name: "papers",
    cap: "papers.ts: MAX_PAPERS 50,000, MAX_PAPERS_CHARS 200,000,000 (index in memory, papers on disk)",
    door: "POST /api/papers/:petId, signed by the owner (viem local keys), owner and seller read from the stand-in chain",
    async run(ctx) {
      const n = ctx.caps.papers.count;
      await postPapers(ctx, 0, n);
      ctx.state.papersNext = n;
    },
  },
  {
    name: "diaries",
    cap: "diaries.ts: TOTAL_BYTES 268,435,456 on the shelf; no cap on the count (one per pet on chain) nor on the per-address day map",
    door: "POST /api/pets/:id/log, the log hash read from the stand-in chain, hashed on this thread (hashHere)",
    async run(ctx) {
      // the shelf's bytes: logs of the most words a pet may publish (SEND_LIMITS.logWords), each about 1.2 MB
      const big = Array.from({ length: ctx.caps.quick ? 5_000 : 100_000 }, (_, i) => (i * 7919) % 65_536);
      ctx.world.chain.bigLogHash = logHashOf(big);
      const bigBody = (id: string) => ({ petId: id, words: big, segments: [{ brainId: null, words: big }] });
      const perDiary = JSON.stringify(bigBody("1")).length;
      const nBig = Math.ceil(ctx.caps.diaries.totalBytes / perDiary) + 2;
      let ip = ctx.world.next();
      await each(ctx, nBig, 1, async (i) => {
        if (i % 10 === 0) ip = ctx.world.next();
        const id = String(BIG_DIARY_FROM + i);
        await ctx.world.request(`/api/pets/${id}/log`, { body: bigBody(id), ip });
      });
      // the count: one small diary each for many pets, each from an address of its own
      await publishSmallDiaries(ctx, 0, ctx.caps.diaries.small);
      ctx.state.diaryNext = ctx.caps.diaries.small;
    },
  },
  {
    name: "sitting",
    cap: "sitting.ts: MAX_SITTING_BYTES 268,435,456 (packs on disk, index in memory); 8 packs per address; no cap on the count",
    door: "POST /api/sit: packs of the largest size (600,000 characters), then each new sender's shrinking share (A141)",
    async run(ctx) {
      // a pack of `size` characters, as the game makes one: a save of version 1 whose pet has a birth time
      const pack = (i: number, size: number) =>
        JSON.stringify({ v: 1, pet: { bornAt: i, pad: "x".repeat(Math.max(0, size - 35 - String(i).length)) } });
      const until = Date.now() + 30 * DAY;
      const { maxBytes } = ctx.caps.sitting;
      for (let a = 0; a < 20_000; a++) {
        if (a % 64 === 0) ctx.check();
        // a newcomer may hold a sixteenth of what is free (sitting.ts shareOf): the shelf fills to its last bytes this way
        const free = maxBytes - ctx.world.stores.sitting.stats().bytes;
        const size = Math.min(600_000, Math.floor(free / 16) - 8);
        if (size < 64) break;
        const ip = ctx.world.next();
        for (let k = 0; k < ctx.caps.sitting.perOwner; k++) {
          const r = ok(
            await ctx.world.request("/api/sit", {
              body: { pack: pack(a * 10 + k, size), keyHash: "a".repeat(64), until },
              ip,
            }),
          );
          if (r.ok !== true || size < 600_000) break;
        }
      }
    },
  },
  {
    name: "arena",
    cap: "arena.ts: MAX_ROUND 30 (31 rounds) x PER_ROUND 60 lines, each with its pet's whole card",
    door: "POST /api/arena/snapshot with the largest card, two lines per sender a round",
    async run(ctx) {
      const team = Object.keys(COMPANION).slice(0, 4);
      let ip = ctx.world.next();
      let n = 0;
      for (let round = 0; round < ctx.caps.arenaRounds; round++)
        await each(ctx, 60, 1, async (k) => {
          if (n++ % 2 === 0) ip = ctx.world.next();
          await ctx.world.request("/api/arena/snapshot", {
            body: { round, pet: fullPet(n), team, device: `device-${round}-${k}-xxxx` },
            ip,
          });
        });
    },
  },
  {
    name: "season",
    cap: "season.ts: KEEP_WEEKS 12 x MAX_ENTRIES 64 entries (each a whole card); the route's written answers, 8 weeks",
    door: "POST /api/season/enter with the largest card, 3 per address a week; past weeks through the store's clock",
    async run(ctx) {
      const base = Date.now();
      for (let w = ctx.caps.seasonWeeks - 1; w >= 0; w--) {
        ctx.clock.offset = -w * 7 * DAY;
        let ip = ctx.world.next();
        await each(ctx, ctx.caps.seasonEntries, 1, async (k) => {
          if (k % 3 === 0) ip = ctx.world.next();
          await ctx.world.request("/api/season/enter", {
            body: { pet: fullPet(w * 100 + k), device: `season-${w}-${k}-xxxx` },
            ip,
          });
        });
      }
      ctx.clock.offset = 0;
      // every week's standings fought and its answer written (the route keeps eight)
      for (let w = 0; w < ctx.caps.seasonWeeks; w++) {
        const week = weekOf(base - w * 7 * DAY);
        for (let tries = 0; tries < 240; tries++) {
          const v = ok(await ctx.world.request(`/api/season/${week}`));
          if (v.pending !== true) break;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    },
  },
  {
    name: "library",
    cap: "library.ts: MAX_ENTRIES 5,000 lessons, each with two seen-sets of at most 256 ids or a 4 KB filter",
    door: "POST /api/lessons/share, /use and /report, 60 an hour per address; every lesson learned and reported by 256",
    async run(ctx) {
      await fillLibrary(ctx);
    },
  },
  {
    name: "agents",
    cap: "agents.ts: MAX_PETS 5,000; 5 per address and per agent name; a pet's log has no cap (see the probe)",
    door: "POST /api/v1/agents/adopt, then /me/teach until each pet's mind is full",
    async run(ctx) {
      let ip = ctx.world.next();
      await each(ctx, ctx.caps.agents, 1, async (i) => {
        if (i % 5 === 0) ip = ctx.world.next();
        const r = ok(
          await ctx.world.request("/api/v1/agents/adopt", {
            body: { agent: `agent ${Math.floor(i / 5)}`, name: `Pet${i}`.slice(0, 16), line: "gentle", instincts: 15 },
            ip,
          }),
        );
        if (typeof r.token !== "string") return;
        ctx.state.agents.push({ token: r.token, ip });
        for (let k = 0; k < 4; k++) {
          const rule = { when: { hunger: [k % 4], joy: [(i + k) % 4] }, then: { want: (k % 5) + 1, mood: k % 4 } };
          const t = ok(
            await ctx.world.request("/api/v1/agents/me/teach", {
              body: { rule },
              ip,
              headers: { authorization: `Bearer ${r.token}` },
            }),
          );
          if (t.ok !== true) break;
        }
      });
      ctx.counts.agents = ctx.state.agents.length;
    },
  },
  {
    name: "push",
    cap: "push.ts: MAX_SUBS 20,000 subscriptions, 8 per address",
    door: "POST /api/push/plan with every field at its largest (store file off: see memoryWorld.mts)",
    async run(ctx) {
      let ip = ctx.world.next();
      await each(ctx, ctx.caps.push, 1, async (i) => {
        if (i % 8 === 0) ip = ctx.world.next();
        await ctx.world.request("/api/push/plan", { body: plan(i), ip });
      });
    },
  },
  {
    name: "model",
    cap: "tokenBudget.ts: MAX_ADDRESSES 20,000 a day; voice.ts: a cache of 2,000 situations x 3 lines",
    door: "in process: the voice through the budgeted client, each call charged to an address (the model routes are never called)",
    async run(ctx) {
      const { voice } = ctx.world.stores;
      await each(ctx, Math.max(ctx.caps.tokenAddresses + 50, ctx.caps.voice * 3), 1, async (i) => {
        await modelCaller.run(ctx.world.next(), () => voice(situation(Math.floor(i / 3))));
      });
      ctx.counts.modelCalls = ctx.world.model.calls();
    },
  },
  {
    name: "sponsor",
    cap: "sponsor.ts: 25 pets a day for the whole game, kept for good (no cap on the count); the route is never called",
    door: "in process: a year of the store as finish() writes it, loaded by the gate, then today's 25 through check() and finish()",
    async run(ctx) {
      await fillSponsor(ctx);
    },
  },
  {
    name: "homes",
    cap: "homes.ts: MAX_LINKED_HOMES 50,000 x MAX_LINKED 4 wallets; decor.ts: MAX_HOMES 50,000 x ROOM_MAX pieces",
    door: "the live rooms' socket handler: hello, decor and four signed links a home, 5 new homes an address a day",
    async run(ctx) {
      await makeHomes(ctx, 0, ctx.caps.homes, 4);
      ctx.state.homeNext = ctx.caps.homes;
    },
  },
  {
    name: "home views",
    cap: "homes.ts: CACHE_ENTRIES 20,000 views and 20,000 name colours; colour askers 20,000",
    door: "in process: Homes.view and Homes.colourOf, as the rooms call them, against the stand-in chain",
    async run(ctx) {
      const { homes } = ctx.world.stores;
      const n = Math.min(ctx.state.homes, ctx.caps.quick ? 100 : 22_000);
      let who = ctx.world.next();
      await each(ctx, n, 16, async (i) => {
        if (i % 20 === 0) who = ctx.world.next();
        const at = ctx.state.homes - 1 - i;
        const owner = homeId(at);
        await homes.view(owner, who);
        await homes.colourOf(owner, String(at + 1));
      });
    },
  },
  {
    name: "live",
    cap: "live.ts: MAX_CONNECTIONS 4,000 (each with its card and at most 16 proposals waiting)",
    door: "the live rooms' socket handler: 4,000 sockets, 12 an address, each with the largest card",
    async run(ctx) {
      await openSockets(ctx, ctx.caps.live);
    },
  },
  {
    name: "site",
    cap: "routes/site.ts: SITE_CACHE_MAX 64 pages' policies and folders' file servers",
    door: "GET every page of a scratch release of 100 pages",
    async run(ctx) {
      for (let i = 0; i < ctx.caps.sitePages; i++) await ctx.world.request(i === 0 ? "/" : `/page${i}.html`);
    },
  },
  {
    name: "limiter keys",
    cap: "limit.ts: every RateLimiter keeps at most 50,000 keys; FairCeiling 50,000 askers",
    door: "each limited route from 50,000 addresses (a body each route refuses after counting it), and each heavy read",
    async run(ctx) {
      await fillLimiterKeys(ctx);
    },
  },
];

async function fillMoves(ctx: Ctx): Promise<void> {
  const total = ctx.caps.moveChars;
  const held = () => ctx.state.moves.filter((m) => m.until > Date.now()).reduce((n, m) => n + m.size, 0);
  for (let i = 0; i < 5_000; i++) {
    ctx.check();
    const free = total - held();
    const size = Math.min(3_000_000, Math.floor(free / 16) - 64);
    if (size < 1_000 || ctx.state.moves.length >= 500) break;
    const r = ok(await ctx.world.request("/api/move", { body: { save: { "lingxi.save": "s".repeat(size - 11) } } }));
    if (typeof r.code === "string") ctx.state.moves.push({ code: r.code, size, until: Date.now() + 15 * 60_000 });
  }
  ctx.counts.moveChars = held();
  ctx.counts.moves = ctx.state.moves.length;
}

/** `n` papers from pet `from` on, 30 from each address `ipOf` gives (a new one by default) */
export async function postPapers(
  ctx: Ctx,
  from: number,
  n: number,
  ipOf: () => string = ctx.world.next,
): Promise<void> {
  let ip = ipOf();
  await each(ctx, n, 1, async (k) => {
    const i = from + k;
    if (k > 0 && k % 30 === 0) ip = ipOf();
    const id = String(1 + i);
    const owner = keyOf(i);
    const papers = JSON.stringify({ pet: id, story: `papers of ${id}` });
    const signature = await owner.signMessage({ message: papersMessage(id, papers) });
    await ctx.world.request(`/api/papers/${id}`, { body: { papers, signature }, ip });
  });
}

/** `n` one-word diaries for pets `from` on, each from the address `ipOf` gives (a new one by default) */
export async function publishSmallDiaries(
  ctx: Ctx,
  from: number,
  n: number,
  ipOf: () => string = ctx.world.next,
): Promise<void> {
  await each(ctx, n, 1, async (k) => {
    const id = String(from + k + 1);
    const words = smallDiaryWords(from + k + 1);
    await ctx.world.request(`/api/pets/${id}/log`, {
      body: { petId: id, words, segments: [{ brainId: null, words }] },
      ip: ipOf(),
    });
  });
}

/** 5,000 distinct lessons a pet can hold, each a single rule in the pet's own vocabulary. */
function lessonOf(i: number) {
  const v = (x: number) => [x % 4];
  return {
    when: { hunger: v(i), joy: v(i >> 2), energy: v(i >> 4), clean: v(i >> 6), time: v(i >> 8), event: v(i >> 10) },
    then: { want: (i >> 12) % 6, mood: (i >> 3) % 4 },
  };
}

async function fillLibrary(ctx: Ctx): Promise<void> {
  const { library } = ctx.world.stores;
  const max = ctx.caps.library.max;
  let ip = ctx.world.next();
  let made = 0;
  for (let i = 0; made < max && i < max * 4; i++) {
    if (i % 256 === 0) ctx.check();
    // one sharer holds perSharer lessons nobody else learned: a new sharer before that (and 60 an hour)
    if (made % Math.min(40, ctx.caps.library.perSharer) === 0) ip = ctx.world.next();
    const r = ok(
      await ctx.world.request("/api/lessons/share", { body: { rule: lessonOf(i), by: pad("Mochi", 12) }, ip }),
    );
    if (r.ok === true && r.isNew === true && typeof r.key === "string") {
      ctx.state.lessons.push(r.key);
      made++;
    }
  }
  // each lesson learned and reported by as many players as its exact sets hold (EXACT_MAX 256), the largest it gets
  const extra = ctx.caps.library.seen - 1;
  for (const action of ["use", "report"] as const) {
    let user = ctx.world.next();
    let used = 0;
    const lessons = ctx.state.lessons;
    await each(ctx, lessons.length * (action === "use" ? extra : extra + 1), 1, async (j) => {
      // a user takes 60 lessons in a row, one count on each; the next 60 are the next user's (60 an hour per address)
      if (used++ % 60 === 0) user = ctx.world.next();
      await ctx.world.request(`/api/lessons/${action}`, { body: { key: lessons[j % lessons.length] ?? "" }, ip: user });
    });
  }
  ctx.counts.libraryShared = made;
  ctx.counts.library = library.size();
}

/** A plan with every field at the largest PushPlanBody allows. */
function plan(i: number) {
  const at = Date.now() + 3_600_000;
  return {
    subscription: {
      endpoint: `https://fcm.googleapis.com/fcm/send/${pad(idOf(i, 12), 760)}`,
      keys: { p256dh: pad(`p${idOf(i, 12)}`, 200), auth: pad(`a${idOf(i, 12)}`, 100) },
    },
    lang: "en",
    name: pad(`Pet${i}`, 24),
    tz: 0,
    reminders: (["hungry", "bored", "dirty", "sick", "hungry", "bored"] as const).map((kind, k) => ({
      kind,
      at: at + k * 3_600_000,
    })),
  };
}

/** A pet's moment for its voice, every field at its largest: the cache key is the whole situation. */
export function situation(i: number) {
  return {
    name: pad(`Pet${i}`, 24),
    lang: "en" as const,
    stage: "adult" as const,
    line: "gentle" as const,
    decision: pad(`ask for food ${idOf(i, 8)}`, 60),
    because: Array.from({ length: 6 }, (_, k) => pad(`reason ${k} ${idOf(i, 8)}`, 60)),
    meters: { food: 500, joy: 500, energy: 500, clean: 500 },
    sick: false,
    asleep: false,
    moment: "decided" as const,
    habits: ["brave", "curious", "greedy"] as Array<"brave" | "curious" | "greedy">,
    taught: true,
  };
}

/** `n` relay requests, each signed by a keeper with a fresh nonce; the gate keeps each nonce for its window. */
export async function sendRelays(ctx: Ctx, n: number, ipOf: () => string = ctx.world.next): Promise<number> {
  let ip = ipOf();
  let kept = 0;
  const payload = JSON.stringify({ line: "gentle", lessons: [] });
  await each(ctx, n, 8, async (i) => {
    // 20 an hour from one address (the relay's limiter); the address is taken before this task waits on anything
    if (i > 0 && i % 20 === 0) ip = ipOf();
    const from = ip;
    const signer = keyOf(i);
    const petId = String(1 + (i % 10_000));
    const nonce = (ctx.state.nonceNext++).toString(16).padStart(32, "0");
    const time = Math.floor(Date.now() / 1000) + 290;
    const signature = await signer.signMessage({
      message: relayMessage({ kind: "brain", petId, payload, nonce, time }),
    });
    const r = await ctx.world.request("/api/tapeout", {
      body: { kind: "brain", petId, payload, auth: { signer: signer.address, nonce, time, signature } },
      ip: from,
    });
    // 429 is the nonce book full or the address over its share; anything else has spent the nonce
    if (r.status !== 429 && r.status !== 401) {
      kept++;
      ctx.state.nonces.push(Date.now() + 590_000);
    }
  });
  const now = Date.now();
  ctx.state.nonces = ctx.state.nonces.filter((t) => t > now);
  ctx.counts.nonces = ctx.state.nonces.length;
  return kept;
}

async function fillSponsor(ctx: Ctx): Promise<void> {
  const file = join(ctx.world.dir, "sponsored.json");
  const days = ctx.caps.sponsorDays;
  const pets = [];
  const now = Date.now();
  for (let d = days; d >= 1; d--)
    for (let k = 0; k < 25; k++) {
      const n = d * 25 + k;
      pets.push({
        to: `0x${n.toString(16).padStart(40, "0")}`,
        petId: String(100_000 + n),
        network: codeOf(`10.200.${(n >> 8) & 255}.${n & 255}`).by,
        at: now - d * DAY,
        hatchTx: `0x${n.toString(16).padStart(64, "a")}`,
        grantTx: `0x${n.toString(16).padStart(64, "b")}`,
        spentWei: SPONSOR_SET_ASIDE_WEI.toString(),
      });
    }
  writeFileSync(file, JSON.stringify({ pets }, null, 1));
  const gate = new SponsorGate({ file, enabled: true, now: () => ctx.clock.now() });
  ctx.world.stores.sponsor = gate;
  // today's 25, through the gate as the route would ask it
  for (let k = 0; k < 25; k++) {
    const account = privateKeyToAccount(`0x${(9_000 + k).toString(16).padStart(64, "5")}`);
    const { request, signature } = await signSponsorRequest(account, {
      line: "gentle",
      state: "0",
      at: ctx.clock.now(),
    });
    const r = await gate.check({ ...request, signature }, ctx.world.next());
    if (!r.ok) break;
    gate.finish(r.slot, {
      petId: String(900_000 + k),
      hatchTx: `0x${"c".repeat(64)}`,
      grantTx: `0x${"d".repeat(64)}`,
      spentWei: SPONSOR_SET_ASIDE_WEI,
    });
  }
}

const PLACED = DECOR.slice(0, 24).map((d, i) => ({ id: d.id, x: 10 + i * 4, y: 40 }));
const secretOf = (i: number) => i.toString(16).padStart(32, "0");
/** home i's player id: the id its secret gives (homes are made by number, so nothing is kept for each) */
export const homeId = (i: number): string => playerIdFor(secretOf(i + 1));

/** `n` homes from `from`, each decorated and linked to `links` wallets through a socket of its own. */
export async function makeHomes(ctx: Ctx, from: number, n: number, links: number): Promise<void> {
  const { rooms } = ctx.world;
  let ip = ctx.world.next();
  let made = 0;
  await each(ctx, n, 16, async (k) => {
    const i = from + k;
    if (made++ % 5 === 0) ip = ctx.world.next();
    const secret = secretOf(i + 1);
    const id = playerIdFor(secret);
    const ws = new FakeSocket();
    rooms.handle(ws as never, ip);
    ws.say({ t: "hello", id, key: secret, name: "Pet", line: "gentle", stage: "baby" });
    ws.say({ t: "decor", key: secret, placed: PLACED });
    for (let w = 0; w < links; w++) {
      const wallet = keyOf(i * 4 + w);
      const signature = await wallet.signMessage({ message: homeLinkMessage(id) });
      const answer = ws.next("linked");
      ws.say({ t: "link", key: secret, wallet: wallet.address, signature });
      await answer;
    }
    ws.close();
    ctx.state.homes = Math.max(ctx.state.homes, i + 1);
  });
}

/** Opens `n` sockets kept for the churn, 12 an address, 24 a room, each with the largest card and its proposals. */
export async function openSockets(ctx: Ctx, n: number): Promise<void> {
  const { rooms } = ctx.world;
  let ip = ctx.world.next();
  const fresh: FakeSocket[] = [];
  for (let k = 0; k < n; k++) {
    if (k % 256 === 0) ctx.check();
    if (k % 12 === 0) ip = ctx.world.next();
    const secret = secretOf(10_000_000 + ctx.state.socketNext++);
    const ws = new FakeSocket();
    const id = playerIdFor(secret);
    ids.set(ws, id);
    rooms.handle(ws as never, ip);
    ws.say({
      t: "hello",
      id,
      key: secret,
      name: `Pet${k}`.slice(0, 12),
      line: "gentle",
      stage: "adult",
      space: `room:${ctx.state.roomNext + Math.floor(k / 24)}`,
    });
    ws.say({ t: "card", lessons: maxCard(k) });
    fresh.push(ws);
  }
  ctx.sockets.push(...fresh);
  ctx.state.roomNext += Math.ceil(n / 24);
  // each pet asks up to 16 others in its room to raise a little one: 8 a round, as the sockets' token buckets refill
  for (let round = 0; round < (ctx.caps.quick ? 1 : 2); round++) {
    // a socket's bucket holds 8 messages and refills 2 a second (live.ts allow): hello and card took 2 of the first 8
    if (round > 0 || !ctx.caps.quick) await new Promise((r) => setTimeout(r, 4_500));
    for (let k = 0; k < fresh.length; k++) {
      if (k % 256 === 0) ctx.check();
      const base = Math.floor(k / 24) * 24;
      for (let p = 0; p < 8; p++) {
        const to = fresh[base + ((k + 1 + round * 8 + p) % 24)];
        if (!to || to === fresh[k]) continue;
        fresh[k]?.say({ t: "propose", to: ids.get(to) ?? "" });
      }
    }
  }
  ctx.counts.liveSockets = ctx.sockets.filter((s) => s.readyState === 1).length;
}

/** each live socket's member id, as its hello named it */
export const ids = new WeakMap<FakeSocket, string>();

async function fillLimiterKeys(ctx: Ctx): Promise<void> {
  const writes: Array<[string, string]> = [
    ["/api/lessons/share", "POST"],
    ["/api/errors", "POST"],
    ["/api/sit", "POST"],
    ["/api/arena/snapshot", "POST"],
    ["/api/season/enter", "POST"],
    ["/api/v1/agents/adopt", "POST"],
    ["/mcp", "POST"],
    ["/api/v1/read_pet", "POST"],
    ["/api/rpc", "POST"],
    ["/api/papers/1", "POST"],
    ["/api/move", "POST"],
    ["/api/duels", "POST"],
    ["/api/push/plan", "POST"],
    ["/api/tapeout", "POST"],
    ["/api/pets/1/log", "POST"],
  ];
  const reads = READ_LIMITS.map(([re]) => readPathFor(re));
  const from = ctx.world.next.at();
  for (let j = 0; j < ctx.caps.limiterKeys; j++) ctx.world.next();
  ctx.state.pool = { from, size: ctx.caps.limiterKeys };
  const pool = { length: ctx.caps.limiterKeys };
  for (const [path, method] of [...writes, ...reads.map((p) => [p, "GET"] as [string, string])])
    await each(ctx, pool.length, 1, async (j) => {
      const ip = addressOf(from + j);
      await ctx.world.request(
        path,
        method === "GET"
          ? { ip }
          : { method, ip, body: path === "/api/rpc" ? { jsonrpc: "2.0", id: 1, method: "eth_blockNumber" } : "{}" },
      );
    });
}

/** A path each heavy read's pattern matches, answered without a store holding anything new. */
function readPathFor(re: RegExp): string {
  const tries = [
    "/api/season/current",
    "/api/pets/9/log",
    "/api/duels/aaaaaaaaaaaaaaaa",
    "/api/tree",
    "/api/v1/agents/me",
    `/api/sit/${"a".repeat(24)}`,
    "/api/papers/9",
  ];
  return tries.find((p) => re.test(p)) ?? "/api/tree";
}
