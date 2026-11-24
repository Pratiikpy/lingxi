/**
 * Every body and query the game sends its server, built as the server's own schema reads it (@lingxi/api-schema).
 * Only the types cross over (`import type`), so no zod reaches the game's bundle; a change to a schema fails the game's
 * type check here until the game follows it. The relay routes' envelopes are typed where they are sent (api.ts).
 */

import type {
  ArenaOpponentQuery,
  ArenaSnapshotBody,
  GoalsQuery,
  LessonKeyBody,
  LessonShareBody,
  MoveBody,
  PapersBody,
  PublishedLog,
  PushPlanBody,
  PushStopBody,
  SeasonEnterBody,
  SitHomeBody,
  SitLeaveBody,
  TeachBody,
  VoiceBody,
  VoucherQuery,
} from "@lingxi/api-schema";
import type { Rule } from "@lingxi/brain";
import type { SignedRelay } from "@lingxi/chain";
import { type DuelPet, type Meters, type NeedKind, type Pet, type Stage, habitsOf, petCard } from "@lingxi/game";

type Hatched = Exclude<Stage, "egg">;

/** A path and its query, the parts left out when absent. */
export function withQuery(path: string, query: Record<string, string | undefined>): string {
  const parts = Object.entries(query).filter((e): e is [string, string] => e[1] !== undefined);
  return parts.length ? `${path}?${new URLSearchParams(parts).toString()}` : path;
}

/**
 * POST /api/teach: the owner's words, and the pet as the lesson is checked against it: its whole mind as its card
 * (skills, instincts, family, owned instinct) and the lesson slots the player's quests gave (A11).
 */
export const teachBody = (
  words: string,
  pet: Pick<Pet, "name" | "line" | "lessons" | "growth" | "instincts" | "family" | "outside">,
  stage: Hatched,
  slots: number,
): TeachBody => ({
  words,
  name: pet.name,
  line: pet.line,
  stage,
  lessons: pet.lessons,
  card: petCard(pet),
  slots,
});

/** POST /api/voice: what the pet's circuit decided and why, for one line in its own words. */
export function voiceBody(o: {
  pet: Pick<Pet, "name" | "line" | "sick" | "asleep"> & { traits?: Pet["traits"] };
  lang: "en" | "zh";
  stage: Hatched;
  chips: { then: string; when: string[] };
  meters: Meters;
  tapped: boolean;
  taught?: boolean;
}): VoiceBody {
  return {
    name: o.pet.name.slice(0, 24),
    lang: o.lang,
    stage: o.stage,
    line: o.pet.line,
    decision: o.chips.then.slice(0, 60) || "rest",
    because: o.chips.when.slice(0, 6).map((w) => w.slice(0, 60)),
    meters: { food: o.meters.food, joy: o.meters.joy, energy: o.meters.energy, clean: o.meters.clean },
    sick: Boolean(o.pet.sick),
    asleep: o.pet.asleep,
    moment: o.tapped ? "petted" : "decided",
    // G9: its habits and whether a lesson its owner taught decided, so the line sounds like this pet
    habits: habitsOf(o.pet.traits).slice(0, 3),
    taught: o.taught ?? false,
  };
}

/** POST /api/sit: the pet's pack as text, the hash of the key that opens it, and when it is due home. */
export const sitLeaveBody = (pack: string, keyHash: string, until: number): SitLeaveBody => ({ pack, keyHash, until });

/** POST /api/sit/:code/home: the owner's key and the pet coming home, as text. */
export const sitHomeBody = (key: string, pet: string): SitHomeBody => ({ key, pet });

/** POST /api/arena/snapshot: the line this device fielded at a round. */
export const arenaSnapshotBody = (round: number, pet: DuelPet, team: string[], device: string): ArenaSnapshotBody => ({
  round,
  pet,
  team,
  device,
});

/** GET /api/arena/opponent: another player's line at the same round, never this device's own. */
export const arenaOpponentQuery = (round: number, device: string): ArenaOpponentQuery => ({
  round: String(round),
  device,
});

/** POST /api/season/enter: the pet, this device, and for a pet on X Layer its signed proof (chain.ts signSeasonEntry). */
export const seasonEnterBody = (pet: DuelPet, device: string, proof?: SignedRelay<"season">): SeasonEnterBody => ({
  pet,
  device,
  ...(proof ? { proof } : {}),
});

/** POST /api/lessons/share. Only the rule's structure is shared: the library shows no player's own words, so a lesson's label stays on this device. */
export const lessonShareBody = (rule: Rule, by: string): LessonShareBody => ({
  rule: { when: rule.when, then: rule.then },
  by: by.slice(0, 24),
});

/** POST /api/lessons/use and /api/lessons/report. */
export const lessonKeyBody = (key: string): LessonKeyBody => ({ key });

/** POST /api/pets/:id/log: the log the last checkpoint committed to, whole and by brain. */
export const diaryBody = (
  petId: string,
  words: number[],
  segments: Array<{ brainId: string | null; words: number[] }>,
): PublishedLog => ({ petId, words, segments });

/** POST /api/move: this device's save, each store as text. */
export const moveBody = (save: Record<string, string>): MoveBody => ({ save });

/** POST /api/push/plan: where to reach this browser, and the reminders the pet will need. */
export const pushPlanBody = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  lang: "en" | "zh",
  name: string,
  tz: number,
  reminders: Array<{ kind: NeedKind; at: number }>,
): PushPlanBody => ({
  subscription,
  lang,
  name: name.slice(0, 24),
  tz,
  reminders,
});

/** POST /api/push/stop. */
export const pushStopBody = (endpoint: string): PushStopBody => ({ endpoint });

/** GET /api/goals: every goal, with each of these wallets' share. */
export const goalsQuery = (wallets: readonly string[]): GoalsQuery =>
  wallets.length ? { wallet: wallets.join(",") } : {};

/** GET /api/voucher: the wallet's voucher for a goal's keepsake. */
export const voucherQuery = (wallet: string, goal: string): VoucherQuery => ({ wallet, goal });

/** POST /api/papers/:petId: the papers as the JSON text the owner signed, and the signature. */
export const papersBody = (papers: string, signature: string): PapersBody => ({ papers, signature });
