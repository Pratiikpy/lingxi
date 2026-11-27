/**
 * P10's memory gate: the churn, every store written past its cap through the same doors that filled it, and the
 * probes, which measure the stores that have no cap to fill to (each in bytes per thing kept, never a guess).
 */
import { encodeChallenge, petCard, weekOf } from "@lingxi/game";
import { playerIdFor, signSponsorRequest } from "@lingxi/chain";
import { privateKeyToAccount } from "viem/accounts";
import { RateLimiter } from "../../services/api/src/limit.ts";
import { createSittingStore } from "../../services/api/src/sitting.ts";
import { LiveRooms } from "../../services/api/src/live.ts";
import { createDecorStore } from "../../services/api/src/decor.ts";
import { createDiaryStore } from "../../services/api/src/diaries.ts";
import { modelCaller } from "../../services/api/src/tokenBudget.ts";
import { READ_LIMITS } from "../../services/api/src/readLimits.ts";
import { MB, floorNow } from "./memoryBound.mts";
import { FakeSocket, addressOf, logHashOf } from "./memoryWorld.mts";
import {
  type Ctx,
  each,
  homeId,
  ids,
  makeHomes,
  maxCard,
  postPapers,
  publishSmallDiaries,
  sendRelays,
  situation,
} from "./memoryFill.mts";

const DAY = 86_400_000;

export interface Churner {
  name: string;
  /** the least time between two of its turns, in ms */
  every: number;
  tick: (ctx: Ctx) => Promise<void>;
}

let poolAt = 0;
/** an address the limiter step used: it has a limit's worth left on every route */
const pooled = (ctx: Ctx) =>
  ctx.state.pool.size ? addressOf(ctx.state.pool.from + (poolAt++ % ctx.state.pool.size)) : ctx.world.next();
let n = 0;
const fresh = () => n++;

