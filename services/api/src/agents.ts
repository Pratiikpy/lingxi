/**
 * Pets raised by AI agents (PRD M10, F30). An agent adopts a pet over HTTP and
 * gets a secret token; it then cares for and teaches the pet through the same
 * game rules a player's browser runs (@lingxi/game sim.ts and lessons.ts), on
 * the server's clock. Only a hash of each token is kept. An agent-raised pet can
 * enter the weekly season, where it is marked as raised by an agent, which is
 * what the public scoreboard compares.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
  levelOf,
  mindBrain,
  petCard,
  stageOf,
  teach,
  toVisible,
} from "@lingxi/game";

const MAX_PETS = 5_000;
const MAX_PER_AGENT = 5;
const LINES = new Set<StarterLine>(["gentle", "bold", "curious"]);
export const AGENT_CARE = ["feed", "play", "clean", "pet", "medicine", "lightsOff", "wake", "talk"] as const;
export type AgentCare = (typeof AGENT_CARE)[number];

interface Kept {
  agent: string;
  pet: Pet;
  created: number;
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
const brainOf = (p: Pet) => mindBrain({ line: p.line, lessons: p.lessons, family: p.family, instincts: p.instincts });

export function viewOf(k: Kept, now: number): AgentPetView {
  const p = k.pet;
  const b = brainOf(p);
  return {
    name: p.name,
    line: p.line,
    agent: k.agent,
    stage: stageOf(p, now),
    day: dayOf(p, now),
    level: levelOf(p.xp).level,
    meters: { food: toVisible(p.meters.food), joy: toVisible(p.meters.joy), energy: toVisible(p.meters.energy), clean: toVisible(p.meters.clean) },
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
  adopt: (agent: string, name: string, line: string, instincts?: number) => { ok: true; token: string; pet: AgentPetView } | { ok: false; reason: AgentRefusal };
  view: (token: string) => AgentPetView | null;
  act: (token: string, kind: string, food?: string) => { ok: true; note: string; pet: AgentPetView } | { ok: false; reason: AgentRefusal };
  teach: (token: string, rule: unknown) => { ok: true; pet: AgentPetView } | { ok: false; reason: AgentRefusal | string; detail?: string };
  /** the pet as it would enter a season, and who raised it */
  seasonPet: (token: string) => { pet: DuelPet; agent: string } | null;
}

export function createAgentStore(file?: string, now: () => number = Date.now): AgentStore {
  const pets = new Map<string, Kept>();
  if (file && existsSync(file)) {
    try {
      for (const [h, k] of Object.entries(JSON.parse(readFileSync(file, "utf8")) as Record<string, Kept>)) if (/^[0-9a-f]{64}$/.test(h)) pets.set(h, k);
    } catch {
      // a damaged file starts empty rather than stopping the server
    }
  }
  let dirty = false;
  const save = () => {
    if (!file || !dirty) return;
    dirty = false;
    try {
      writeFileSync(`${file}.tmp`, JSON.stringify(Object.fromEntries(pets)));
      renameSync(`${file}.tmp`, file);
    } catch (e) {
      process.stderr.write(`agent store not saved: ${(e as Error).message}\n`);
    }
  };
  if (file) setInterval(save, 15_000).unref();
  const touch = (h: string, k: Kept) => {
    pets.set(h, k);
    dirty = true;
  };
  /** the pet brought up to the present before anything is read or done */
  const current = (token: string): [string, Kept] | null => {
    if (typeof token !== "string" || !/^[0-9a-f]{48}$/.test(token)) return null;
    const h = hash(token);
    const k = pets.get(h);
    if (!k) return null;
    const caught = catchUp(k.pet, now(), brainOf(k.pet));
    const next = { ...k, pet: caught };
    touch(h, next);
    return [h, next];
  };
  return {
    adopt: (agent, name, line, instincts = 0) => {
      if (typeof agent !== "string" || !/^[\w .-]{2,32}$/.test(agent) || typeof name !== "string" || name.trim().length < 1 || name.length > 16 || !LINES.has(line as StarterLine)) return { ok: false, reason: "invalid" };
      if (!Number.isInteger(instincts) || instincts < 0 || instincts > 15) return { ok: false, reason: "invalid" };
      if (pets.size >= MAX_PETS) return { ok: false, reason: "full" };
      if ([...pets.values()].filter((k) => k.agent === agent).length >= MAX_PER_AGENT) return { ok: false, reason: "tooMany" };
      const t = now();
      const inst = cleanInstincts(instincts);
      const brain = mindBrain({ line: line as StarterLine, lessons: [], instincts: inst });
      const pet = createPet({ name: name.trim(), line: line as StarterLine, now: t, tzOffsetMin: 0, brain, instincts: inst });
      const token = randomBytes(24).toString("hex");
      const k: Kept = { agent, pet, created: t };
      touch(hash(token), k);
      save();
      return { ok: true, token, pet: viewOf(k, t) };
    },
    view: (token) => {
      const c = current(token);
      return c ? viewOf(c[1], now()) : null;
    },
    act: (token, kind, food) => {
      const c = current(token);
      if (!c) return { ok: false, reason: "unknown" };
      if (!(AGENT_CARE as readonly string[]).includes(kind)) return { ok: false, reason: "invalid" };
      const action: Care = kind === "feed" ? { kind: "feed", food: typeof food === "string" && food ? food : "mochi" } : ({ kind } as Care);
      let r;
      try {
        r = care(c[1].pet, action, now(), brainOf(c[1].pet));
      } catch {
        return { ok: false, reason: "invalid" };
      }
      const next = { ...c[1], pet: r.pet };
      touch(c[0], next);
      return { ok: true, note: r.note, pet: viewOf(next, now()) };
    },
    teach: (token, rule) => {
      const c = current(token);
      if (!c) return { ok: false, reason: "unknown" };
      // the rule's shape first, so a malformed rule is called malformed whatever room the mind has
      let clean: Rule;
      try {
        clean = validateProgram({ version: "LX-PET/1", memory: [], rules: [rule], otherwise: { want: 0, mood: 1 } }).rules[0]!;
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
      const next = { ...c[1], pet: after };
      touch(c[0], next);
      return { ok: true, pet: viewOf(next, now()) };
    },
    seasonPet: (token) => {
      const c = current(token);
      if (!c) return null;
      const p = c[1].pet;
      return { agent: c[1].agent, pet: { name: p.name, line: p.line, stage: stageOf(p, now()), card: petCard(p), story: { days: dayOf(p, now()), lessons: p.lessons.length, nature: [] } } };
    },
  };
}
