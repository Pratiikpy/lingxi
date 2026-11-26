/**
 * Every request the game sends Lingxi's server, one zod schema each. The server validates with these schemas and the
 * game builds its bodies and queries as their types (`import type` only, so zod never reaches the game's bundle): a
 * change on one side that the other does not follow fails the type check.
 *
 * The limits were hardened in the server's security review and are held at and past each edge by this package's
 * tests. The bytes of a body are capped before any of it is parsed (services/api/src/bodyLimits.ts). A type here is
 * what a client sends (`z.input`); where parsing fills in a default or turns text into values, `Parsed…` is what the
 * server holds afterwards.
 */

import { z } from "zod";
import { STARTERS } from "@lingxi/brain";
import { CARD_BASE_MAX, CARD_MAX as GAME_CARD_MAX, MAX_LESSONS, QUEST_SLOTS_MAX } from "@lingxi/game";
import { SEND_LIMITS } from "@lingxi/chain/limits";

const ID = /^\d{1,20}$/;
const WALLET = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const LINE = z.enum(Object.keys(STARTERS) as [keyof typeof STARTERS, ...Array<keyof typeof STARTERS>]);
const STAGE = z.enum(["baby", "child", "teen", "adult", "elder"]);
const LANG = z.enum(["en", "zh"]);

/* ── teaching in words: POST /api/teach ─────────────────────────────────── */

/** The most characters of the owner's words a lesson is taught from. */
export const MAX_WORDS = 240;

/** A lesson the pet holds, as the server reads it to check a new one against or to tape it out. */
export const LessonRule = z.object({
  when: z.record(z.string(), z.array(z.number().int().min(0).max(15)).max(16)),
  then: z.object({ want: z.number().int(), mood: z.number().int(), nudge: z.number().int().optional() }),
  label: z.string().max(60).optional(),
});
export type LessonRule = z.input<typeof LessonRule>;

/**
 * The most characters of a pet card (its lessons, skills, instincts, family and owned instinct, as the game shares it):
 * what `parseCard` accepts, ten thousand for the pet and room for an owned instinct's circuit.
 */
/** The longest card a request may carry: the game's own card budget (A26). */
export const CARD_MAX = GAME_CARD_MAX;

export const TeachBody = z.object({
  words: z.string().min(1).max(MAX_WORDS),
  name: z.string().max(40).optional(),
  line: LINE,
  stage: STAGE,
  /** the lessons it holds, as many as any pet can (A11) */
  lessons: z.array(LessonRule).max(MAX_LESSONS),
  /** its whole mind, as its card: the lesson is checked against this with the game's own rule (A11) */
  card: z.string().max(CARD_MAX).optional(),
  /** the lesson slots the player's quests gave its pets (quest 65) */
  slots: z.number().int().min(0).max(QUEST_SLOTS_MAX).optional(),
});
export type TeachBody = z.input<typeof TeachBody>;

/* ── the relayer: POST /api/tapeout, /api/tapeout-child, /api/tapeout-instinct ── */

/** Every relay request, signed by a keeper of the pet (@lingxi/chain relayAuth.ts); `payload` is the signed JSON text. */
export const RelayEnvelope = z.object({
  kind: z.enum(["brain", "child", "instinct"]),
  petId: z.string().regex(ID),
  payload: z.string().max(20_000),
  auth: z.object({ signer: z.string(), nonce: z.string(), time: z.number(), signature: z.string() }),
});
export type RelayEnvelope = z.input<typeof RelayEnvelope>;
/** The envelope one route takes: "brain" at /api/tapeout, "child" at /api/tapeout-child, "instinct" at /api/tapeout-instinct. */
export type RelayEnvelopeOf<K extends RelayEnvelope["kind"]> = RelayEnvelope & { kind: K };

/** A pet's own brain: its line, its lessons, its instinct switches and its capstone rule skills (plan 4.4). */
export const BrainRelayPayload = z.object({
  line: LINE,
  lessons: z.array(LessonRule).max(MAX_LESSONS),
  instincts: z.number().int().min(0).max(15).optional(),
  skills: z.array(z.number().int().min(100).max(999)).max(8).optional(),
});
export type BrainRelayPayload = z.input<typeof BrainRelayPayload>;

/** A child's brain: REFs to its parents' circuits, or (once taught) both of its halves as its card. */
export const ChildRelayPayload = z.union([
  z.object({ parents: z.tuple([z.string().regex(ID), z.string().regex(ID)]) }),
  z.object({ card: z.string().max(CARD_BASE_MAX) }),
]);
export type ChildRelayPayload = z.input<typeof ChildRelayPayload>;

/** X1: an owned circuit as an everyday instinct, REF'd beside the pet's own brain. */
export const InstinctRelayPayload = z.object({
  own: z.string().regex(ID),
  processor: z.string().regex(WALLET),
  id: z.string().regex(ID),
});
export type InstinctRelayPayload = z.input<typeof InstinctRelayPayload>;

/** What each relay kind signs as its payload. */
export interface RelayPayloads {
  brain: BrainRelayPayload;
  child: ChildRelayPayload;
  instinct: InstinctRelayPayload;
}

