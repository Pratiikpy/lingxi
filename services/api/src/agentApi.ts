/**
 * The open API for AI agents (PRD F30, F31, M10), at /api/v1:
 *   read any pet on X Layer, its brain netlist and its proofs;
 *   read the interface manifests (PET-16x8/1, DUEL-12x3/1);
 *   spar any brain against the game's partners, companions or TapeFly's rivals;
 *   adopt, care for, teach and raise a pet, and enter it in the weekly season;
 *   read the scoreboard of agent-raised against human-raised pets.
 * An agent's pet is reached with `Authorization: Bearer <token>`, never by a
 * token in the URL.
 */

import type { Context, Hono } from "hono";
import type { Address, PublicClient } from "viem";
import type { z } from "zod";
import { AgentAdoptBody, AgentCareBody, AgentTeachBody, SparQuery } from "@lingxi/api-schema";
import { MANIFESTS, MAX_GATES as BRAIN_MAX, compileProgram, decodeProgram, gateCount } from "@lingxi/brain";
import { type Deployment, readMetadata, readNetlist, readPet } from "@lingxi/chain";
import {
  FLY_RIVALS,
  type Fighter,
  MAX_ENTRIES,
  MAX_GATES,
  PARTNERS,
  type SparResult,
  fighterFrom,
  fighterOfPartner,
  flyFighter,
  parseFlyBrain,
  scoreboard,
  spar,
} from "@lingxi/game";
import { programOfChips } from "@lingxi/brain";
import type { AgentStore } from "./agents";
import { MAX_AGENT_ENTRIES, type SeasonStore } from "./season";
import { RateLimiter } from "./limit";
import { clientIp } from "./clientIp";

const SITE = "https://lingxi.knole.me";
const SPAR_LEVEL = 1;

export interface AgentApiDeps {
  agents: AgentStore;
  seasons: SeasonStore;
  chain?: { pub: PublicClient; deployment: Deployment };
  limiter?: RateLimiter;
}

const who = (c: Context) => clientIp(c);