export const CHURNERS: Churner[] = [
  {
    name: "errors",
    every: 0,
    tick: async (ctx) => {
      const i = fresh();
      await ctx.world.request("/api/errors", {
        body: { message: `churn error ${i.toString(26).replace(/\d/g, "q")}`, where: "churn", build: "b" },
        ip: pooled(ctx),
      });
    },
  },
  {
    name: "move",
    every: 2_000,
    tick: async (ctx) => {
      // one claimed, then the shelf topped up again, so it stays at its cap as moves expire and are taken
      const now = Date.now();
      ctx.state.moves = ctx.state.moves.filter((m) => m.until > now);
      const first = ctx.state.moves.shift();
      if (first)
        await ctx.world.request(`/api/move/${first.code}/claim`, { method: "POST", body: "{}", ip: pooled(ctx) });
      for (let k = 0; k < 4; k++) {
        const held = ctx.state.moves.reduce((s, m) => s + m.size, 0);
        const size = Math.min(3_000_000, Math.floor((ctx.caps.moveChars - held) / 16) - 64);
        if (size < 1_000 || ctx.state.moves.length >= 500) break;
        const r = (
          await ctx.world.request("/api/move", {
            body: { save: { "lingxi.save": "s".repeat(size - 11) } },
            ip: pooled(ctx),
          })
        ).json();
        if (typeof r.code === "string") ctx.state.moves.push({ code: r.code, size, until: Date.now() + 15 * 60_000 });
      }
      ctx.counts.moves = ctx.state.moves.length;
      ctx.counts.moveChars = ctx.state.moves.reduce((s, m) => s + m.size, 0);
    },
  },
  {
    name: "duels",
    every: 0,
    tick: async (ctx) => {
      const i = ctx.state.duelNext++;
      const from = {
        name: "Duel",
        line: "gentle" as const,
        stage: "adult" as const,
        card: petCard({ lessons: [] }),
        story: { days: 9, lessons: 0, nature: [] },
      };
      await ctx.world.request("/api/duels", {
        body: { code: encodeChallenge({ id: i.toString(36).padStart(16, "0"), from, at: i }) },
        ip: pooled(ctx),
      });
    },
  },
  // from the limiter step's addresses: every per-hour limiter is full of keys, so a new address would only be refused
  { name: "papers", every: 100, tick: async (ctx) => postPapers(ctx, ctx.state.papersNext++, 1, () => pooled(ctx)) },
  {
    // published again for the pets the fill gave a diary: a diary needs a pet on chain, and the stand-in chain would
    // say any number is one, so new numbers would grow the shelf's count past what X Layer could ever hold (the count's
    // own bound is the chain's pets; see the inventory)
    name: "diaries",
    every: 100,
    tick: async (ctx) =>
      publishSmallDiaries(ctx, ctx.state.diaryNext++ % Math.max(1, ctx.caps.diaries.small), 1, () => pooled(ctx)),
  },
  {
    name: "sitting",
    every: 1_000,
    tick: async (ctx) => {
      // the shelf is full and refuses: it never lets a pack go to make room (sitting.ts), so this checks the refusal
      const pack = JSON.stringify({ v: 1, pet: { bornAt: fresh(), pad: "x".repeat(100_000) } });
      await ctx.world.request("/api/sit", {
        body: { pack, keyHash: "b".repeat(64), until: Date.now() + DAY },
        ip: pooled(ctx),
      });
      await ctx.world.request(`/api/sit/${"c".repeat(24)}`, { ip: pooled(ctx) });
    },
  },
  {
    name: "arena",
    every: 250,
    tick: async (ctx) => {
      const i = fresh();
      const pet = {
        name: `Churn${i % 999}`,
        line: "gentle",
        stage: "adult",
        card: maxCard(i),
        story: { days: 1, lessons: 0, nature: [] },
      };
      await ctx.world.request("/api/arena/snapshot", {
        body: { round: i % ctx.caps.arenaRounds, pet, team: [], device: `churn-${i}-xxxxxx` },
        ip: pooled(ctx),
      });
    },
  },
  {
    name: "season",
    every: 1_000,
    tick: async (ctx) => {
      const i = fresh();
      const pet = {
        name: `Late${i % 999}`,
        line: "gentle",
        stage: "adult",
        card: maxCard(i),
        story: { days: 1, lessons: 0, nature: [] },
      };
      await ctx.world.request("/api/season/enter", { body: { pet, device: `late-${i}-xxxxxx` }, ip: pooled(ctx) });
      await ctx.world.request(`/api/season/${weekOf(Date.now() - (i % ctx.caps.seasonWeeks) * 7 * DAY)}`, {
        ip: pooled(ctx),
      });
    },
  },
  {
    name: "library",
    every: 0,
    tick: async (ctx) => {
      const i = fresh();
      const v = (x: number) => [x % 4];
      const rule = {
        when: { hunger: v(i), joy: v(i >> 2), energy: v(i >> 4), clean: v(i >> 6), owner: [i % 2] },
        then: { want: (i >> 8) % 6, mood: (i >> 3) % 4 },
      };
      await ctx.world.request("/api/lessons/share", { body: { rule, by: "Churner" }, ip: pooled(ctx) });
      const key = ctx.state.lessons[i % Math.max(1, ctx.state.lessons.length)] ?? "";
      await ctx.world.request("/api/lessons/use", { body: { key }, ip: pooled(ctx) });
      await ctx.world.request("/api/lessons/report", { body: { key }, ip: pooled(ctx) });
    },
  },
  {
    name: "agents",
    every: 1_000,
    tick: async (ctx) => {
      // the shelf is full: an adoption is refused; and the next pet is cared for, catching it up to now
      await ctx.world.request("/api/v1/agents/adopt", {
        body: { agent: "late agent", name: "Late", line: "bold" },
        ip: pooled(ctx),
      });
      const a = ctx.state.agents[fresh() % Math.max(1, ctx.state.agents.length)];
      if (a)
        await ctx.world.request("/api/v1/agents/me/care", {
          body: { action: "feed" },
          ip: a.ip,
          headers: { authorization: `Bearer ${a.token}` },
        });
    },
  },
  {
    name: "push",
    every: 100,
    tick: async (ctx) => {
      const i = fresh();
      const at = Date.now() + 3_600_000;
      const sub = (k: string) => ({
        endpoint: `https://fcm.googleapis.com/fcm/send/${k}`,
        keys: { p256dh: "p".repeat(40), auth: "a".repeat(16) },
      });
      await ctx.world.request("/api/push/plan", {
        body: { subscription: sub(`churn-${i}`), lang: "en", name: "Late", tz: 0, reminders: [{ kind: "hungry", at }] },
        ip: pooled(ctx),
      });
    },
  },
  {
    name: "model",
    every: 0,
    tick: async (ctx) => {
      await modelCaller.run(pooled(ctx), () => ctx.world.stores.voice(situation(1_000_000 + fresh())));
    },
  },
  {
    name: "relay",
    every: 50,
    tick: async (ctx) => {
      await sendRelays(ctx, 8, () => pooled(ctx));
    },
  },
  {
    name: "live",
    every: 200,
    tick: async (ctx) => {
      // one pet leaves and a new one comes into its room with its card, and twenty others move about
      const i = fresh();
      const at = i % Math.max(1, ctx.sockets.length);
      const old = ctx.sockets[at];
      if (old) {
        const room = Math.floor(at / 24);
        old.close();
        const secret = (20_000_000 + ctx.state.socketNext++).toString(16).padStart(32, "0");
        const ws = new FakeSocket();
        const id = playerIdFor(secret);
        ids.set(ws, id);
        ctx.world.rooms.handle(ws as never, pooled(ctx));
        ws.say({ t: "hello", id, key: secret, name: "Late", line: "gentle", stage: "adult", space: `room:${room}` });
        ws.say({ t: "card", lessons: maxCard(i) });
        ctx.sockets[at] = ws;
      }
      for (let k = 0; k < 20; k++)
        ctx.sockets[(i * 20 + k) % ctx.sockets.length]?.say({ t: "pos", x: 8 + ((i + k) % 100) });
    },
  },
  {
    name: "homes",
    every: 2_000,
    tick: async (ctx) => {
      // a new home with its decor and one wallet: when full, the home seen longest ago goes (A74)
      await makeHomes(ctx, ctx.state.homeNext++, 1, 1);
    },
  },
  {
    name: "home views",
    every: 50,
    tick: async (ctx) => {
      const i = fresh();
      if (!ctx.state.homes) return;
      const at = i % ctx.state.homes;
      const owner = homeId(at);
      await ctx.world.stores.homes.view(owner, ctx.world.next());
      await ctx.world.stores.homes.colourOf(owner, String(at + 1));
    },
  },
  {
    name: "reads",
    every: 20,
    tick: async (ctx) => {
      const i = fresh();
      const paths = [
        "/api/season/current",
        `/api/duels/${(i % 1000).toString(36).padStart(16, "0")}`,
        `/api/papers/${1 + (i % 1000)}`,
        `/api/pets/${1 + (i % 1000)}/log`,
        `/api/daily/${Math.floor(Date.now() / DAY) - (i % 20)}`,
        i % 2 ? "/" : `/page${i % ctx.caps.sitePages}.html`,
      ];
      await ctx.world.request(paths[i % paths.length] ?? "/", { ip: pooled(ctx) });
    },
  },
  {
    name: "limiters",
    every: 0,
    tick: async (ctx) => {
      // new callers on every limited door: the per-hour limiters are full and refuse them, the per-minute ones count them
      const i = fresh();
      const doors = [
        "/api/rpc",
        "/api/duels",
        "/api/errors",
        "/api/arena/snapshot",
        "/api/v1/agents/adopt",
        ...READ_LIMITS.map(() => "/api/season/current"),
      ];
      const door = doors[i % doors.length] ?? "/api/rpc";
      const body =
        door === "/api/rpc"
          ? { jsonrpc: "2.0", id: 1, method: "eth_blockNumber" }
          : door === "/api/season/current"
            ? undefined
            : "{}";
      await ctx.world.request(door, body === undefined ? {} : { body });
    },
  },
  {
    name: "sponsor",
    every: 60_000,
    tick: async (ctx) => {
      const account = privateKeyToAccount(`0x${(50_000 + fresh()).toString(16).padStart(64, "6")}`);
      const { request, signature } = await signSponsorRequest(account, {
        line: "gentle",
        state: "0",
        at: ctx.clock.now(),
      });
      await ctx.world.stores.sponsor.check({ ...request, signature }, ctx.world.next());
    },
  },
];

