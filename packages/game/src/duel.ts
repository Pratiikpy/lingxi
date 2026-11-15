/**
 * Challenges by link (PRD F23). A challenge carries the challenger's pet as it
 * is: its card (lessons, instincts, family, memory), its body (line and stage),
 * its name and a short story, plus the seed the spar will use. The friend's own
 * pet answers with its own brain. The answer can travel back as a result link
 * holding both pets, so anyone who opens it replays exactly the same fight and
 * sees the same fingerprint. Everything lives in the link's fragment: no server,
 * no wallet, and every field is checked on arrival.
 */

import { b64urlDecode, b64urlEncode, compileProgram, gateCount } from "@lingxi/brain";
import { fighterOfMind } from "./coach";
import { type PetCard, halvesOf, mindBrain, parseCard } from "./family";
import { MAX_GATES, composeProgram } from "./lessons";
import type { Fighter, SparResult } from "./spar";
import { spar } from "./spar";

const CHALLENGE = "lxc1.";
const RESULT = "lxr1.";
export const MAX_DUEL_CODE = 12_000;
const LINES = ["gentle", "bold", "curious"] as const;
const STAGES = ["baby", "child", "teen", "adult", "elder"] as const;
type Line = (typeof LINES)[number];
type Stage = (typeof STAGES)[number];

/** A pet as it travels in a link. */
export interface DuelPet {
  name: string;
  line: Line;
  stage: Stage;
  /** its pet card (see family.ts petCard) */
  card: string;
  /** a few true facts for the friend to read */
  story: { days: number; lessons: number; nature: string[] };
}

export interface Challenge {
  /** random id; also fixes the spar's seed */
  id: string;
  from: DuelPet;
  at: number;
}

export interface DuelResult {
  challenge: Challenge;
  reply: DuelPet;
}

export class DuelError extends Error {}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f<>]/g, " ").trim().slice(0, max) : "");

function readPet(v: unknown): DuelPet & { parsed: PetCard } {
  const p = (v ?? {}) as Record<string, unknown>;
  const line = LINES.find((l) => l === p.line);
  const stage = STAGES.find((s) => s === p.stage);
  if (!line || !stage) throw new DuelError("unknown pet");
  if (typeof p.card !== "string") throw new DuelError("the pet has no mind");
  const parsed = parseCard(p.card);
  if (!parsed) throw new DuelError("the pet's mind is damaged");
  // both minds must build and fit, exactly as they would at home
  const minds = parsed.family ? halvesOf(parsed.family, parsed.lessons) : [composeProgram(line, parsed.lessons, parsed.instincts)];
  for (const m of minds) if (gateCount(compileProgram(m)) > MAX_GATES) throw new DuelError("the pet's mind is too big");
  const st = (p.story ?? {}) as Record<string, unknown>;
  const nature = Array.isArray(st.nature) ? st.nature.slice(0, 3).map((x) => clean(x, 16)).filter(Boolean) : [];
  return {
    name: clean(p.name, 12) || "Friend",
    line,
    stage,
    card: p.card,
    story: {
      days: Number.isInteger(st.days) ? Math.max(0, Math.min(9999, st.days as number)) : 0,
      lessons: Number.isInteger(st.lessons) ? Math.max(0, Math.min(8, st.lessons as number)) : parsed.lessons.length,
      nature,
    },
    parsed,
  };
}

const strip = ({ parsed: _p, ...pet }: DuelPet & { parsed?: PetCard }): DuelPet => pet;

export function encodeChallenge(c: Challenge): string {
  return CHALLENGE + b64urlEncode(JSON.stringify({ ...c, from: strip(c.from) }));
}

function readChallenge(v: Record<string, unknown>): Challenge {
  const id = clean(v.id, 32);
  if (!/^[a-z0-9]{8,32}$/.test(id)) throw new DuelError("the challenge has no id");
  return { id, from: strip(readPet(v.from)), at: Number.isFinite(v.at) ? Math.max(0, Math.floor(v.at as number)) : 0 };
}

function unpack(code: string, prefix: string): Record<string, unknown> {
  if (typeof code !== "string" || !code.startsWith(prefix)) throw new DuelError("not a Lingxi challenge");
  if (code.length > MAX_DUEL_CODE) throw new DuelError("the link is too long");
  try {
    const v = JSON.parse(b64urlDecode(code.slice(prefix.length))) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new DuelError("the link is damaged");
  }
}

export const decodeChallenge = (code: string): Challenge => readChallenge(unpack(code, CHALLENGE));

export function encodeResult(r: DuelResult): string {
  return RESULT + b64urlEncode(JSON.stringify({ challenge: { ...r.challenge, from: strip(r.challenge.from) }, reply: strip(r.reply) }));
}

export function decodeResult(code: string): DuelResult {
  const v = unpack(code, RESULT);
  return { challenge: readChallenge((v.challenge ?? {}) as Record<string, unknown>), reply: strip(readPet(v.reply)) };
}

/** The spar's seed, fixed by the challenge so every replay is the same fight. */
export function duelSeed(c: Pick<Challenge, "id">): number {
  let h = 2166136261;
  for (const ch of c.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

const levelOfStage = (s: Stage) => (s === "elder" ? 2 : s === "teen" || s === "adult" ? 1 : 0);

/** A fighter from a pet in a link: its own mind, with its memory when the memory fits. */
export function duelFighter(p: DuelPet): Fighter {
  const card = parseCard(p.card);
  if (!card) throw new DuelError("the pet's mind is damaged");
  const spec = { line: p.line, lessons: card.lessons, family: card.family, instincts: card.instincts };
  const nState = mindBrain(spec).nState;
  return fighterOfMind(p.name, spec, levelOfStage(p.stage), card.memory?.length === nState ? card.memory : undefined);
}

/**
 * The fight a challenge produces: the friend's pet (side 0, the one answering)
 * against the challenger (side 1). No cheering on either side, so a replay from
 * the result link matches the fight exactly.
 */
export function duel(c: Challenge, reply: DuelPet): SparResult {
  return spar(duelFighter(reply), duelFighter(c.from), duelSeed(c));
}
