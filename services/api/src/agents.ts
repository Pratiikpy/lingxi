/**
 * Pets raised by AI agents (PRD M10, F30). An agent adopts a pet over HTTP and
 * gets a secret token; it then cares for and teaches the pet through the same
 * game rules a player's browser runs (@lingxi/game sim.ts and lessons.ts), on
 * the server's clock. Only a hash of each token is kept. An agent-raised pet can
 * enter the weekly season, where it is marked as raised by an agent, which is
 * what the public scoreboard compares.
 *
 * An agent's pet keeps no input log (P10). A pet's log takes a word a minute it thinks, and serves its proofs on X Layer,
 * its diary and Rewind; an agent's pet is never kept on chain, and no route serves its log (the agent API shows its
 * state, and its season entry carries its card). Kept, it grew 14.3 KB a pet each day an agent cared for it, without
 * end: 70 MB a day at the cap of 5,000 pets. It is started afresh at the pet's present memory each time the pet is
 * caught up, cared for or taught, as a guest pet's log is cut past its bound (A148).
 */

import { CODE, codeOf, heldOverCoded, recoded, scrubAsides } from "./pseudonym";
import { createHash, randomBytes } from "node:crypto";
import { MOODS, type Rule, type StarterLine, WANTS, compileProgram, gateCount, validateProgram } from "@lingxi/brain";
import {
  type Care,
  type DuelPet,
  type Pet,
  TRAITS,
  care,
  catchUp,
  cleanInstincts,
  createPet,
  dayOf,
  growthOf,
  levelUpPet,
  withGrowth,
  mindBrain,
  petCard,
  restartLog,
  stageOf,
  teach,
  toVisible,
} from "@lingxi/game";
import { hasStore, readStore, saveJson } from "./durable";
import { basename, dirname } from "node:path";

const MAX_PETS = 5_000;
const MAX_PER_AGENT = 5;
/** Agent pets one address may raise at once, whatever agent names it uses (A41). */
export const MAX_PER_ADDRESS = 5;
/** An agent pet nobody has looked at or cared for this long goes home, freeing its place (A41). */
export const AGENT_IDLE_MS = 30 * 86_400_000;
const LINES = new Set<StarterLine>(["gentle", "bold", "curious"]);
export const AGENT_CARE = ["feed", "play", "clean", "pet", "medicine", "lightsOff", "wake", "talk"] as const;
export type AgentCare = (typeof AGENT_CARE)[number];

interface Kept {
  agent: string;
  pet: Pet;
  created: number;
  /** the code of the address that adopted it (never the address, P6a), for the per-address cap */
  from?: string;
  /** the code of that address's IPv6 /48, when it has one */
  net?: string;
  /** when it was last looked at or cared for */
  seen?: number;
}

export interface AgentPetView {
  name: string;
  line: StarterLine;
  agent: string;
  stage: string;
  day: number;
  level: number;
  meters: { food: number; joy: number; energy: number; clean: number };
  asleep: boolean;
  sick: boolean;
  hibernating: boolean;
  /** what its circuit decided on the last beat */
  thinking: { want: string; mood: string; rule: number };
  lessons: Rule[];
  instincts: number;
  traits: Record<string, number>;
  gates: number;
}

export type AgentRefusal = "invalid" | "unknown" | "full" | "tooMany";

const hash = (token: string) => createHash("sha256").update(`lingxi-agent:${token}`).digest("hex");
const brainOf = (p: Pet) =>
  mindBrain({
    line: p.line,
    lessons: p.lessons,
    family: p.family,
    instincts: p.instincts,
    outside: p.outside,
    growth: p.growth,
  });

/**
 * An agent's pet has no skills screen: it levels up by itself as its XP allows (plan 4.4), and its points wait. Its input
 * log is started afresh at its present memory: nothing reads an agent's pet's log (see above).
 */
function grown(p0: Pet): Pet {
  let p = withGrowth(p0);
  for (let r = levelUpPet(p); r.ok; r = levelUpPet(p)) p = r.pet;
  return p.pendingLog.length ? restartLog(p, p.pendingLog.length, p.brain) : p;
}

