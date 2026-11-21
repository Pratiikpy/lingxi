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
import { type PetCard, halvesOf, mindBrain, mindExtra, parseCard, CARD_MAX } from "./family";
import { composeProgram } from "./lessons";
import { shownName } from "./names";
import { gateBudget, skillRules } from "./skills";
import { type Fighter, SPAR_VERSION, type SparResult, type SparVersion } from "./spar";
import { CURRENT_SPAR, SPAR_V2, fight } from "./spar2";

const CHALLENGE = "lxc1.";
const RESULT = "lxr1.";
/**
 * The longest challenge code read: one carrying the largest card the game makes (A26). The card travels as a JSON string,
 * where an escaped character takes two, and the code is base64, four characters for three; the rest of a challenge (its
 * name, story and id) stays under 2,000.
 */
export const MAX_DUEL_CODE = Math.ceil(((2 * CARD_MAX + 2_000) * 4) / 3) + 16;
/** The longest result code read: it carries two pets' cards, the challenger's and the reply's (A32). */
export const MAX_DUEL_RESULT_CODE = Math.ceil(((4 * CARD_MAX + 4_000) * 4) / 3) + 16;

/** Whether a string is a challenge or a result code (what a short link stands for). */
export const isDuelCode = (s: string): boolean => s.startsWith(CHALLENGE) || s.startsWith(RESULT);

/**
 * A short link's id for a duel code (A32): the first 16 characters of the code's SHA-256 in base64url. The same code
 * always has the same id, and whoever fetches a code by its id can check it hashes back, so whoever keeps the codes
 * cannot swap one challenge for another.
 */
export async function duelLinkId(code: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)));
  // the digest's own bytes in base64url (b64urlEncode would read them as text first)
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 16);
}
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
  /** the fight version it was answered in; a result link from before G2 names none and was fought in LX-SPAR/1 */
  version?: SparVersion;
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
  const minds = parsed.family ? halvesOf(parsed.family, parsed.lessons, skillRules(parsed.growth)) : [composeProgram(line, parsed.lessons, parsed.instincts, mindExtra(parsed.growth))];
  for (const m of minds) if (gateCount(compileProgram(m)) > gateBudget(parsed.growth)) throw new DuelError("the pet's mind is too big");
  const st = (p.story ?? {}) as Record<string, unknown>;
  const nature = Array.isArray(st.nature) ? st.nature.slice(0, 3).map((x) => clean(x, 16)).filter(Boolean) : [];
  return {
    name: shownName(p.name, 12) || "Friend",
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

function unpack(code: string, prefix: string, max: number): Record<string, unknown> {
  if (typeof code !== "string" || !code.startsWith(prefix)) throw new DuelError("not a Lingxi challenge");
  if (code.length > max) throw new DuelError("the link is too long");
  try {
    const v = JSON.parse(b64urlDecode(code.slice(prefix.length))) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new DuelError("the link is damaged");
  }
}

export const decodeChallenge = (code: string): Challenge => readChallenge(unpack(code, CHALLENGE, MAX_DUEL_CODE));

export function encodeResult(r: DuelResult): string {
  return RESULT + b64urlEncode(JSON.stringify({ challenge: { ...r.challenge, from: strip(r.challenge.from) }, reply: strip(r.reply), version: r.version ?? SPAR_VERSION }));
}

export function decodeResult(code: string): DuelResult {
  const v = unpack(code, RESULT, MAX_DUEL_RESULT_CODE);
  return { challenge: readChallenge((v.challenge ?? {}) as Record<string, unknown>), reply: strip(readPet(v.reply)), version: v.version === SPAR_V2 ? SPAR_V2 : SPAR_VERSION };
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
  const spec = { line: p.line, lessons: card.lessons, family: card.family, instincts: card.instincts, outside: card.outside, growth: card.growth };
  const nState = mindBrain(spec).nState;
  return fighterOfMind(p.name, spec, levelOfStage(p.stage), card.memory?.length === nState ? card.memory : undefined);
}

/**
 * The fight a challenge produces: the friend's pet (side 0, the one answering)
 * against the challenger (side 1). No cheering on either side, so a replay from
 * the result link matches the fight exactly.
 */
export function duel(c: Challenge, reply: DuelPet, version: SparVersion = CURRENT_SPAR): SparResult {
  // a challenge answered now is fought in today's version; its result link names the version, so the challenger's
  // replay is the same fight even after the game moves on
  return fight(version, duelFighter(reply), duelFighter(c.from), duelSeed(c));
}
