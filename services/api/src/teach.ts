/**
 * Teach in plain words: the owner's sentence in, one brain rule out.
 *
 * The model only ever proposes a rule in the pet's own vocabulary (the pins and
 * memory of LX-PET/1). It never writes gates. Every proposal is then checked by
 * the game's own rule against the pet's whole mind (its slots from stage, skills
 * and quests, its gate budget, a child's two halves, an owned instinct's memory),
 * so a bad or hostile answer can never reach a pet; the player sees the rule and
 * confirms it before anything is saved (A11).
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MAX_WORDS, type TeachBody } from "@lingxi/api-schema";
import { INPUT_FIELDS, MOODS, NUDGES, type Rule, STARTERS, type StarterLine, WANTS } from "@lingxi/brain";
import { checkMindLesson, composeProgram, lessonCapacity, parseCard, type MindSpec, type Stage } from "@lingxi/game";
import { BudgetSpent, ShareSpent } from "./tokenBudget";

export const MODEL = "claude-opus-5-5";

const MEMORY_DOC = (line: StarterLine) =>
  STARTERS[line].memory
    .map((m) => {
      const bits = m.kind === "flag" ? 1 : m.bits;
      const range = m.kind === "flag" ? "0 = no, 1 = yes" : `0..${(1 << bits) - 1}`;
      return `- ${m.name} (${m.kind}, ${range}): ${m.label ?? ""}`;
    })
    .join("\n");

function pinsDoc(): string {
  return INPUT_FIELDS.map((f) => `- ${f.name}: ${f.values.map((v, i) => `${i} ${v}`).join(", ")}`).join("\n");
}

export function systemPrompt(line: StarterLine, name = "the pet"): string {
  return [
    "You turn a pet owner's sentence into exactly one rule for their pet's brain in Lingxi, a virtual pet game.",
    `The pet is called ${name}; call it by that name in your replies.`,
    "The pet's brain reads these input fields every minute (field: value meanings):",
    pinsDoc(),
    "It also reads its own memory:",
    MEMORY_DOC(line),
    "A rule has a `when` (each field you use, with the list of values that make it true; fields you leave out mean any value) and a `then`:",
    `- want: ${WANTS.map((w, i) => `${i} ${w}`).join(", ")}`,
    `- mood: ${MOODS.map((m, i) => `${i} ${m}`).join(", ")}`,
    `- nudge: ${NUDGES.map((n, i) => `${i} ${n}`).join(", ")} (the trait this habit grows; 0 for none)`,
    "Choose the fewest conditions that capture what the owner meant. Use only the fields and values listed; never invent new ones.",
    'Write `label` as a short lowercase phrase describing the habit, under 40 characters, e.g. "shares toys with friends".',
    "If the sentence cannot be expressed with these fields (for example it asks for speech, money, real-world actions, or something unrelated to the pet's behaviour), set understood to false and leave rule null.",
    "Write `reply_en` and `reply_zh` as one warm sentence from the game telling the owner what the pet will now do, or, if not understood, what it cannot learn and a nearby idea it can. Write the Chinese natively, not as a translation.",
  ].join("\n");
}

const fieldNames = INPUT_FIELDS.map((f) => f.name) as [string, ...string[]];

export const ProposalSchema = z.object({
  understood: z.boolean(),
  rule: z
    .object({
      label: z.string().max(60),
      when: z.array(z.object({ field: z.string(), values: z.array(z.number().int().min(0).max(15)).min(1) })),
      then: z.object({ want: z.number().int().min(0).max(7), mood: z.number().int().min(0).max(3), nudge: z.number().int().min(0).max(7) }),
    })
    .nullable(),
  reply_en: z.string().max(300),
  reply_zh: z.string().max(300),
});
export type Proposal = z.infer<typeof ProposalSchema>;

/** JSON schema handed to the model (structured outputs). */
export const PROPOSAL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["understood", "rule", "reply_en", "reply_zh"],
  properties: {
    understood: { type: "boolean" },
    rule: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["label", "when", "then"],
          properties: {
            label: { type: "string" },
            when: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["field", "values"],
                properties: { field: { type: "string" }, values: { type: "array", items: { type: "integer" } } },
              },
            },
            then: {
              type: "object",
              additionalProperties: false,
              required: ["want", "mood", "nudge"],
              properties: { want: { type: "integer" }, mood: { type: "integer" }, nudge: { type: "integer" } },
            },
          },
        },
      ],
    },
    reply_en: { type: "string" },
    reply_zh: { type: "string" },
  },
} as const;