export interface ProbeResult {
  name: string;
  what: string;
  /** the measured cost of one thing kept, in bytes, and how many were added to measure it */
  bytesEach: number;
  added: number;
  /** the heap before and after, in MB */
  beforeMB: number;
  afterMB: number;
  /** what the store says it holds afterwards, where it can say */
  held?: number;
  note: string;
}

const heap = async () => (await floorNow()).heapUsed;

/** The agent pets' logs (agents.ts): a day of daily care at a time, on the store's own clock. */
export async function probeAgentLogs(ctx: Ctx, days: number): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  for (let d = 1; d <= days; d++) {
    const before = await heap();
    ctx.clock.offset += DAY;
    await each(ctx, ctx.state.agents.length, 1, async (i) => {
      const a = ctx.state.agents[i];
      if (a)
        await ctx.world.request("/api/v1/agents/me/care", {
          body: { action: "feed" },
          ip: a.ip,
          headers: { authorization: `Bearer ${a.token}` },
        });
    });
    const after = await heap();
    out.push({
      name: `agents, day ${d}`,
      what: "every agent pet fed once a day: its log gains a word a minute (pendingLog), and agents.ts never cuts it",
      bytesEach: (after - before) / Math.max(1, ctx.state.agents.length),
      added: ctx.state.agents.length,
      beforeMB: before / MB,
      afterMB: after / MB,
      note: "bytes each = per pet per simulated day",
    });
  }
  return out;
}