export function viewOf(k: Kept, now: number): AgentPetView {
  const p = k.pet;
  const b = brainOf(p);
  return {
    name: p.name,
    line: p.line,
    agent: k.agent,
    stage: stageOf(p, now),
    day: dayOf(p, now),
    level: growthOf(p).level,
    meters: {
      food: toVisible(p.meters.food),
      joy: toVisible(p.meters.joy),
      energy: toVisible(p.meters.energy),
      clean: toVisible(p.meters.clean),
    },
    asleep: p.asleep,
    sick: !!p.sick,
    hibernating: p.hibernating,
    thinking: { want: WANTS[p.last.want] ?? "idle", mood: MOODS[p.last.mood] ?? "calm", rule: p.last.rule },
    lessons: p.lessons,
    instincts: p.instincts ?? 0,
    traits: Object.fromEntries(TRAITS.map((t) => [t, p.traits[t]])),
    gates: b.program ? gateCount(compileProgram(b.program)) : 0,
  };
}

export interface AgentStore {
  adopt: (
    agent: string,
    name: string,
    line: string,
    instincts?: number,
    from?: string,
  ) => { ok: true; token: string; pet: AgentPetView } | { ok: false; reason: AgentRefusal; detail?: string };
  view: (token: string) => AgentPetView | null;
  act: (
    token: string,
    kind: string,
    food?: string,
  ) => { ok: true; note: string; pet: AgentPetView } | { ok: false; reason: AgentRefusal };
  teach: (
    token: string,
    rule: unknown,
  ) => { ok: true; pet: AgentPetView } | { ok: false; reason: AgentRefusal | string; detail?: string };
  /** the pet as it would enter a season, and who raised it */
  seasonPet: (token: string) => { pet: DuelPet; agent: string } | null;
}