/** Pet names reach the prompt only as plain letters, digits, spaces and CJK, at most 12 characters. */
export function cleanName(name: string | undefined): string {
  const n = (name ?? "").replace(/[^\p{L}\p{N} ]/gu, "").trim().slice(0, 12);
  return n || "the pet";
}

export type TeachResult =
  | { ok: true; rule: Rule; gates: number; reply: { en: string; zh: string } }
  | { ok: false; reason: "notUnderstood" | "invalid" | "full" | "tooBig" | "duplicate" | "busy" | "resting" | "yourShare" | "error"; reply?: { en: string; zh: string }; detail?: string };

/**
 * The pet's mind a lesson is checked against: its card when the game sent one (lessons, skills, instincts, family,
 * owned instinct) with the player's quest slots, or, from a page built before the card was sent, its lessons alone.
 * Null when the card cannot be read.
 */
export function mindOf(body: Pick<TeachBody, "line" | "lessons" | "card" | "slots">): MindSpec | null {
  const line = body.line as StarterLine;
  if (body.card === undefined) return { line, lessons: body.lessons as Rule[] };
  const card = parseCard(body.card);
  if (!card) return null;
  return {
    line,
    lessons: card.lessons,
    ...(card.family ? { family: card.family } : {}),
    ...(card.instincts ? { instincts: card.instincts } : {}),
    ...(card.outside ? { outside: card.outside } : {}),
    ...(card.growth ? { growth: card.growth } : {}),
    ...(body.slots ? { slots: body.slots } : {}),
  };
}

/** Turn a model proposal into a lesson checked against the pet's mind. Pure: no network. */
export function finishProposal(raw: unknown, mind: MindSpec, stage: Exclude<Stage, "egg">): TeachResult {
  const line = mind.line;
  const parsed = ProposalSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "error", detail: "the answer did not match the schema" };
  const p = parsed.data;
  const reply = { en: p.reply_en, zh: p.reply_zh };
  if (!p.understood || !p.rule) return { ok: false, reason: "notUnderstood", reply };
  const memoryNames = STARTERS[line].memory.map((m) => m.name);
  const when: Record<string, number[]> = {};
  for (const c of p.rule.when) {
    if (!fieldNames.includes(c.field) && !memoryNames.includes(c.field)) return { ok: false, reason: "invalid", reply, detail: `unknown field ${c.field}` };
    when[c.field] = [...new Set([...(when[c.field] ?? []), ...c.values])].sort((a, b) => a - b);
  }
  const rule: Rule = {
    when,
    then: { want: p.rule.then.want, mood: p.rule.then.mood, ...(p.rule.then.nudge ? { nudge: p.rule.then.nudge } : {}) },
    label: p.rule.label.slice(0, 60),
  };
  const check = checkMindLesson(mind, stage, rule);
  if (!check.ok) return { ok: false, reason: check.reason, reply, detail: check.detail };
  // the rule as the pet's program holds it
  return { ok: true, rule: composeProgram(line, [rule]).rules[0]!, gates: check.gates, reply };
}

export interface TeachRequest {
  words: string;
  name?: string;
  stage: Exclude<Stage, "egg">;
  mind: MindSpec;
}

export async function teachInWords(client: Anthropic, req: TeachRequest): Promise<TeachResult> {
  const words = req.words.trim().slice(0, MAX_WORDS);
  if (!words) return { ok: false, reason: "notUnderstood" };
  // a pet with no room left is told so before any model is asked
  const room = lessonCapacity(req.stage, req.mind.growth, req.mind.slots);
  if (req.mind.lessons.length >= room) return { ok: false, reason: "full", detail: `a ${req.stage} can hold ${room} lessons` };
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      // a proposal is about 200 tokens (348 the most in measured real answers); a cut answer fails safely below
      max_tokens: 1200,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: PROPOSAL_JSON_SCHEMA } },
      system: systemPrompt(req.mind.line, cleanName(req.name)),
      messages: [{ role: "user", content: `The owner says: "${words}"` }],
    });
  } catch (e) {
    // the day's shared budget is spent: say so, rather than "try again in a minute"
    if (e instanceof BudgetSpent) return { ok: false, reason: "resting" };
    if (e instanceof ShareSpent) return { ok: false, reason: "yourShare" };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, reason: "busy" };
    if (e instanceof Anthropic.APIError) return { ok: false, reason: "error", detail: `api ${e.status}` };
    return { ok: false, reason: "error", detail: "network" };
  }
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return { ok: false, reason: "notUnderstood" };
  const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  if (!text) return { ok: false, reason: "error", detail: "empty answer" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "error", detail: "answer was not JSON" };
  }
  return finishProposal(raw, req.mind, req.stage);
}