/** The diaries' day map (diaries.ts `spent`): one entry for every address that ever publishes, never let go. */
export async function probeDiarySpenders(ctx: Ctx, count: number): Promise<ProbeResult> {
  // a store of its own with no folder: the same code, without a file written for every publish
  const diaries = createDiaryStore();
  const words = [7];
  const id = "999999999";
  const chain = { logHash: logHashOf(words), born: 0 };
  diaries.publish({ petId: id, words, segments: [{ brainId: null, words }] }, chain, ctx.world.next());
  const before = await heap();
  for (let i = 0; i < count; i++) {
    if (i % 1024 === 0) ctx.check();
    diaries.publish({ petId: id, words, segments: [{ brainId: null, words }] }, chain, ctx.world.next());
  }
  const after = await heap();
  // read after the reading, so the store is still held when it is taken
  const spenders = diaries.stats().spenders;
  return {
    name: "diaries, per publishing address",
    held: spenders,
    what: "one diary published again from each of many addresses (in process, DiaryStore.publish on a store with no folder): nothing new is shelved",
    bytesEach: (after - before) / count,
    added: count,
    beforeMB: before / MB,
    afterMB: after / MB,
    note: "the per-address day map keeps every address it has seen, past days included",
  };
}

/** The sitting index (sitting.ts): packs of the smallest valid size, 8 an address; the byte cap counts only their text. */
export async function probeSittingCount(ctx: Ctx, count: number): Promise<ProbeResult & { msPerLeaveAtEnd: number }> {
  const store = createSittingStore(undefined, Date.now, { maxBytes: 256 * 1024 * 1024, perOwner: 8 });
  const tiny = JSON.stringify({ v: 1, pet: { bornAt: 0 } });
  const until = Date.now() + DAY;
  const before = await heap();
  let ip = ctx.world.next();
  let last = 0;
  for (let i = 0; i < count; i++) {
    if (i % 1024 === 0) ctx.check();
    if (i % 8 === 0) ip = ctx.world.next();
    const t = performance.now();
    await store.leave(tiny, "e".repeat(64), until, ip);
    if (i >= count - 100) last += performance.now() - t;
  }
  const after = await heap();
  return {
    name: "sitting, per smallest pack",
    what: `packs of ${tiny.length} characters, the smallest leave() takes (in process, a store with no folder, so only the index and the texts are in memory)`,
    bytesEach: (after - before) / count,
    added: count,
    beforeMB: before / MB,
    afterMB: after / MB,
    note: `${store.stats().packs} packs held; the shelf's 268,435,456 bytes hold ${Math.floor((256 * 1024 * 1024) / tiny.length).toLocaleString("en")} such packs`,
    msPerLeaveAtEnd: last / 100,
  };
}