export function createAgentStore(file?: string, now: () => number = Date.now): AgentStore {
  const pets = new Map<string, Kept>();
  /** a pet kept before addresses were coded held its adopter's address: it is coded on load (P6a) */
  let raw = false;
  if (file && hasStore(file)) {
    try {
      for (const [h, k] of Object.entries(readStore(file) as Record<string, Kept>)) {
        if (!/^[0-9a-f]{64}$/.test(h)) continue;
        if (k.from !== undefined && !CODE.test(k.from)) {
          const c = recoded(k.from);
          pets.set(h, { ...k, from: c.by, ...(c.net !== undefined ? { net: c.net } : {}) });
          raw = true;
        } else pets.set(h, k);
      }
    } catch {
      // a damaged file starts empty rather than stopping the server
    }
  }
  let dirty = false;
  const save = () => {
    if (!file || !dirty) return;
    dirty = false;
    try {
      saveJson(file, undefined, JSON.stringify(Object.fromEntries(pets)));
    } catch (e) {
      process.stderr.write(`agent store not saved: ${(e as Error).message}\n`);
    }
  };
  if (file) setInterval(save, 15_000).unref();
  if (file && raw) {
    // written twice, so the .bak each write keeps holds no address either
    dirty = true;
    save();
    dirty = true;
    save();
  }
  if (file) scrubAsides(dirname(file), basename(file));
  /** pets idle past `AGENT_IDLE_MS` go home */
  const letIdleGo = (t: number) => {
    for (const [h, k] of pets)
      if (t - (k.seen ?? k.created) > AGENT_IDLE_MS) {
        pets.delete(h);
        dirty = true;
      }
  };
  letIdleGo(now());
  const touch = (h: string, k: Kept) => {
    pets.set(h, k);
    dirty = true;
  };
  /**
   * the pet brought up to the present before anything is read or done; only care (`keep`) keeps it from going home, so
   * a crowd of pets is not held by reading them (A83)
   */
  const current = (token: string, keep = false): [string, Kept] | null => {
    if (typeof token !== "string" || !/^[0-9a-f]{48}$/.test(token)) return null;
    const h = hash(token);
    const k = pets.get(h);
    if (!k) return null;
    const caught = grown(catchUp(k.pet, now(), brainOf(k.pet)));
    const next = { ...k, pet: caught, ...(keep ? { seen: now() } : {}) };
    touch(h, next);
    return [h, next];
  };
  return {
    adopt: (agent, name, line, instincts = 0, from) => {
      if (
        typeof agent !== "string" ||
        !/^[\w .-]{2,32}$/.test(agent) ||
        typeof name !== "string" ||
        name.trim().length < 1 ||
        name.length > 16 ||
        !LINES.has(line as StarterLine)
      )
        return { ok: false, reason: "invalid" };
      if (!Number.isInteger(instincts) || instincts < 0 || instincts > 15) return { ok: false, reason: "invalid" };
      const t = now();
      letIdleGo(t);
      if (pets.size >= MAX_PETS) return { ok: false, reason: "full" };
      if ([...pets.values()].filter((k) => k.agent === agent).length >= MAX_PER_AGENT)
        return { ok: false, reason: "tooMany", detail: `an agent may raise at most ${MAX_PER_AGENT} pets` };
      // an IPv6 /48 raises four addresses' worth (A83)
      const who = from ? codeOf(from) : null;
      if (
        who &&
        heldOverCoded(
          [...pets.values()].flatMap((k) => (k.from ? [{ by: k.from, ...(k.net ? { net: k.net } : {}) }] : [])),
          who,
          MAX_PER_ADDRESS,
        )
      )
        return {
          ok: false,
          reason: "tooMany",
          detail: `at most ${MAX_PER_ADDRESS} pets at once from one address, whatever agent names it uses; a pet nobody cares for in 30 days goes home`,
        };
      const inst = cleanInstincts(instincts);
      const brain = mindBrain({ line: line as StarterLine, lessons: [], instincts: inst });
      const pet = createPet({
        name: name.trim(),
        line: line as StarterLine,
        now: t,
        tzOffsetMin: 0,
        brain,
        instincts: inst,
      });
      const token = randomBytes(24).toString("hex");
      const k: Kept = {
        agent,
        pet,
        created: t,
        seen: t,
        ...(who ? { from: who.by, ...(who.net ? { net: who.net } : {}) } : {}),
      };
      touch(hash(token), k);
      save();
      return { ok: true, token, pet: viewOf(k, t) };
    },
    view: (token) => {
      const c = current(token);
      return c ? viewOf(c[1], now()) : null;
    },
    act: (token, kind, food) => {
      const c = current(token, true);
      if (!c) return { ok: false, reason: "unknown" };
      if (!(AGENT_CARE as readonly string[]).includes(kind)) return { ok: false, reason: "invalid" };
      const action: Care =
        kind === "feed"
          ? { kind: "feed", food: typeof food === "string" && food ? food : "mochi" }
          : ({ kind } as Care);
      let r;
      try {
        r = care(c[1].pet, action, now(), brainOf(c[1].pet));
      } catch {
        return { ok: false, reason: "invalid" };
      }
      const next = { ...c[1], pet: grown(r.pet) };
      touch(c[0], next);
      return { ok: true, note: r.note, pet: viewOf(next, now()) };
    },
    teach: (token, rule) => {
      const c = current(token, true);
      if (!c) return { ok: false, reason: "unknown" };
      // the rule's shape first, so a malformed rule is called malformed whatever room the mind has
      let clean: Rule;
      try {
        clean = validateProgram({ version: "LX-PET/1", memory: [], rules: [rule], otherwise: { want: 0, mood: 1 } })
          .rules[0]!;
      } catch (e) {
        return { ok: false, reason: "invalid", detail: (e as Error).message };
      }
      let r;
      try {
        r = teach(c[1].pet, clean, now());
      } catch (e) {
        return { ok: false, reason: "invalid", detail: (e as Error).message };
      }
      if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail };
      const after = care(r.pet, { kind: "talk" }, now(), brainOf(r.pet)).pet;
      const next = { ...c[1], pet: grown(after) };
      touch(c[0], next);
      return { ok: true, pet: viewOf(next, now()) };
    },
    seasonPet: (token) => {
      const c = current(token);
      if (!c) return null;
      const p = c[1].pet;
      return {
        agent: c[1].agent,
        pet: {
          name: p.name,
          line: p.line,
          stage: stageOf(p, now()),
          card: petCard(p),
          story: { days: dayOf(p, now()), lessons: p.lessons.length, nature: [] },
        },
      };
    },
  };
}