/* ── the pet's voice: POST /api/voice ───────────────────────────────────── */

export const VoiceBody = z.object({
  name: z.string().min(1).max(24),
  lang: LANG,
  stage: STAGE,
  line: z.enum(["gentle", "bold", "curious"]),
  /** what the brain decided, as the game words it (e.g. "ask for food", "sulk") */
  decision: z.string().min(1).max(60),
  /** the conditions of the rule that fired, as the game words them */
  because: z.array(z.string().max(60)).max(6),
  meters: z.object({
    food: z.number().int().min(0).max(1000),
    joy: z.number().int().min(0).max(1000),
    energy: z.number().int().min(0).max(1000),
    clean: z.number().int().min(0).max(1000),
  }),
  sick: z.boolean(),
  asleep: z.boolean(),
  /** "decided": its circuit just chose this; "petted": its owner just petted it */
  moment: z.enum(["decided", "petted"]).default("decided"),
  /** G9: the pet's habits, strongest first (traits at the habit level), and whether a lesson its owner taught decided */
  habits: z
    .array(z.enum(["brave", "curious", "greedy", "calm", "playful", "gentle", "shy"]))
    .max(3)
    .default([]),
  taught: z.boolean().default(false),
});
export type VoiceBody = z.input<typeof VoiceBody>;
export type ParsedVoiceBody = z.output<typeof VoiceBody>;

/* ── pet-sitting: POST /api/sit, POST /api/sit/:code/home ───────────────── */

/** A pet left with a friend: its pack as text, the hash of the key that opens it, and when it is due home. */
export const SitLeaveBody = z.object({ pack: z.string(), keyHash: z.string(), until: z.number() });
export type SitLeaveBody = z.input<typeof SitLeaveBody>;

/** The pet coming home: the key the owner gave, and the pet as text. */
export const SitHomeBody = z.object({ key: z.string(), pet: z.string() });
export type SitHomeBody = z.input<typeof SitHomeBody>;

/* ── the arena: POST /api/arena/snapshot, GET /api/arena/opponent ───────── */

/** The line a device fielded at a round. The pet and the team are checked in full by the store (arena.ts validSnapshot). */
export const ArenaSnapshotBody = z.object({
  round: z.number().int(),
  pet: z.unknown(),
  team: z.unknown(),
  device: z.string(),
});
export type ArenaSnapshotBody = z.input<typeof ArenaSnapshotBody>;

/** `?round=&device=`: a whole round from 0, and the asking device (whose own line is never served back). */
export const ArenaOpponentQuery = z.object({
  round: z
    .string()
    .transform(Number)
    .pipe(z.number().refine((n) => Number.isInteger(n) && n >= 0)),
  device: z.string().min(8).max(64),
});
export type ArenaOpponentQuery = z.input<typeof ArenaOpponentQuery>;
export type ParsedArenaOpponentQuery = z.output<typeof ArenaOpponentQuery>;

/* ── weekly seasons: POST /api/season/enter ─────────────────────────────── */

/**
 * An entry: the pet (checked in full by the store, season.ts), the device, and, for a pet on X Layer, its proof (a
 * relay request of kind "season" whose payload is the pet; seasonProof.ts checks it, so a bad one is an answer, not a
 * malformed request).
 */
export const SeasonEnterBody = z.object({ pet: z.unknown(), device: z.string(), proof: z.unknown().optional() });
export type SeasonEnterBody = z.input<typeof SeasonEnterBody>;

/* ── the lesson library: POST /api/lessons/share, /use, /report ─────────── */

/** A shared lesson in the pet's own vocabulary; a label is accepted from older clients and dropped, never stored. */
export const LibraryRule = z.object({
  when: z.record(z.string().max(24), z.array(z.number().int().min(0).max(15)).min(1).max(16)),
  then: z.object({
    want: z.number().int().min(0).max(15),
    mood: z.number().int().min(0).max(3),
    nudge: z.number().int().min(0).max(15).optional(),
  }),
  label: z.string().max(60).optional(),
});
export type LibraryRule = z.input<typeof LibraryRule>;

export const LessonShareBody = z.object({ rule: LibraryRule, by: z.string().max(40) });
export type LessonShareBody = z.input<typeof LessonShareBody>;

/** A library lesson's key, for /use and /report. */
export const LessonKeyBody = z.object({ key: z.string().regex(/^[0-9a-f]{24}$/) });
export type LessonKeyBody = z.input<typeof LessonKeyBody>;

/**
 * P8: an uncaught error the game reports about itself: its message, where it happened and the build, nothing else (no
 * player, pet or address). Every field is capped; anything more is refused.
 */
export const ClientErrorBody = z
  .object({
    message: z.string().min(1).max(300),
    where: z.string().max(200),
    build: z.string().max(40),
  })
  .strict();
export type ClientErrorBody = z.input<typeof ClientErrorBody>;

/* ── public diaries: POST /api/pets/:id/log ─────────────────────────────── */

