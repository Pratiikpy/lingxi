/**
 * The game's own routes (P7: out of server.ts): voice, sitting, the arena, moves between devices, push, the
 * mail, and the library of lessons.
 */
/**
 * Lingxi's own small server (web build only): teaching in plain words now;
 * presence, chat and the indexer join it later. The DeWEB build never calls it.
 *
 * The Claude key is read from tapeout/.secrets/anthropic.env (or the
 * ANTHROPIC_API_KEY environment variable) and never leaves this process.
 */

import { readFileSync } from "node:fs";
import { type Context, Hono } from "hono";
import {
  ArenaOpponentQuery,
  ArenaSnapshotBody,
  LessonKeyBody,
  LessonShareBody,
  MoveBody,
  PushPlanBody,
  PushStopBody,
  SitHomeBody,
  SitLeaveBody,
  VoiceBody,
} from "@lingxi/api-schema";
import { RateLimiter } from "../limit";
import { type SittingStore } from "../sitting";
import { type ArenaStore } from "../arena";
import { type Letter, currentLetters } from "../mail";
import { createPusher, type Pusher } from "../push";
import { createVoice } from "../voice";
import { type Library } from "../library";
import { type MoveStore } from "../move";
import { clientIp } from "../clientIp";
import { modelCaller } from "../tokenBudget";
import { LINGXI_SITE } from "@lingxi/chain/site";

/**
 * A refusal the app expects in normal play (rate limits, the daily tape-out
 * budget, a pet the history has not reached yet) answers 200 with ok:false, so
 * the player's browser shows our own message instead of logging a page error.
 * Malformed requests, which our client never sends, keep their 4xx codes.
 */
export function busy(c: Context): Response {
  c.header("Retry-After", "60");
  return c.json({ ok: false, reason: "busy" });
}