/** A live connection's record of the cards it was sent (live.ts `seen`): one entry per pet it ever asked about. */
export async function probeLiveSeen(ctx: Ctx, askers: number, rounds: number): Promise<ProbeResult> {
  const rooms = new LiveRooms(createDecorStore());
  const sockets: Array<{ ws: FakeSocket; id: string }> = [];
  const card = petCard({ lessons: [] });
  for (let k = 0; k < askers; k++) {
    const secret = (30_000_000 + k).toString(16).padStart(32, "0");
    const ws = new FakeSocket();
    rooms.handle(ws as never, ctx.world.next());
    const id = playerIdFor(secret);
    ws.say({
      t: "hello",
      id,
      key: secret,
      name: "Asker",
      line: "gentle",
      stage: "adult",
      space: `room:${Math.floor(k / 24)}`,
    });
    ws.say({ t: "card", lessons: card });
    sockets.push({ ws, id });
  }
  const before = await heap();
  let asked = 0;
  for (let r = 0; r < rounds; r++) {
    // six asks a connection a minute (live.ts ROOM_LIMITS), each its own address so the address's 30 do not bind
    for (let k = 0; k < sockets.length; k++) {
      const me = sockets[k];
      const base = Math.floor(k / 24) * 24;
      for (let a = 0; a < 6; a++) {
        const peer = sockets[base + (((k % 24) + 1 + r * 6 + a) % 24)];
        if (!me || !peer || peer === me) continue;
        me.ws.say({ t: "ask", to: peer.id });
        asked++;
      }
    }
    if (r < rounds - 1) await new Promise((res) => setTimeout(res, 61_000));
  }
  const after = await heap();
  for (const s of sockets) s.ws.close();
  return {
    name: "live rooms, per pet a connection asked about",
    what: `${askers} connections, each asking about ${rounds * 6} of its room's pets (six a minute, the most a connection may)`,
    bytesEach: (after - before) / Math.max(1, asked),
    added: asked,
    beforeMB: before / MB,
    afterMB: after / MB,
    note: "a connection keeps one entry for every pet it ever asked about (or answered), for as long as it stays",
  };
}

/** The rate limiters at their ceiling (limit.ts): `keys` keys each with `max` requests in the window, per setting. */
export async function probeLimiterCeiling(
  ctx: Ctx,
  keys: number,
): Promise<Array<{ max: number; bytesPerKey: number }>> {
  const maxes = [
    ...new Set([...ctx.world.limiters.map((l) => l.max), ...READ_LIMITS.map(([, m]) => m), 20, 30, 40, 5]),
  ].sort((a, b) => a - b);
  const out: Array<{ max: number; bytesPerKey: number }> = [];
  const fill = (max: number) => {
    const limiter = new RateLimiter(max, 3_600_000, keys);
    const now = Date.now();
    for (let k = 0; k < keys; k++) {
      const key = `10.250.${(k >> 8) & 255}.${k & 255}`;
      for (let h = 0; h < max; h++) limiter.take(key, now + h);
    }
    return limiter;
  };
  // the limiter measured before is let go first: each reading must hold the one measured, and it alone
  let held: RateLimiter | null = null;
  for (const max of maxes) {
    ctx.check();
    held = null;
    const before = await heap();
    held = fill(max);
    const after = await heap();
    out.push({ max, bytesPerKey: (after - before) / held.size() });
  }
  return out;
}