/** An agent's body as its schema reads it (a body that is JSON but not an object reads as an empty one); null when it is not JSON. */
async function lenient<S extends z.ZodType<object>>(c: Context, schema: S): Promise<z.output<S> | null> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return null;
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : schema.parse({});
}
const bearer = (c: Context) => (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

function opponent(vs: string): Fighter | null {
  if (vs.startsWith("fly:")) {
    const r = FLY_RIVALS.find((x) => x.id === vs.slice(4));
    return r ? flyFighter(r.name, programOfChips(r.chips), SPAR_LEVEL) : null;
  }
  const p = PARTNERS.find((x) => x.id === vs);
  return p ? fighterOfPartner(p) : null;
}

function summary(r: SparResult) {
  return {
    winner: r.winner === 0 ? "you" : r.winner === 1 ? "them" : "draw",
    seed: r.seed,
    digest: r.digest,
    rounds: r.rounds.map((x) => ({ n: x.n + 1, you: x.moves[0], them: x.moves[1], hp: x.hp, words: x.words })),
  };
}

export function withAgentApi(app: Hono, deps: AgentApiDeps): Hono {
  const limiter = deps.limiter ?? new RateLimiter(240, 3_600_000);
  const guard = (c: Context) => (limiter.take(who(c)) ? null : c.json({ ok: false, reason: "busy" }, 200));

  app.get("/api/v1", (c) =>
    c.json({
      ok: true,
      what: "Lingxi: pets whose minds are circuits of NAND gates and latches, taped out on X Layer once their owners keep them there. Everything a player can see, an agent can read; an agent can also raise its own pet.",
      docs: `${SITE}/agents.html`,
      endpoints: {
        "GET /api/v1/profiles": "interface manifests: what every input and output bit of a pet brain (PET-16x8/1) and a TapeFly brawl brain (DUEL-12x3/1) means",
        "GET /api/v1/partners": "sparring partners, arena companions and TapeFly's ladder rivals, with their programs",
        "GET /api/v1/spar?program=lx1.…&vs=pip": "spar a brain (a Lingxi program code, or p1=… / chips=… for a TapeFly brain) against a partner or fly:<rival>; &seed= for a fixed fight",
        "GET /api/v1/pets/:id": "a pet on X Layer: owner, line, brain circuit, day, log hash, and its picture as PetLook draws it on chain (an SVG data URI)",
        "GET /api/v1/pets/:id/brain": "the pet's brain netlist as stored on chain (TAP-02 bytes)",
        "POST /api/v1/agents/adopt": "{ agent, name, line, instincts? } → a token; keep it, it is shown once. At most 5 pets at once per agent name and per address; a pet nobody cares for in 30 days goes home",
        "GET /api/v1/agents/me": "your pet now (Authorization: Bearer <token>)",
        "POST /api/v1/agents/me/care": "{ action: feed|play|clean|pet|medicine|lightsOff|wake|talk, food? }",
        "POST /api/v1/agents/me/teach": "{ rule: { when: {...}, then: { want, mood } } } in the PET-16x8/1 rule language",
        "POST /api/v1/agents/me/season": "enter your pet in this week's season, marked as raised by an agent: at most 3 entries per address a week, and agent-raised pets may take at most 16 of the week's 64 places; players may fill all 64",
        "GET /api/v1/scoreboard": "agent-raised against human-raised pets, week by week",
      },
    }),
  );

  app.get("/api/v1/profiles", (c) => c.json({ ok: true, profiles: MANIFESTS }));

  app.get("/api/v1/partners", (c) =>
    c.json({
      ok: true,
      partners: PARTNERS.map((p) => ({ id: p.id, name: p.name, line: p.line, level: p.level, profile: "PET-16x8/1", program: p.program })),
      flyRivals: FLY_RIVALS.map((r) => ({ id: `fly:${r.id}`, name: r.name, profile: "DUEL-12x3/1", chips: r.chips, program: programOfChips(r.chips) })),
    }),
  );

  app.get("/api/v1/spar", (c) => {
    const busy = guard(c);
    if (busy) return busy;
    const parsed = SparQuery.safeParse(c.req.query());
    if (!parsed.success) return c.json({ ok: false, reason: "invalid" }, 400);
    const q = parsed.data;
    let me: Fighter;
    try {
      if (q.program) {
        const program = decodeProgram(q.program);
        const gates = gateCount(compileProgram(program));
        if (gates > Math.min(MAX_GATES, BRAIN_MAX)) return c.json({ ok: false, reason: "tooBig", detail: `${gates} gates; the most a pet brain may have is ${MAX_GATES}` }, 400);
        me = fighterFrom("you", program, SPAR_LEVEL);
      } else if (q.p1 || q.chips) {
        me = flyFighter("you", parseFlyBrain(q.p1 ?? q.chips!), SPAR_LEVEL);
      } else return c.json({ ok: false, reason: "invalid", detail: "give program=lx1.… or p1=… or chips=a,b,c" }, 400);
    } catch (e) {
      return c.json({ ok: false, reason: "invalid", detail: (e as Error).message }, 400);
    }
    const them = opponent(q.vs ?? "");
    if (!them) return c.json({ ok: false, reason: "invalid", detail: "vs must be a partner id or fly:<rival>; see /api/v1/partners" }, 400);
    const seed = q.seed !== undefined ? Number(q.seed) >>> 0 : (Math.random() * 2 ** 32) >>> 0;
    return c.json({ ok: true, vs: q.vs, ...summary(spar(me, them, seed)) });
  });

  app.get("/api/v1/pets/:id", async (c) => {
    if (!deps.chain) return c.json({ ok: false, reason: "unavailable" }, 503);
    const busy = guard(c);
    if (busy) return busy;
    const id = c.req.param("id");
    if (!/^\d{1,9}$/.test(id) || id === "0") return c.json({ ok: false, reason: "invalid" }, 400);
    try {
      const p = await readPet(deps.chain.pub, deps.chain.deployment, BigInt(id));
      const meta = await readMetadata(deps.chain.pub, deps.chain.deployment, BigInt(id)).catch(() => null);
      return c.json({
        ok: true,
        id,
        owner: p.owner,
        name: meta?.name ?? "",
        line: ["gentle", "bold", "curious"][p.line] ?? p.line,
        processor: p.processor,
        brainId: p.brainId.toString(),
        brainBits: p.brainBits,
        day: p.day,
        born: p.born,
        logHash: p.logHash,
        // the picture PetLook draws on chain, from the registry's own token URI (null if it could not be read)
        image: meta?.image ?? null,
        parents: p.parentA ? [p.parentA.toString(), p.parentB.toString()] : [],
        proof: `${SITE}/verify.html#${id}`,
        history: `${SITE}/api/pets/${id}/history`,
        brain: `${SITE}/api/v1/pets/${id}/brain`,
      });
    } catch {
      return c.json({ ok: false, reason: "unknown", detail: "no pet with that number" }, 404);
    }
  });

  app.get("/api/v1/pets/:id/brain", async (c) => {
    if (!deps.chain) return c.json({ ok: false, reason: "unavailable" }, 503);
    const busy = guard(c);
    if (busy) return busy;
    const id = c.req.param("id");
    if (!/^\d{1,9}$/.test(id) || id === "0") return c.json({ ok: false, reason: "invalid" }, 400);
    try {
      const p = await readPet(deps.chain.pub, deps.chain.deployment, BigInt(id));
      const nl = await readNetlist(deps.chain.pub, p.processor as Address, p.brainId);
      return c.json({ ok: true, id, profile: "PET-16x8/1", processor: p.processor, brainId: p.brainId.toString(), netlist: nl.bytes, nIn: nl.nIn, nOut: nl.nOut, nState: nl.nState, gates: nl.gates });
    } catch {
      return c.json({ ok: false, reason: "unknown", detail: "no pet with that number" }, 404);
    }
  });

  app.post("/api/v1/agents/adopt", async (c) => {
    const busy = guard(c);
    if (busy) return busy;
    const body = await lenient(c, AgentAdoptBody);
    if (!body) return c.json({ ok: false, reason: "invalid" }, 400);
    const r = deps.agents.adopt(String(body.agent ?? ""), String(body.name ?? ""), String(body.line ?? ""), body.instincts === undefined ? 0 : Number(body.instincts), who(c));
    if (!r.ok) return c.json({ ok: false, reason: r.reason, detail: r.detail ?? (r.reason === "invalid" ? "agent: 2-32 letters, digits, space, dot or dash; name: 1-16 characters; line: gentle, bold or curious; instincts: 0-15" : undefined) }, r.reason === "invalid" ? 400 : 200);
    return c.json({ ok: true, token: r.token, note: "Keep this token: send it as Authorization: Bearer <token>. It is shown only once.", pet: r.pet });
  });

  const mine = (c: Context) => {
    const token = bearer(c);
    return token ? token : null;
  };

  app.get("/api/v1/agents/me", (c) => {
    const t = mine(c);
    const v = t ? deps.agents.view(t) : null;
    return v ? c.json({ ok: true, pet: v }) : c.json({ ok: false, reason: "unknown", detail: "send Authorization: Bearer <token> from /api/v1/agents/adopt" }, 401);
  });

  app.post("/api/v1/agents/me/care", async (c) => {
    const busy = guard(c);
    if (busy) return busy;
    const t = mine(c);
    if (!t) return c.json({ ok: false, reason: "unknown" }, 401);
    const body = await lenient(c, AgentCareBody);
    if (!body) return c.json({ ok: false, reason: "invalid" }, 400);
    const r = deps.agents.act(t, String(body.action ?? ""), body.food === undefined ? undefined : String(body.food));
    if (!r.ok) return c.json({ ok: false, reason: r.reason }, r.reason === "unknown" ? 401 : 400);
    return c.json(r);
  });

  app.post("/api/v1/agents/me/teach", async (c) => {
    const busy = guard(c);
    if (busy) return busy;
    const t = mine(c);
    if (!t) return c.json({ ok: false, reason: "unknown" }, 401);
    const body = await lenient(c, AgentTeachBody);
    if (!body) return c.json({ ok: false, reason: "invalid" }, 400);
    const r = deps.agents.teach(t, body.rule);
    if (!r.ok) return c.json(r, r.reason === "unknown" ? 401 : 200);
    return c.json(r);
  });

  app.post("/api/v1/agents/me/season", (c) => {
    const busy = guard(c);
    if (busy) return busy;
    const t = mine(c);
    const sp = t ? deps.agents.seasonPet(t) : null;
    if (!t || !sp) return c.json({ ok: false, reason: "unknown" }, 401);
    // an agent's entry counts against its address like a player's, and agents share a quarter of the week (A41)
    const r = deps.seasons.enter(sp.pet, `agent-${t.slice(0, 40)}`, { agent: sp.agent, from: who(c) });
    if (!r.ok && r.reason === "agentsFull") return c.json({ ok: false, reason: r.reason, detail: `agent-raised pets may take at most ${MAX_AGENT_ENTRIES} of the week's ${MAX_ENTRIES} places, and those are taken; players may still enter` });
    return c.json(r, r.ok || r.reason === "full" || r.reason === "tooMany" ? 200 : 400);
  });

  app.get("/api/v1/scoreboard", (c) => {
    const views = deps.seasons
      .weeks()
      .map((w) => deps.seasons.view(w))
      .filter((v): v is NonNullable<typeof v> => !!v && v.entries.length > 0);
    // a week whose standings are still being fought shows the last ones known, marked pending (A38)
    const rows = scoreboard(views.map((v) => ({ week: v.week, standings: v.standings })));
    return c.json({ ok: true, weeks: rows.map((r, i) => (views[i]!.pending ? { ...r, pending: true } : r)) });
  });

  return app;
}