/** The pet's voice: one line for what its circuit decided (cached per situation). */
export function withVoice(
  app: Hono,
  voice: ReturnType<typeof createVoice>,
  limiter = new RateLimiter(40, 600_000),
): Hono {
  app.post("/api/voice", async (c) => {
    const ip = clientIp(c);
    // a missing line is normal (the pet falls back to its own words), so busy and
    // model hiccups answer 200 with ok:false rather than showing up as page errors
    if (!limiter.take(ip)) {
      c.header("Retry-After", "60");
      return c.json({ ok: false, reason: "busy" });
    }
    let body;
    try {
      body = VoiceBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    return c.json(await modelCaller.run(ip, () => voice(body)));
  });
  return app;
}

/** The lesson library: shared lessons, most learned first, with the pet that taught each first. */
/** Pet-sitting packs: leave a pet for a friend, collect it, send it home (the owner's game checks the return). */
export function withSitting(app: Hono, store: SittingStore, writes = new RateLimiter(30, 3_600_000)): Hono {
  const who = (c: Context) => clientIp(c);
  app.post("/api/sit", async (c) => {
    if (!writes.take(who(c))) return busy(c);
    let body;
    try {
      body = SitLeaveBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    return c.json(await store.leave(body.pack, body.keyHash, body.until, who(c)));
  });
  app.get("/api/sit/:code", async (c) => {
    // the code is the pack's key: never kept by a shared cache; heavy, so limited per caller (A119)
    c.header("Cache-Control", "no-store");
    const r = await store.collect(c.req.param("code"));
    return c.json(r ? { ok: true, ...r } : { ok: false, reason: "unknown" });
  });
  app.post("/api/sit/:code/home", async (c) => {
    if (!writes.take(who(c))) return busy(c);
    let body;
    try {
      body = SitHomeBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    return c.json(
      (await store.sendHome(c.req.param("code"), body.key, body.pet)) ? { ok: true } : { ok: false, reason: "refused" },
    );
  });
  return app;
}

/** Arena snapshots: save the line fielded at a round; meet another player's line at the same round. */
export function withArena(app: Hono, store: ArenaStore, writes = new RateLimiter(120, 3_600_000)): Hono {
  const who = (c: Context) => clientIp(c);
  app.post("/api/arena/snapshot", async (c) => {
    if (!writes.take(who(c))) return busy(c);
    let body;
    try {
      body = ArenaSnapshotBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    const r = store.save(body.round, body.pet, body.team, body.device, clientIp(c));
    // a sender past its share of the round is an answer, not an error (A144)
    return c.json(r, r.ok || r.reason === "busy" ? 200 : 400);
  });
  app.get("/api/arena/opponent", (c) => {
    const q = ArenaOpponentQuery.safeParse(c.req.query());
    if (!q.success) return c.json({ ok: false, reason: "invalid" }, 400);
    const s = store.pick(q.data.round, q.data.device);
    return c.json(s ? { ok: true, ...s } : { ok: false, reason: "none" });
  });
  return app;
}

/** Moving pets between Telegram and a browser: a one-time code, claimed once within minutes. */
export function withMove(app: Hono, store: MoveStore, limiter = new RateLimiter(20, 60 * 60_000)): Hono {
  const ipOf = (c: Context) => clientIp(c);
  app.post("/api/move", async (c) => {
    if (!limiter.take(ipOf(c))) return c.json({ ok: false, reason: "busy" }, 429);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    const move = MoveBody.safeParse(body);
    if (!move.success) return c.json({ ok: false, reason: "invalid" }, 400);
    const r = store.put(move.data.save, ipOf(c));
    return c.json(r, r.ok ? 200 : r.reason === "invalid" ? 400 : r.reason === "tooBig" ? 413 : 503);
  });
  app.post("/api/move/:code/claim", (c) => {
    if (!limiter.take(ipOf(c))) return c.json({ ok: false, reason: "busy" }, 429);
    const code = c.req.param("code");
    if (!/^[A-Za-z0-9_-]{22}$/.test(code)) return c.json({ ok: false, reason: "invalid" }, 400);
    const save = store.take(code);
    c.header("Cache-Control", "no-store");
    // a used or expired code is an answer, not an error: the page explains it
    return c.json(save ? { ok: true, save } : { ok: false, reason: "gone" });
  });
  return app;
}

/** Reminder routes: the public key to subscribe with, a plan of upcoming reminders, and stop. */
export function withPush(app: Hono, pusher: Pusher, limiter = new RateLimiter(30, 3_600_000)): Hono {
  app.get("/api/push/key", (c) => c.json({ key: pusher.publicKey }));
  app.post("/api/push/plan", async (c) => {
    const ip = clientIp(c);
    if (!limiter.take(ip)) return busy(c);
    let body;
    try {
      body = PushPlanBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    const r = pusher.plan(body, Date.now(), ip);
    return c.json(r, r.ok ? 200 : 400);
  });
  app.post("/api/push/stop", async (c) => {
    let endpoint: string;
    try {
      endpoint = PushStopBody.parse(await c.req.json()).endpoint;
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    return c.json({ ok: true, stopped: pusher.stop(endpoint) });
  });
  return app;
}

/** Reminders, when a key file (VAPID_PUBLIC / VAPID_PRIVATE / VAPID_SUBJECT) is configured. */
export function makePusher(): Pusher | null {
  const file = process.env.LINGXI_PUSH_KEY_FILE;
  if (!file) return null;
  const env = Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) return null;
  return createPusher({
    publicKey: env.VAPID_PUBLIC,
    privateKey: env.VAPID_PRIVATE,
    subject: env.VAPID_SUBJECT ?? LINGXI_SITE,
    store: process.env.LINGXI_PUSH_STORE,
  });
}

/** In-game mail: the letters current now, newest first. */
export function withMail(app: Hono, letters: () => readonly Letter[], now: () => number = Date.now): Hono {
  app.get("/api/mail", (c) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json({ ok: true, letters: currentLetters(letters(), now()) });
  });
  return app;
}

export function withLibrary(app: Hono, library: Library, writes = new RateLimiter(60, 3_600_000)): Hono {
  const who = (c: Context) => clientIp(c);
  app.get("/api/lessons", (c) => {
    c.header("Cache-Control", "public, max-age=30");
    return c.json({ ok: true, lessons: library.list(40) });
  });
  app.post("/api/lessons/share", async (c) => {
    if (!writes.take(who(c))) return busy(c);
    let body;
    try {
      body = LessonShareBody.parse(await c.req.json());
    } catch {
      return c.json({ ok: false, reason: "invalid" }, 400);
    }
    const r = library.share(body.rule, body.by, who(c), Date.now());
    return c.json(r, r.ok ? 200 : 400);
  });
  for (const action of ["use", "report"] as const) {
    app.post(`/api/lessons/${action}`, async (c) => {
      if (!writes.take(who(c))) return busy(c);
      let body;
      try {
        body = LessonKeyBody.parse(await c.req.json());
      } catch {
        return c.json({ ok: false, reason: "invalid" }, 400);
      }
      return c.json({ ok: library[action](body.key, who(c)) });
    });
  }
  return app;
}