const Word = z.number().int().min(0).max(65535);
/**
 * The log a pet's last checkpoint committed to, whole and by brain (100,000 beats at most, about 70 days of minutes);
 * kept only if it hashes to the log hash on chain.
 */
export const PublishedLog = z.object({
  petId: z.string().regex(/^\d{1,12}$/),
  words: z.array(Word).min(1).max(SEND_LIMITS.logWords),
  segments: z
    .array(z.object({ brainId: z.string().regex(ID).nullable(), words: z.array(Word).max(SEND_LIMITS.logWords) }))
    .min(1)
    .max(64),
});
export type PublishedLog = z.input<typeof PublishedLog>;

/* ── moving pets between Telegram and a browser: POST /api/move ─────────── */

const STORE_KEY = /^lingxi\.[a-z0-9_.-]{1,40}$/i;
/** A device's save: each of its stores (64 at most) as text. The total size is checked by the store (move.ts). */
export const MoveSave = z
  .record(z.string().regex(STORE_KEY), z.string().max(SEND_LIMITS.moveChars))
  .refine((r) => Object.keys(r).length > 0 && Object.keys(r).length <= 64, "entries");
export type MoveSave = z.input<typeof MoveSave>;

export const MoveBody = z.object({ save: MoveSave });
export type MoveBody = z.input<typeof MoveBody>;

/* ── reminders: POST /api/push/plan, POST /api/push/stop ────────────────── */

/** The most reminders one plan may hold. */
export const MAX_REMINDERS = 6;

export const PushPlanBody = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(800),
    keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }),
  }),
  lang: LANG,
  name: z.string().min(1).max(24),
  /** minutes east of UTC, as the browser reports it */
  tz: z.number().int().min(-840).max(840),
  reminders: z
    .array(z.object({ kind: z.enum(["hungry", "bored", "dirty", "sick"]), at: z.number().int() }))
    .max(MAX_REMINDERS),
});
export type PushPlanBody = z.input<typeof PushPlanBody>;

export const PushStopBody = z.object({ endpoint: z.string().max(800) });
export type PushStopBody = z.input<typeof PushStopBody>;

/* ── community goals and their keepsakes: GET /api/goals, GET /api/voucher ── */

/** `?wallet=0x…,0x…`: at most eight wallets, comma-separated; none at all asks for the goals alone. */
export const GoalsQuery = z.object({
  wallet: z
    .string()
    .optional()
    .transform((w) => (w ?? "").split(",").filter(Boolean))
    .pipe(z.array(z.string().regex(WALLET)).max(8)),
});
export type GoalsQuery = z.input<typeof GoalsQuery>;
export type ParsedGoalsQuery = z.output<typeof GoalsQuery>;

/** `?wallet=0x…&goal=g1`: the wallet asking, and the goal whose keepsake it asks for (an unknown goal is a 404). */
export const VoucherQuery = z.object({ wallet: z.string().regex(WALLET), goal: z.string().default("") });
export type VoucherQuery = z.input<typeof VoucherQuery>;
export type ParsedVoucherQuery = z.output<typeof VoucherQuery>;

/* ── adoption papers: POST /api/papers/:petId ───────────────────────────── */

/** The most characters a pet's papers may hold. */
export const PAPERS_MAX = 600_000;

const isJson = (text: string): boolean => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

/** The papers as the JSON text the owner signed, and the owner's signature over their hash (papers.ts papersMessage). */
export const PapersBody = z.object({
  papers: z.string().max(PAPERS_MAX).refine(isJson),
  signature: z.string().regex(SIGNATURE),
});
export type PapersBody = z.input<typeof PapersBody>;

/* ── the agents' API: GET /api/v1/spar, POST /api/v1/agents/adopt, /me/care, /me/teach ── */

/** A brain (`program=lx1.…`, or a TapeFly brain as `p1=…` or `chips=a,b,c`) against a partner or `fly:<rival>`. */
export const SparQuery = z.object({
  program: z.string().optional(),
  p1: z.string().optional(),
  chips: z.string().optional(),
  vs: z.string().optional(),
  seed: z.string().optional(),
});
export type SparQuery = z.input<typeof SparQuery>;

/*
 * An agent's bodies are read leniently: the agent store (services/api/src/agents.ts) turns each part into text or a
 * number and checks it there, so these schemas take any object, and a body that is not one reads as an empty object.
 */

/** `{ agent, name, line, instincts? }`: who is adopting, the pet's name, its line, its instinct switches. */
export const AgentAdoptBody = z
  .object({ agent: z.unknown(), name: z.unknown(), line: z.unknown(), instincts: z.unknown() })
  .partial();
export type AgentAdoptBody = z.input<typeof AgentAdoptBody>;

/** `{ action, food? }`: one of the care actions, and for feeding, the food. */
export const AgentCareBody = z.object({ action: z.unknown(), food: z.unknown() }).partial();
export type AgentCareBody = z.input<typeof AgentCareBody>;

/** `{ rule }`: a rule in the PET-16x8/1 rule language. */
export const AgentTeachBody = z.object({ rule: z.unknown() }).partial();
export type AgentTeachBody = z.input<typeof AgentTeachBody>;
